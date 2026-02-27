package rdp

import (
	"fmt"
	"os/exec"
	"runtime"
)

// Launch opens the native RDP client pointing at the local Boundary tunnel port.
func Launch(port int) error {
	switch runtime.GOOS {
	case "windows":
		return launchWindows(port)
	case "darwin":
		return launchMac(port)
	default:
		return fmt.Errorf("unsupported OS: %s", runtime.GOOS)
	}
}

func launchWindows(port int) error {
	addr := fmt.Sprintf("/v:127.0.0.1:%d", port)
	cmd := exec.Command("mstsc", addr)
	return cmd.Start()
}

func launchMac(port int) error {
	// Microsoft Remote Desktop on Mac uses rdp:// URI scheme
	uri := fmt.Sprintf("rdp://full%%20address=s:127.0.0.1:%d", port)
	cmd := exec.Command("open", uri)
	return cmd.Start()
}
