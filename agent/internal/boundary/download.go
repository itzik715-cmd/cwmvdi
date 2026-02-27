package boundary

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
)

// EnsureBinary checks if boundary.exe exists next to the agent.
// If not, downloads it from the portal server.
func EnsureBinary(portalURL string) (string, error) {
	exePath, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("cannot determine executable path: %w", err)
	}
	dir := filepath.Dir(exePath)
	binPath := filepath.Join(dir, "boundary.exe")

	if _, err := os.Stat(binPath); err == nil {
		return binPath, nil // Already exists
	}

	// Download from portal
	downloadURL := portalURL + "/downloads/boundary.exe"
	log.Printf("Downloading Boundary CLI from %s ...", downloadURL)

	resp, err := http.Get(downloadURL)
	if err != nil {
		return "", fmt.Errorf("download failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("download returned HTTP %d", resp.StatusCode)
	}

	tmpPath := binPath + ".tmp"
	f, err := os.Create(tmpPath)
	if err != nil {
		return "", fmt.Errorf("cannot create file: %w", err)
	}

	if _, err := io.Copy(f, resp.Body); err != nil {
		f.Close()
		os.Remove(tmpPath)
		return "", fmt.Errorf("download interrupted: %w", err)
	}
	f.Close()

	if err := os.Rename(tmpPath, binPath); err != nil {
		return "", fmt.Errorf("cannot save boundary.exe: %w", err)
	}

	log.Printf("Boundary CLI downloaded to %s", binPath)
	return binPath, nil
}
