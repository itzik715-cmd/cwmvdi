//go:build windows

package notify

import (
	"log"
	"os/exec"
)

func showPlatform(title, message string) {
	script := `
	[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
	[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
	$template = '<toast><visual><binding template="ToastText02"><text id="1">` + title + `</text><text id="2">` + message + `</text></binding></visual></toast>'
	$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
	$xml.LoadXml($template)
	$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
	[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("KamVDI").Show($toast)
	`
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", script)
	if err := cmd.Run(); err != nil {
		log.Printf("Toast notification failed: %v", err)
	}
}
