package updater

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/itzik715-cmd/kamatera-vdi/agent/internal/config"
	"github.com/itzik715-cmd/kamatera-vdi/agent/internal/notify"
)

type versionInfo struct {
	Version    string `json:"version"`
	MinVersion string `json:"min_version"`
	DownloadURL string `json:"download_url,omitempty"`
}

// StartBackgroundCheck periodically checks for agent updates.
// portalURL is the base URL of the KamVDI portal.
func StartBackgroundCheck(portalURL string) {
	if portalURL == "" {
		return
	}

	go func() {
		// Wait a bit before first check
		time.Sleep(30 * time.Second)

		ticker := time.NewTicker(time.Duration(config.UpdateCheckIntervalHours) * time.Hour)
		defer ticker.Stop()

		check(portalURL)

		for range ticker.C {
			check(portalURL)
		}
	}()
}

func check(portalURL string) {
	url := fmt.Sprintf("%s/downloads/version.json", portalURL)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		log.Printf("Update check failed: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return
	}

	var info versionInfo
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		log.Printf("Update check: invalid response: %v", err)
		return
	}

	if info.Version != config.AgentVersion {
		msg := fmt.Sprintf("A new version (%s) is available. You are running %s.",
			info.Version, config.AgentVersion)
		if info.DownloadURL != "" {
			msg += fmt.Sprintf("\nDownload: %s", info.DownloadURL)
		}
		notify.Show("KamVDI Update", msg)
	}
}
