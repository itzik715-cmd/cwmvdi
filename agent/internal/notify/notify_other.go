//go:build !windows && !darwin

package notify

func showPlatform(_, _ string) {
	// No-op on unsupported platforms; already logged in Show()
}
