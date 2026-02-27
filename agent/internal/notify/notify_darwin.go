//go:build darwin

package notify

import (
	"log"
	"os/exec"
)

func showPlatform(title, message string) {
	script := `display notification "` + message + `" with title "` + title + `"`
	cmd := exec.Command("osascript", "-e", script)
	if err := cmd.Run(); err != nil {
		log.Printf("Mac notification failed: %v", err)
	}
}
