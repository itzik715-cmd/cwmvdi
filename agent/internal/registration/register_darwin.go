//go:build darwin

package registration

// On macOS, registration is handled via the app bundle's Info.plist.
// These are no-ops because the build process creates the bundle.

func registerWindows() error  { return nil }
func unregisterWindows() error { return nil }
