package config

// AgentVersion is set at build time via ldflags or from main.
var AgentVersion = "dev"

const (
	// URIScheme is the custom protocol scheme.
	URIScheme = "kamvdi"

	// HeartbeatInterval is how often the agent pings the portal.
	HeartbeatIntervalSec = 60

	// UpdateCheckIntervalHours controls auto-update polling.
	UpdateCheckIntervalHours = 24

	// BoundaryBinary is the expected name of the Boundary CLI.
	BoundaryBinary = "boundary"
)
