//go:build windows

package notify

import (
	"log"

	"github.com/go-toast/toast"
)

func showWindows(title, message string) {
	notification := toast.Notification{
		AppID:   "KamVDI",
		Title:   title,
		Message: message,
	}
	if err := notification.Push(); err != nil {
		log.Printf("Toast notification failed: %v", err)
	}
}
