package boundary

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os/exec"
	"strings"

	"github.com/itzik715-cmd/kamatera-vdi/agent/internal/config"
)

// connectOutput represents the JSON output from `boundary connect`.
type connectOutput struct {
	Address    string `json:"address"`
	Port       int    `json:"port"`
	SessionID  string `json:"session_id"`
	Protocol   string `json:"protocol"`
	Expiration string `json:"expiration"`
}

// ConnectRDP starts `boundary connect rdp` and returns the local port.
// The returned *exec.Cmd must be monitored; when it exits the tunnel is closed.
func ConnectRDP(authzToken string) (int, *exec.Cmd, error) {
	binPath, err := exec.LookPath(config.BoundaryBinary)
	if err != nil {
		return 0, nil, fmt.Errorf(
			"boundary CLI not found in PATH — install from https://www.boundaryproject.io/downloads: %w", err,
		)
	}

	cmd := exec.Command(binPath,
		"connect", "rdp",
		"-authz-token", authzToken,
		"-listen-port", "0", // OS picks a free port
		"-format", "json",
	)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return 0, nil, fmt.Errorf("failed to get stdout pipe: %w", err)
	}

	// Capture stderr for diagnostics
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return 0, nil, fmt.Errorf("failed to get stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return 0, nil, fmt.Errorf("failed to start boundary: %w", err)
	}

	// Read the first line of JSON output to get the port
	port, err := extractPort(stdout)
	if err != nil {
		// Try reading stderr for error details
		errMsg := readFirstLine(stderr)
		cmd.Process.Kill()
		return 0, nil, fmt.Errorf("failed to get port from boundary: %w (stderr: %s)", err, errMsg)
	}

	return port, cmd, nil
}

// extractPort reads JSON output from boundary connect and returns the local port.
func extractPort(r io.Reader) (int, error) {
	scanner := bufio.NewScanner(r)
	var accumulated strings.Builder

	for scanner.Scan() {
		line := scanner.Text()
		accumulated.WriteString(line)

		// Try to parse accumulated text as JSON
		var output connectOutput
		if err := json.Unmarshal([]byte(accumulated.String()), &output); err == nil {
			if output.Port > 0 {
				return output.Port, nil
			}
			return 0, fmt.Errorf("boundary returned port 0")
		}
	}

	if err := scanner.Err(); err != nil {
		return 0, fmt.Errorf("error reading boundary output: %w", err)
	}

	return 0, fmt.Errorf("boundary exited without providing port information")
}

func readFirstLine(r io.Reader) string {
	scanner := bufio.NewScanner(r)
	if scanner.Scan() {
		return scanner.Text()
	}
	return ""
}
