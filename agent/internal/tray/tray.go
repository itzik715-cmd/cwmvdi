package tray

import (
	"fmt"
	"sync/atomic"

	"fyne.io/systray"
	"github.com/itzik715-cmd/kamatera-vdi/agent/internal/config"
	"github.com/itzik715-cmd/kamatera-vdi/agent/internal/notify"
)

var activeSessions atomic.Int32

// IncrementSessions increases the active session counter.
func IncrementSessions() {
	activeSessions.Add(1)
}

// DecrementSessions decreases the active session counter.
func DecrementSessions() {
	activeSessions.Add(-1)
}

// Run starts the system tray application. Blocks until quit.
func Run() {
	systray.Run(onReady, onExit)
}

func onReady() {
	systray.SetIcon(getIcon())
	systray.SetTitle("KamVDI")
	systray.SetTooltip("KamVDI - Virtual Desktop Infrastructure")

	mStatus := systray.AddMenuItem("Status: Ready", "Agent is running")
	mStatus.Disable()

	systray.AddSeparator()

	mSessions := systray.AddMenuItem("Active Sessions: 0", "")
	mSessions.Disable()

	systray.AddSeparator()

	mAbout := systray.AddMenuItem("About KamVDI", "Show version info")
	mQuit := systray.AddMenuItem("Quit", "Exit KamVDI Agent")

	go func() {
		for {
			select {
			case <-mAbout.ClickedCh:
				notify.Show("KamVDI Agent",
					fmt.Sprintf("Version %s\nhttps://github.com/itzik715-cmd/kamatera-vdi",
						config.AgentVersion))
			case <-mQuit.ClickedCh:
				systray.Quit()
			}
		}
	}()

	// Periodically update session count display
	go func() {
		var last int32 = -1
		for {
			current := activeSessions.Load()
			if current != last {
				mSessions.SetTitle(fmt.Sprintf("Active Sessions: %d", current))
				last = current
			}
		}
	}()
}

func onExit() {
	// Cleanup on quit
}
