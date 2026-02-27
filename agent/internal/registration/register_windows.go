//go:build windows

package registration

import (
	"fmt"
	"os"
	"path/filepath"

	"golang.org/x/sys/windows/registry"
)

func registerWindows() error {
	exePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("failed to get executable path: %w", err)
	}
	exePath, _ = filepath.Abs(exePath)

	// Use HKCU\Software\Classes instead of HKCR — no admin rights needed
	key, _, err := registry.CreateKey(
		registry.CURRENT_USER,
		`Software\Classes\kamvdi`,
		registry.ALL_ACCESS,
	)
	if err != nil {
		return fmt.Errorf("failed to create registry key: %w", err)
	}
	defer key.Close()

	key.SetStringValue("", "URL:KamVDI Protocol")
	key.SetStringValue("URL Protocol", "")

	// Create shell\open\command
	cmdKey, _, err := registry.CreateKey(
		registry.CURRENT_USER,
		`Software\Classes\kamvdi\shell\open\command`,
		registry.ALL_ACCESS,
	)
	if err != nil {
		return fmt.Errorf("failed to create command key: %w", err)
	}
	defer cmdKey.Close()

	cmdKey.SetStringValue("", fmt.Sprintf(`"%s" "%%1"`, exePath))

	// DefaultIcon
	iconKey, _, err := registry.CreateKey(
		registry.CURRENT_USER,
		`Software\Classes\kamvdi\DefaultIcon`,
		registry.ALL_ACCESS,
	)
	if err == nil {
		defer iconKey.Close()
		iconKey.SetStringValue("", fmt.Sprintf(`"%s",0`, exePath))
	}

	return nil
}

func unregisterWindows() error {
	registry.DeleteKey(registry.CURRENT_USER, `Software\Classes\kamvdi\shell\open\command`)
	registry.DeleteKey(registry.CURRENT_USER, `Software\Classes\kamvdi\shell\open`)
	registry.DeleteKey(registry.CURRENT_USER, `Software\Classes\kamvdi\shell`)
	registry.DeleteKey(registry.CURRENT_USER, `Software\Classes\kamvdi\DefaultIcon`)
	registry.DeleteKey(registry.CURRENT_USER, `Software\Classes\kamvdi`)
	return nil
}
