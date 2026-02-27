package notify

import (
	"log"
	"runtime"
)

// Show displays a system notification.
func Show(title, message string) {
	log.Printf("[%s] %s", title, message)

	switch runtime.GOOS {
	case "windows":
		showWindows(title, message)
	case "darwin":
		showMac(title, message)
	default:
		// Fallback: just log
	}
}
