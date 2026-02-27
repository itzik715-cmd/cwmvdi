package urihandler

import (
	"fmt"
	"net/url"

	"github.com/itzik715-cmd/kamatera-vdi/agent/internal/heartbeat"
	"github.com/itzik715-cmd/kamatera-vdi/agent/internal/notify"
	"github.com/itzik715-cmd/kamatera-vdi/agent/internal/rdp"
)

// ConnectParams holds the parsed kamvdi:// URI parameters.
type ConnectParams struct {
	Host        string
	SessionID   string
	DesktopName string
	PortalURL   string
}

// ParseKamVDIUri parses a kamvdi://connect?host=x.x.x.x&session=yyy&name=zzz URI.
func ParseKamVDIUri(rawURI string) (*ConnectParams, error) {
	u, err := url.Parse(rawURI)
	if err != nil {
		return nil, fmt.Errorf("invalid URI: %w", err)
	}

	params := u.Query()
	host := params.Get("host")
	if host == "" {
		return nil, fmt.Errorf("missing required parameter: host")
	}

	return &ConnectParams{
		Host:        host,
		SessionID:   params.Get("session"),
		DesktopName: params.Get("name"),
		PortalURL:   params.Get("portal"),
	}, nil
}

// HandleConnect processes a kamvdi:// connect request end-to-end.
func HandleConnect(params *ConnectParams) error {
	name := params.DesktopName
	if name == "" {
		name = "Desktop"
	}

	// 1. Notify user
	notify.Show("KamVDI", fmt.Sprintf("Connecting to %s...", name))

	// 2. Launch RDP client directly to the VM
	if err := rdp.LaunchDirect(params.Host, 3389); err != nil {
		notify.Show("KamVDI Error", fmt.Sprintf("Failed to launch RDP: %v", err))
		return fmt.Errorf("RDP launch failed: %w", err)
	}

	notify.Show("KamVDI", fmt.Sprintf("Connected to %s", name))

	// 3. Start heartbeat (blocks until stopped)
	done := make(chan struct{})
	heartbeat.Start(params.SessionID, params.PortalURL, done)

	notify.Show("KamVDI", fmt.Sprintf("Disconnected from %s", name))
	return nil
}
