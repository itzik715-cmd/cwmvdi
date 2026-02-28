# CwmVDI — Virtual Desktop Infrastructure

Enables Kamatera customers to provide Windows cloud desktops to their users,
accessible via native RDP with MFA and full security.

## Quick Install

```bash
git clone https://github.com/itzik715-cmd/cwmvdi.git
cd cwmvdi
sudo ./scripts/install.sh
```

### Requirements
- Ubuntu 22.04+
- 4 CPU, 8GB RAM, 50GB SSD
- Public IP
- Kamatera account with API credentials

## Post-Install Flow

1. Log in to the portal with the credentials shown at the end of installation
2. Change password and set up MFA
3. **Settings → CloudWM API** — Enter API credentials
4. **Users** — Create users
5. **Desktops** — Create Windows VMs and assign to users
6. Users connect via browser (Guacamole) or download an .rdp file for native RDP

## NAT Gateway

CwmVDI can act as a NAT gateway, routing all Windows VM internet traffic through the proxy server. VMs are placed on a private VLAN with no public IP — the proxy handles all outbound NAT.

```
[Internet / WAN]
       |
  [CwmVDI Proxy] ← public IP + private LAN IP
   iptables NAT    (IP forwarding + masquerade)
       |
  [Private VLAN]
       |
  [Win VM 1] [Win VM 2] [Win VM 3] ...
  (GW = proxy LAN IP, no public IP)
```

The installer prompts to enable NAT gateway. You can also configure it in **Settings → NAT Gateway** after install. No traffic limits are applied — all outbound traffic is NATed without restrictions.

To set up manually: `sudo ./scripts/setup-nat-gateway.sh [LAN_IFACE] [WAN_IFACE]`

## Architecture

```
[User Browser] → [Portal] → [Guacamole/guacd] → [Windows VM RDP]
                    ↓
              [.rdp file download] → native mstsc via socat proxy
```

## Project Structure

```
cwmvdi/
├── scripts/install.sh    ← entry point
├── docker-compose.yml
├── backend/              ← FastAPI
├── frontend/             ← React
└── nginx/
```
