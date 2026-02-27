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

# ── Start ──────────────────────────────────────────────────
log "Starting services..."
docker compose up -d --build

log "Waiting for services..."
sleep 20

# ── DB Init ────────────────────────────────────────────────
log "Initializing database..."
docker compose exec -T backend python -m alembic upgrade head

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
echo "╚══════════════════════════════════════════════════════╝"
echo ""
