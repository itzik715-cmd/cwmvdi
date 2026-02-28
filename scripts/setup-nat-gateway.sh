#!/bin/bash
set -euo pipefail

# ── CwmVDI NAT Gateway Setup ─────────────────────────────────────
# Configures this server as a NAT gateway so Windows VMs on the
# private VLAN can route all internet traffic through it.
#
# Usage: sudo ./scripts/setup-nat-gateway.sh [LAN_INTERFACE] [WAN_INTERFACE]
#
# If interfaces are not specified, the script auto-detects them.
# ──────────────────────────────────────────────────────────────────

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()   { echo -e "${GREEN}[NAT-GW]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
fatal() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

[[ $EUID -ne 0 ]] && fatal "Run as root: sudo $0"

# ── Detect network interfaces ────────────────────────────────────
WAN_IFACE="${2:-}"
LAN_IFACE="${1:-}"

if [[ -z "$WAN_IFACE" ]]; then
    # WAN interface = the one with the default route
    WAN_IFACE=$(ip route show default | awk '{print $5}' | head -1)
    [[ -z "$WAN_IFACE" ]] && fatal "Cannot detect WAN interface. Specify manually: $0 <LAN_IFACE> <WAN_IFACE>"
    log "Auto-detected WAN interface: ${WAN_IFACE}"
fi

if [[ -z "$LAN_IFACE" ]]; then
    # LAN interface = any interface that is NOT the WAN and NOT loopback/docker/veth
    LAN_IFACE=$(ip -o link show | awk -F': ' '{print $2}' \
        | grep -v -E "^(lo|docker|veth|br-|${WAN_IFACE})$" \
        | head -1)
    if [[ -z "$LAN_IFACE" ]]; then
        warn "No separate LAN interface detected. If this server has a single NIC,"
        warn "the private VLAN traffic may arrive on the same interface (${WAN_IFACE})."
        warn "NAT masquerade will still work for private subnet traffic."
        LAN_IFACE="$WAN_IFACE"
    else
        log "Auto-detected LAN interface: ${LAN_IFACE}"
    fi
fi

# Get the LAN IP of this server (for Windows VMs to use as gateway)
LAN_IP=$(ip -4 addr show "$LAN_IFACE" | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -1)
if [[ -z "$LAN_IP" && "$LAN_IFACE" != "$WAN_IFACE" ]]; then
    fatal "No IP address found on LAN interface ${LAN_IFACE}"
fi

# Try to detect the private subnet
LAN_SUBNET=$(ip -4 addr show "$LAN_IFACE" | grep -oP '\d+(\.\d+){3}/\d+' | head -1)

log "Configuration:"
log "  WAN interface: ${WAN_IFACE}"
log "  LAN interface: ${LAN_IFACE}"
log "  LAN IP:        ${LAN_IP:-N/A}"
log "  LAN subnet:    ${LAN_SUBNET:-N/A}"

# ── Enable IP forwarding ─────────────────────────────────────────
log "Enabling IP forwarding..."

# Enable immediately
sysctl -w net.ipv4.ip_forward=1 > /dev/null

# Make persistent across reboots
if grep -q "^net.ipv4.ip_forward" /etc/sysctl.conf 2>/dev/null; then
    sed -i 's/^net.ipv4.ip_forward.*/net.ipv4.ip_forward = 1/' /etc/sysctl.conf
else
    echo "net.ipv4.ip_forward = 1" >> /etc/sysctl.conf
fi

# Also set in sysctl.d for robustness
cat > /etc/sysctl.d/99-cwmvdi-nat.conf << 'EOF'
# CwmVDI NAT Gateway - enable IP forwarding
net.ipv4.ip_forward = 1
EOF

sysctl --system > /dev/null 2>&1
log "IP forwarding enabled"

# ── Configure iptables NAT ───────────────────────────────────────
log "Configuring iptables NAT rules..."

# Install iptables-persistent for rule persistence
export DEBIAN_FRONTEND=noninteractive
apt-get install -y -qq iptables-persistent > /dev/null 2>&1 || true

# NAT: Masquerade all traffic from private networks going out WAN
# This covers all RFC1918 private ranges that Kamatera VLANs may use
iptables -t nat -C POSTROUTING -o "$WAN_IFACE" -s 10.0.0.0/8 -j MASQUERADE 2>/dev/null \
    || iptables -t nat -A POSTROUTING -o "$WAN_IFACE" -s 10.0.0.0/8 -j MASQUERADE

iptables -t nat -C POSTROUTING -o "$WAN_IFACE" -s 172.16.0.0/12 -j MASQUERADE 2>/dev/null \
    || iptables -t nat -A POSTROUTING -o "$WAN_IFACE" -s 172.16.0.0/12 -j MASQUERADE

iptables -t nat -C POSTROUTING -o "$WAN_IFACE" -s 192.168.0.0/16 -j MASQUERADE 2>/dev/null \
    || iptables -t nat -A POSTROUTING -o "$WAN_IFACE" -s 192.168.0.0/16 -j MASQUERADE

# FORWARD: Allow forwarded traffic from private networks (no restrictions)
iptables -C FORWARD -s 10.0.0.0/8 -j ACCEPT 2>/dev/null \
    || iptables -A FORWARD -s 10.0.0.0/8 -j ACCEPT

iptables -C FORWARD -s 172.16.0.0/12 -j ACCEPT 2>/dev/null \
    || iptables -A FORWARD -s 172.16.0.0/12 -j ACCEPT

iptables -C FORWARD -s 192.168.0.0/16 -j ACCEPT 2>/dev/null \
    || iptables -A FORWARD -s 192.168.0.0/16 -j ACCEPT

# Allow established/related connections back
iptables -C FORWARD -m state --state ESTABLISHED,RELATED -j ACCEPT 2>/dev/null \
    || iptables -A FORWARD -m state --state ESTABLISHED,RELATED -j ACCEPT

log "iptables NAT rules configured"

# ── Save iptables rules ──────────────────────────────────────────
log "Saving iptables rules for persistence..."
mkdir -p /etc/iptables
iptables-save > /etc/iptables/rules.v4 2>/dev/null || true

# Also create a systemd service to restore rules on boot
cat > /etc/systemd/system/cwmvdi-nat.service << 'UNIT'
[Unit]
Description=CwmVDI NAT Gateway Rules
After=network-pre.target
Before=network.target docker.service

[Service]
Type=oneshot
ExecStart=/sbin/sysctl -w net.ipv4.ip_forward=1
ExecStart=/sbin/iptables-restore /etc/iptables/rules.v4
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable cwmvdi-nat.service > /dev/null 2>&1
log "NAT rules will persist across reboots"

# ── Summary ───────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║           NAT Gateway Configured Successfully           ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║                                                          ║"
echo "║  WAN interface:  ${WAN_IFACE}$(printf '%*s' $((28 - ${#WAN_IFACE})) '')║"
echo "║  LAN interface:  ${LAN_IFACE}$(printf '%*s' $((28 - ${#LAN_IFACE})) '')║"
if [[ -n "$LAN_IP" ]]; then
echo "║  Gateway IP:     ${LAN_IP}$(printf '%*s' $((28 - ${#LAN_IP})) '')║"
fi
echo "║                                                          ║"
echo "║  Set Windows VMs default gateway to: ${LAN_IP:-<LAN_IP>}$(printf '%*s' $((13 - ${#LAN_IP:-8})) '')║"
echo "║  All outbound traffic will NAT through WAN               ║"
echo "║  No traffic limits applied                               ║"
echo "║                                                          ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
