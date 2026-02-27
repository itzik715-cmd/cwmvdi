package rdp

import (
	"fmt"
	"os/exec"
	"runtime"
)

// LaunchDirect opens the native RDP client connecting to a remote host directly.
func LaunchDirect(host string, port int) error {
	switch runtime.GOOS {
	case "windows":
		return launchWindowsDirect(host, port)
	case "darwin":
		return launchMacDirect(host, port)
	default:
		return fmt.Errorf("unsupported OS: %s", runtime.GOOS)
	}
}

func launchWindowsDirect(host string, port int) error {
	addr := fmt.Sprintf("/v:%s:%d", host, port)
	cmd := exec.Command("mstsc", addr)
	return cmd.Start()
}

func launchMacDirect(host string, port int) error {
	uri := fmt.Sprintf("rdp://full%%20address=s:%s:%d", host, port)
	cmd := exec.Command("open", uri)
	return cmd.Start()
}
