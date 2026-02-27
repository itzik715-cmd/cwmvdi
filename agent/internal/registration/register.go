package registration

import (
	"fmt"
	"runtime"
)

// RegisterURIScheme registers the kamvdi:// custom URI scheme with the OS.
func RegisterURIScheme() error {
	switch runtime.GOOS {
	case "windows":
		return registerWindows()
	case "darwin":
		// Mac registration is handled via Info.plist in the app bundle
		fmt.Println("On macOS, URI scheme is registered via Info.plist in the app bundle.")
		return nil
	default:
		return fmt.Errorf("unsupported OS: %s", runtime.GOOS)
	}
}

// UnregisterURIScheme removes the kamvdi:// custom URI scheme.
func UnregisterURIScheme() error {
	switch runtime.GOOS {
	case "windows":
		return unregisterWindows()
	case "darwin":
		fmt.Println("On macOS, remove the app bundle to unregister the URI scheme.")
		return nil
	default:
		return fmt.Errorf("unsupported OS: %s", runtime.GOOS)
	}
}
