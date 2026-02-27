package notify

import "log"

// Show displays a system notification.
func Show(title, message string) {
	log.Printf("[%s] %s", title, message)
	showPlatform(title, message)
}
