# KamVDI — Virtual Desktop Infrastructure

Enables Kamatera customers to provide Windows cloud desktops to their users,
accessible via native RDP with MFA and full security.

## Quick Install

```bash
git clone https://github.com/itzik715-cmd/kamvdi.git
cd kamvdi
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
6. Users download the KamVDI Agent and connect

## Architecture

```
[User Browser] → [Portal] → [Boundary] → [Windows VM - private network]
                    ↓
              [KamVDI Agent] → mstsc
```

## Project Structure

```
kamvdi/
├── scripts/install.sh    ← entry point
├── docker-compose.yml
├── backend/              ← FastAPI
├── frontend/             ← React
├── agent/                ← Go binary
└── nginx/
```
