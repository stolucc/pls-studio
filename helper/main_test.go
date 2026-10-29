package main

import (
	"os"
	"testing"
)

// TestMain points HOME at a temporary directory, so tests that touch the
// config directory (pairing lock file, config) never use the real one.
func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "pls-studio-helper-test-")
	if err != nil {
		panic(err)
	}
	os.Setenv("HOME", dir)
	os.Setenv("USERPROFILE", dir)
	code := m.Run()
	os.RemoveAll(dir)
	os.Exit(code)
}

func fileExists(p string) bool { _, err := os.Stat(p); return err == nil }
