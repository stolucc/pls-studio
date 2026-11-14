//go:build !windows

package main

import (
	"errors"
	"os"
	"syscall"
)

// lockFileNB takes an exclusive flock without blocking. flock locks belong to
// the open file, so a second open of the same file (in this process or
// another) is refused until the first is unlocked or closed.
func lockFileNB(f *os.File) error {
	err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
	if errors.Is(err, syscall.EWOULDBLOCK) {
		return errLocked
	}
	return err
}

func unlockFile(f *os.File) error {
	return syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
}
