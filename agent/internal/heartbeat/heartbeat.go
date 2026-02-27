package heartbeat

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/itzik715-cmd/kamatera-vdi/agent/internal/config"
)

type heartbeatPayload struct {
	SessionID    string `json:"session_id"`
	AgentVersion string `json:"agent_version,omitempty"`
}

// Start sends heartbeat requests to the portal every HeartbeatIntervalSec.
// It blocks until the done channel is closed.
func Start(sessionID, portalURL string, done <-chan struct{}) {
	if sessionID == "" || portalURL == "" {
		log.Println("Heartbeat: missing session ID or portal URL, skipping")
		return
	}

	ticker := time.NewTicker(time.Duration(config.HeartbeatIntervalSec) * time.Second)
	defer ticker.Stop()

	// Send an initial heartbeat immediately
	send(sessionID, portalURL)

	for {
		select {
		case <-ticker.C:
			send(sessionID, portalURL)
		case <-done:
			sendDisconnect(sessionID, portalURL)
			return
		}
	}
}

func send(sessionID, portalURL string) {
	url := fmt.Sprintf("%s/api/desktops/heartbeat", portalURL)
	payload := heartbeatPayload{
		SessionID:    sessionID,
		AgentVersion: config.AgentVersion,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		log.Printf("Heartbeat: marshal error: %v", err)
		return
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		log.Printf("Heartbeat: send error: %v", err)
		return
	}
	resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("Heartbeat: server returned %d", resp.StatusCode)
	}
}

func sendDisconnect(sessionID, portalURL string) {
	url := fmt.Sprintf("%s/api/desktops/%s/disconnect", portalURL, sessionID)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Post(url, "application/json", nil)
	if err != nil {
		log.Printf("Disconnect: send error: %v", err)
		return
	}
	resp.Body.Close()
	log.Printf("Disconnect: sent for session %s", sessionID)
}
