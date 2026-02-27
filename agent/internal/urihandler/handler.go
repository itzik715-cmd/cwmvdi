package urihandler

import (
	"fmt"
	"net/url"

	"github.com/itzik715-cmd/kamatera-vdi/agent/internal/boundary"
	"github.com/itzik715-cmd/kamatera-vdi/agent/internal/heartbeat"
	"github.com/itzik715-cmd/kamatera-vdi/agent/internal/notify"
	"github.com/itzik715-cmd/kamatera-vdi/agent/internal/rdp"
)

// ConnectParams holds the parsed kamvdi:// URI parameters.
type ConnectParams struct {
	Token       string
	WorkerAddr  string
	SessionID   string
	DesktopName string
	PortalURL   string
}

// ParseKamVDIUri parses a kamvdi://connect?token=xxx&worker=yyy&session=zzz URI.
func ParseKamVDIUri(rawURI string) (*ConnectParams, error) {
	u, err := url.Parse(rawURI)
	if err != nil {
		return nil, fmt.Errorf("invalid URI: %w", err)
	}

	params := u.Query()
	token := params.Get("token")
	if token == "" {
		return nil, fmt.Errorf("missing required parameter: token")
	}

	return &ConnectParams{
		Token:       token,
		WorkerAddr:  params.Get("worker"),
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

	// 2. Start Boundary tunnel (auto-downloads boundary.exe if needed)
	notify.Show("KamVDI", "Establishing secure tunnel...")
	localPort, cmd, err := boundary.ConnectRDP(params.Token, params.WorkerAddr, params.PortalURL)
	if err != nil {
		notify.Show("KamVDI Error", fmt.Sprintf("Failed to establish tunnel: %v", err))
		return fmt.Errorf("boundary connect failed: %w", err)
	}

	// 3. Launch RDP client
	if err := rdp.LaunchDirect("127.0.0.1", localPort); err != nil {
		notify.Show("KamVDI Error", fmt.Sprintf("Failed to launch RDP client: %v", err))
		if cmd != nil && cmd.Process != nil {
			cmd.Process.Kill()
		}
		return fmt.Errorf("RDP launch failed: %w", err)
	}

	notify.Show("KamVDI", fmt.Sprintf("Connected to %s", name))

	// 4. Start heartbeat in foreground (blocks until boundary exits)
	done := make(chan struct{})

	go func() {
		if cmd != nil {
			cmd.Wait()
		}
		close(done)
	}()

	heartbeat.Start(params.SessionID, params.PortalURL, done)

	notify.Show("KamVDI", fmt.Sprintf("Disconnected from %s", name))
	return nil
}
