//go:build windows

package main

import (
	"errors"
	"os"

	"golang.org/x/sys/windows"
)

// lockFileNB takes an exclusive lock on the file's first byte without
// waiting. Windows locks belong to the file handle, so a second open of the
// same file (in this process or another) is refused until the first is
// unlocked or closed.
func lockFileNB(f *os.File) error {
	var ol windows.Overlapped
	flags := uint32(windows.LOCKFILE_EXCLUSIVE_LOCK | windows.LOCKFILE_FAIL_IMMEDIATELY)
	err := windows.LockFileEx(windows.Handle(f.Fd()), flags, 0, 1, 0, &ol)
	if errors.Is(err, windows.ERROR_LOCK_VIOLATION) || errors.Is(err, windows.ERROR_IO_PENDING) {
		return errLocked
	}
	return err
}

func unlockFile(f *os.File) error {
	var ol windows.Overlapped
	return windows.UnlockFileEx(windows.Handle(f.Fd()), 0, 1, 0, &ol)
}
