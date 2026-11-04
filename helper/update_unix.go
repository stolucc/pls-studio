//go:build !windows

package main

import (
	"os"
	"path/filepath"
	"syscall"
)

// installBinary replaces exe atomically: the new file is written beside it and
// renamed over it (a running program keeps its old file open until it exits).
func installBinary(exe string, data []byte) error {
	tmp, err := writeBeside(filepath.Dir(exe), data)
	if err != nil {
		return err
	}
	if err := os.Rename(tmp, exe); err != nil {
		os.Remove(tmp)
		return err
	}
	return nil
}

// restartInto replaces this process with the new binary, same arguments.
func restartInto(path string) error {
	return syscall.Exec(path, os.Args, os.Environ())
}

// cleanupAfterUpdate: nothing is left behind on Unix.
func cleanupAfterUpdate() {}
