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

	// Create HKEY_CLASSES_ROOT\kamvdi
	key, _, err := registry.CreateKey(
		registry.CLASSES_ROOT,
		`kamvdi`,
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
		registry.CLASSES_ROOT,
		`kamvdi\shell\open\command`,
		registry.ALL_ACCESS,
	)
	if err != nil {
		return fmt.Errorf("failed to create command key: %w", err)
	}
	defer cmdKey.Close()

	// Set command: "C:\Program Files\KamVDI\kamvdi-agent.exe" "%1"
	cmdKey.SetStringValue("", fmt.Sprintf(`"%s" "%%1"`, exePath))

	// DefaultIcon
	iconKey, _, err := registry.CreateKey(
		registry.CLASSES_ROOT,
		`kamvdi\DefaultIcon`,
		registry.ALL_ACCESS,
	)
	if err == nil {
		defer iconKey.Close()
		iconKey.SetStringValue("", fmt.Sprintf(`"%s",0`, exePath))
	}

	return nil
}

func unregisterWindows() error {
	err := registry.DeleteKey(registry.CLASSES_ROOT, `kamvdi\shell\open\command`)
	if err != nil {
		// Ignore if key doesn't exist
	}
	registry.DeleteKey(registry.CLASSES_ROOT, `kamvdi\shell\open`)
	registry.DeleteKey(registry.CLASSES_ROOT, `kamvdi\shell`)
	registry.DeleteKey(registry.CLASSES_ROOT, `kamvdi\DefaultIcon`)
	registry.DeleteKey(registry.CLASSES_ROOT, `kamvdi`)
	return nil
}
