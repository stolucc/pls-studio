//go:build !darwin && !windows

// Platforms without a portable tray (Linux): run headless. Same signature as
// tray.go so main.go can call it unconditionally.

package main

import (
	"context"
	"log"
)

func runWithTray(_ *config, _ *server, serve func(), logger *log.Logger, _ context.CancelFunc) {
	logger.Printf("tray UI is not supported on this OS; running headless (use a systemd user service to start at login).")
	serve()
}

func quitTray() {}

// askConnect: no dialog without a tray (connect.go explains the alternatives).
func askConnect(string) (bool, error) { return false, errNoApprover }
