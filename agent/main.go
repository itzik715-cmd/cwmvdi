package main

import (
	"fmt"
	"os"
	"strings"

	"github.com/itzik715-cmd/kamatera-vdi/agent/internal/config"
	"github.com/itzik715-cmd/kamatera-vdi/agent/internal/health"
	"github.com/itzik715-cmd/kamatera-vdi/agent/internal/registration"
	"github.com/itzik715-cmd/kamatera-vdi/agent/internal/tray"
	"github.com/itzik715-cmd/kamatera-vdi/agent/internal/urihandler"
)

var Version = "1.0.0"

func main() {
	config.AgentVersion = Version

	// Handle CLI flags
	if len(os.Args) > 1 {
		arg := os.Args[1]

		switch {
		case strings.HasPrefix(arg, "kamvdi://"):
			// Launched by browser via URI scheme
			params, err := urihandler.ParseKamVDIUri(arg)
			if err != nil {
				fmt.Fprintf(os.Stderr, "Error parsing URI: %v\n", err)
				os.Exit(1)
			}
			if err := urihandler.HandleConnect(params); err != nil {
				fmt.Fprintf(os.Stderr, "Connection failed: %v\n", err)
				os.Exit(1)
			}
			return

		case arg == "--register":
			// Register kamvdi:// URI scheme
			if err := registration.RegisterURIScheme(); err != nil {
				fmt.Fprintf(os.Stderr, "Registration failed: %v\n", err)
				os.Exit(1)
			}
			fmt.Println("URI scheme registered successfully")
			return

		case arg == "--unregister":
			if err := registration.UnregisterURIScheme(); err != nil {
				fmt.Fprintf(os.Stderr, "Unregistration failed: %v\n", err)
				os.Exit(1)
			}
			fmt.Println("URI scheme unregistered")
			return

		case arg == "--version":
			fmt.Printf("KamVDI Agent %s\n", Version)
			return
		}
	}

	// Auto-register URI scheme on every startup (idempotent, no admin needed)
	if err := registration.RegisterURIScheme(); err != nil {
		fmt.Fprintf(os.Stderr, "Warning: URI scheme registration failed: %v\n", err)
	}

	// Start local health server so the browser can detect the agent
	health.Start()

	// Default: run as system tray application
	tray.Run()
}
