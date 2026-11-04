//go:build windows

package main

import (
	"os"
	"os/exec"
	"path/filepath"
)

// installBinary: Windows will not overwrite a running .exe, but renames it:
// the old binary moves aside (removed on the next start, cleanupAfterUpdate)
// and the new one takes its name.
func installBinary(exe string, data []byte) error {
	tmp, err := writeBeside(filepath.Dir(exe), data)
	if err != nil {
		return err
	}
	old := exe + ".old"
	_ = os.Remove(old)
	if err := os.Rename(exe, old); err != nil {
		os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, exe); err != nil {
		_ = os.Rename(old, exe)
		os.Remove(tmp)
		return err
	}
	return nil
}

// restartInto starts the new binary with the same arguments; main then exits.
func restartInto(path string) error {
	cmd := exec.Command(path, os.Args[1:]...)
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	if err := cmd.Start(); err != nil {
		return err
	}
	os.Exit(0)
	return nil
}

// cleanupAfterUpdate removes the binary an update moved aside.
func cleanupAfterUpdate() {
	if exe, err := os.Executable(); err == nil {
		_ = os.Remove(exe + ".old")
	}
}
