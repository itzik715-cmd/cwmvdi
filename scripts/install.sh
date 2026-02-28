#!/bin/bash
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()   { echo -e "${GREEN}[KamVDI]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
fatal() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║         KamVDI Installation v1.0         ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Prerequisites ──────────────────────────────────────────
[[ $EUID -ne 0 ]] && fatal "Run as root: sudo ./scripts/install.sh"

log "Checking system..."
RAM_GB=$(free -g | awk '/^Mem:/{print $2}')
[[ $RAM_GB -lt 4 ]] && warn "Low RAM (${RAM_GB}GB). Recommended: 8GB+"

# ── Docker ─────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  log "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
  log "Docker installed"
fi

if ! docker compose version &>/dev/null; then
  log "Installing Docker Compose..."
  apt-get install -y docker-compose-plugin
fi

# ── Configuration ──────────────────────────────────────────
echo ""
echo "─── Network Gateway Configuration ───────────"

read -p "Enable NAT gateway for private VLANs? [Y/n]: " ENABLE_NAT
ENABLE_NAT=${ENABLE_NAT:-Y}

if [[ "$ENABLE_NAT" =~ ^[Yy] ]]; then
  # Detect interfaces
  WAN_IFACE=$(ip route show default | awk '{print $5}' | head -1)
  LAN_IFACE=$(ip -o link show | awk -F': ' '{print $2}' \
      | grep -v -E "^(lo|docker|veth|br-|${WAN_IFACE})$" | head -1)
  LAN_IFACE=${LAN_IFACE:-$WAN_IFACE}

  echo "Detected WAN: ${WAN_IFACE}, LAN: ${LAN_IFACE}"
  read -p "WAN interface [${WAN_IFACE}]: " INPUT_WAN
  WAN_IFACE=${INPUT_WAN:-$WAN_IFACE}
  read -p "LAN interface [${LAN_IFACE}]: " INPUT_LAN
  LAN_IFACE=${INPUT_LAN:-$LAN_IFACE}
fi

echo ""
echo "─── Portal Configuration ───────────────────"

SERVER_IP=$(curl -s --max-time 5 ifconfig.me 2>/dev/null \
            || hostname -I | awk '{print $1}')
SAFE_IP=$(echo "$SERVER_IP" | tr '.' '-')
DEFAULT_DOMAIN="${SAFE_IP}.cloud-xip.io"

echo "Detected IP: ${SERVER_IP}"
read -p "Portal domain [${DEFAULT_DOMAIN}]: " PORTAL_DOMAIN
PORTAL_DOMAIN=${PORTAL_DOMAIN:-$DEFAULT_DOMAIN}

echo ""
read -p "Admin email: " ADMIN_EMAIL
[[ -z "$ADMIN_EMAIL" ]] && fatal "Admin email required"

echo ""
read -p "Auto-suspend idle VMs after (minutes) [30]: " SUSPEND_MIN
SUSPEND_MIN=${SUSPEND_MIN:-30}

# ── Secrets ────────────────────────────────────────────────
log "Generating secrets..."
SECRET_KEY=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)
PG_PASS=$(openssl rand -hex 16)
REDIS_PASS=$(openssl rand -hex 16)
ADMIN_PASS=$(openssl rand -base64 12 | tr -dc 'A-Za-z0-9' | head -c 12)

# ── .env ───────────────────────────────────────────────────
cat > .env << EOF
PORTAL_DOMAIN=${PORTAL_DOMAIN}
PORTAL_URL=https://${PORTAL_DOMAIN}
SECRET_KEY=${SECRET_KEY}
ENCRYPTION_KEY=${ENCRYPTION_KEY}
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_TEMP_PASSWORD=${ADMIN_PASS}
POSTGRES_DB=kamvdi
POSTGRES_USER=kamvdi
POSTGRES_PASSWORD=${PG_PASS}
DATABASE_URL=postgresql+asyncpg://kamvdi:${PG_PASS}@postgres:5432/kamvdi
REDIS_PASSWORD=${REDIS_PASS}
REDIS_URL=redis://:${REDIS_PASS}@redis:6379/0
DEFAULT_SUSPEND_MINUTES=${SUSPEND_MIN}
CLOUDWM_API_URL=
CLOUDWM_CLIENT_ID=
CLOUDWM_SECRET_ENCRYPTED=
BOUNDARY_ADDR=http://boundary:9200
BOUNDARY_AUTH_METHOD_ID=
BOUNDARY_ADMIN_LOGIN=admin
BOUNDARY_ADMIN_PASSWORD=
BOUNDARY_ORG_ID=
BOUNDARY_TLS_INSECURE=true
NAT_GATEWAY_ENABLED=${ENABLE_NAT:-N}
EOF
chmod 600 .env

# ── SSL (Let's Encrypt) ───────────────────────────────────
log "Setting up SSL..."
mkdir -p nginx/ssl certbot/www

USE_LE=false

# Install certbot if needed
if ! command -v certbot &>/dev/null; then
  log "Installing certbot..."
  apt-get install -y -qq certbot > /dev/null 2>&1 || true
fi

if command -v certbot &>/dev/null; then
  log "Requesting Let's Encrypt certificate for ${PORTAL_DOMAIN}..."
  if certbot certonly --standalone --non-interactive --agree-tos \
       --email "${ADMIN_EMAIL}" -d "${PORTAL_DOMAIN}" 2>&1; then
    # Copy certs to nginx/ssl (containers can't follow host symlinks)
    cp /etc/letsencrypt/live/${PORTAL_DOMAIN}/fullchain.pem nginx/ssl/cert.pem
    cp /etc/letsencrypt/live/${PORTAL_DOMAIN}/privkey.pem nginx/ssl/key.pem
    USE_LE=true
    log "Let's Encrypt certificate obtained"

    # Auto-renewal cron: renew + copy + reload nginx
    RENEW_SCRIPT="/etc/cron.d/kamvdi-cert-renew"
    cat > ${RENEW_SCRIPT} << CRON
SHELL=/bin/bash
0 3 * * * root certbot renew --quiet && cp /etc/letsencrypt/live/${PORTAL_DOMAIN}/fullchain.pem $(pwd)/nginx/ssl/cert.pem && cp /etc/letsencrypt/live/${PORTAL_DOMAIN}/privkey.pem $(pwd)/nginx/ssl/key.pem && cd $(pwd) && docker compose exec -T nginx nginx -s reload
CRON
    chmod 644 ${RENEW_SCRIPT}
    log "Auto-renewal cron configured"
  else
    warn "Let's Encrypt failed — falling back to self-signed certificate"
  fi
else
  warn "certbot not available — using self-signed certificate"
fi

# Fallback: self-signed
if [[ "$USE_LE" == "false" ]]; then
  openssl req -x509 -nodes -days 365 \
    -newkey rsa:2048 \
    -keyout nginx/ssl/key.pem \
    -out nginx/ssl/cert.pem \
    -subj "/CN=${PORTAL_DOMAIN}" 2>/dev/null
  log "Self-signed certificate generated"
fi

# ── Build Agent ───────────────────────────────────────────
log "Building KamVDI agent..."
mkdir -p downloads

if ! command -v go &>/dev/null; then
  log "Installing Go..."
  curl -fsSL https://go.dev/dl/go1.22.10.linux-amd64.tar.gz -o /tmp/go.tar.gz
  tar -C /usr/local -xzf /tmp/go.tar.gz
  rm /tmp/go.tar.gz
fi
export PATH=$PATH:/usr/local/go/bin

cd agent
go mod tidy 2>/dev/null
go mod download 2>/dev/null
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build \
  -ldflags "-H windowsgui -s -w -X main.Version=1.0.0" \
  -o ../downloads/KamVDI-Setup.exe ./main.go
cd ..
log "Agent built"

# Download Boundary CLI for Windows (agent auto-downloads from portal)
if [[ ! -f downloads/boundary.exe ]]; then
  log "Downloading Boundary CLI for Windows..."
  BOUNDARY_VER="0.16.2"
  curl -fsSL "https://releases.hashicorp.com/boundary/${BOUNDARY_VER}/boundary_${BOUNDARY_VER}_windows_amd64.zip" \
    -o /tmp/boundary-win.zip
  apt-get install -y -qq unzip > /dev/null 2>&1 || true
  unzip -o /tmp/boundary-win.zip boundary.exe -d downloads/
  rm /tmp/boundary-win.zip
  log "Boundary CLI downloaded"
fi

# Version manifest for agent auto-updater
cat > downloads/version.json << VEOF
{"version":"1.0.0","min_version":"1.0.0","download_url":"/downloads/KamVDI-Setup.exe"}
VEOF

# ── Start ──────────────────────────────────────────────────
log "Starting services..."
docker compose up -d --build

log "Waiting for services..."
sleep 20

# ── NAT Gateway ───────────────────────────────────────────
if [[ "${ENABLE_NAT:-N}" =~ ^[Yy] ]]; then
  log "Configuring NAT gateway..."
  bash "$(dirname "$0")/setup-nat-gateway.sh" "${LAN_IFACE:-}" "${WAN_IFACE:-}"
fi

# ── Boundary Init ─────────────────────────────────────────
log "Initializing Boundary..."

# Create the boundary database (Boundary needs its own DB)
docker compose exec -T postgres psql -U kamvdi -d kamvdi -c "CREATE DATABASE boundary;" 2>/dev/null || true

# Stop the crashing Boundary container so we can run init cleanly
docker compose stop boundary 2>/dev/null || true

# Run boundary database init and capture the output
BOUNDARY_INIT_OUTPUT=$(docker run --rm \
  --network "$(basename $(pwd))_default" \
  -v "$(pwd)/boundary/config.hcl:/boundary/config.hcl:ro" \
  -e BOUNDARY_POSTGRES_URL="postgresql://kamvdi:${PG_PASS}@postgres:5432/boundary?sslmode=disable" \
  hashicorp/boundary:0.16 database init -config /boundary/config.hcl 2>&1) || true

# Parse the generated auth method ID, org ID, and admin password
BOUNDARY_AUTH_METHOD_ID=$(echo "$BOUNDARY_INIT_OUTPUT" | grep "Auth Method ID:" | head -1 | awk '{print $NF}')
BOUNDARY_ORG_ID=$(echo "$BOUNDARY_INIT_OUTPUT" | grep "Scope ID:" | head -1 | awk '{print $NF}')
BOUNDARY_GEN_PASSWORD=$(echo "$BOUNDARY_INIT_OUTPUT" | grep "Password:" | head -1 | awk '{print $NF}')
BOUNDARY_LOGIN_NAME=$(echo "$BOUNDARY_INIT_OUTPUT" | grep "Login Name:" | head -1 | awk '{print $NF}')
BOUNDARY_LOGIN_NAME=${BOUNDARY_LOGIN_NAME:-admin}

if [[ -n "$BOUNDARY_AUTH_METHOD_ID" ]]; then
  log "Boundary initialized (auth_method: ${BOUNDARY_AUTH_METHOD_ID}, org: ${BOUNDARY_ORG_ID})"

  # Reset the Boundary admin password to something safe (no special chars)
  BOUNDARY_SAFE_PASSWORD=$(openssl rand -hex 16)
  BOUNDARY_ACCT_ID=$(echo "$BOUNDARY_INIT_OUTPUT" | grep "Account ID:" | head -1 | awk '{print $NF}')

  if [[ -n "$BOUNDARY_ACCT_ID" ]]; then
    docker run --rm \
      --network "$(basename $(pwd))_default" \
      -v "$(pwd)/boundary/config.hcl:/boundary/config.hcl:ro" \
      -e BOUNDARY_POSTGRES_URL="postgresql://kamvdi:${PG_PASS}@postgres:5432/boundary?sslmode=disable" \
      -e NEWPW="${BOUNDARY_SAFE_PASSWORD}" \
      hashicorp/boundary:0.16 accounts set-password \
        -id "${BOUNDARY_ACCT_ID}" \
        -password "env://NEWPW" \
        -recovery-config /boundary/config.hcl > /dev/null 2>&1 && \
      log "Boundary admin password reset" || \
      BOUNDARY_SAFE_PASSWORD="${BOUNDARY_GEN_PASSWORD}"
  else
    BOUNDARY_SAFE_PASSWORD="${BOUNDARY_GEN_PASSWORD}"
  fi

  # Update .env with the generated Boundary values
  sed -i "s|^BOUNDARY_AUTH_METHOD_ID=.*|BOUNDARY_AUTH_METHOD_ID=${BOUNDARY_AUTH_METHOD_ID}|" .env
  sed -i "s|^BOUNDARY_ADMIN_LOGIN=.*|BOUNDARY_ADMIN_LOGIN=${BOUNDARY_LOGIN_NAME}|" .env
  sed -i "s|^BOUNDARY_ADMIN_PASSWORD=.*|BOUNDARY_ADMIN_PASSWORD=${BOUNDARY_SAFE_PASSWORD}|" .env
  sed -i "s|^BOUNDARY_ORG_ID=.*|BOUNDARY_ORG_ID=${BOUNDARY_ORG_ID}|" .env
else
  warn "Could not parse Boundary init output. Boundary proxy may need manual setup."
  warn "You can find init output in the install log."
fi

# Start Boundary again (now with initialized DB)
docker compose start boundary
sleep 5

# ── DB Init ────────────────────────────────────────────────
log "Initializing database..."
docker compose exec -T backend python -m alembic upgrade head

# Recreate backend & celery so they pick up the new Boundary env vars
# (docker compose restart does NOT reload .env — must recreate)
docker compose up -d --force-recreate backend celery
sleep 5

# ── First Admin ────────────────────────────────────────────
log "Creating admin account..."
docker compose exec -T backend python -c "
from app.database import get_db_sync
from app.models.user import User
from app.models.tenant import Tenant
from app.services.auth import hash_password
import uuid

db = get_db_sync()
try:
    # Create default tenant
    tenant = Tenant(
        id=uuid.uuid4(),
        name='Default',
        slug='default',
        suspend_threshold_minutes=${SUSPEND_MIN},
        max_session_hours=8,
    )
    db.add(tenant)
    db.flush()

    # Create admin user
    u = User(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email='${ADMIN_EMAIL}',
        password_hash=hash_password('${ADMIN_PASS}'),
        role='superadmin',
        must_change_password=True,
        mfa_enabled=False,
        is_active=True,
    )
    db.add(u)
    db.commit()
    print('Admin created')
except Exception as e:
    db.rollback()
    print(f'Error: {e}')
finally:
    db.close()
"

# ── Done ───────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║                                                      ║"
echo "║   KamVDI is ready!                                   ║"
echo "║                                                      ║"
echo "║   URL:       https://${PORTAL_DOMAIN}                ║"
echo "║   Email:     ${ADMIN_EMAIL}                          ║"
echo "║   Password:  ${ADMIN_PASS}                           ║"
echo "║                                                      ║"
echo "║   Change password on first login                     ║"
echo "║                                                      ║"
echo "║   Next: Login > Settings > Add CloudWM API keys      ║"
echo "║                                                      ║"
if [[ "${ENABLE_NAT:-N}" =~ ^[Yy] ]]; then
  GW_IP=$(ip -4 addr show "${LAN_IFACE:-}" 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -1)
  GW_IP=${GW_IP:-$SERVER_IP}
  echo "║   NAT Gateway: ENABLED                               ║"
  echo "║   Gateway IP:  ${GW_IP}$(printf '%*s' $((37 - ${#GW_IP})) '')║"
  echo "║   Set Windows VM gateway to this IP                  ║"
  echo "║                                                      ║"
fi
echo "╚══════════════════════════════════════════════════════╝"
echo ""
