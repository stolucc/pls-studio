// Cross-process locks on files in the helper's config directory
// (~/.pls-studio-helper). The running helper (tray, HTTP API) and the
// command line (setup, update, rotate, allow-origin, ...) are separate
// processes that change the same files: the R library, the helper binary,
// config.json. An in-process mutex does not stop two of them at once.
//
// The lock is the operating system's (flock on macOS / Linux, LockFileEx on
// Windows) on a file that is never deleted: the kernel releases it when the
// process exits or crashes, so there is no stale lock to clean up, and no
// window in which a deleted-and-recreated lock file lets two holders in.

package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// errLocked: another process (or another caller in this one) holds the lock.
var errLocked = errors.New("locked by another process")

// fileLock is a held lock; unlock releases it.
type fileLock struct {
	f *os.File
}

// tryLockFile takes the lock on path without waiting; errLocked when it is held.
func tryLockFile(path string) (*fileLock, error) {
	f, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		return nil, err
	}
	if err := lockFileNB(f); err != nil {
		f.Close()
		return nil, err
	}
	return &fileLock{f: f}, nil
}

// lockFileWait takes the lock on path, waiting up to timeout for its holder.
func lockFileWait(path string, timeout time.Duration) (*fileLock, error) {
	deadline := time.Now().Add(timeout)
	for {
		l, err := tryLockFile(path)
		if !errors.Is(err, errLocked) {
			return l, err
		}
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("%s: %w (waited %s)", filepath.Base(path), err, timeout)
		}
		time.Sleep(25 * time.Millisecond)
	}
}

// unlock releases the lock (closing the file would too).
func (l *fileLock) unlock() {
	_ = unlockFile(l.f)
	_ = l.f.Close()
}

// Lock files in the config directory, one per thing they guard, so that a
// package installation (minutes) does not hold up a config change.
const (
	libraryLockName = "library.lock" // the helper's R library (setup)
	updateLockName  = "update.lock"  // the helper binary (self-update)
	configLockName  = "config.lock"  // config.json read-modify-write
)

// lockInConfigDir takes, without waiting, one of the locks above.
func lockInConfigDir(name string) (*fileLock, error) {
	dir, err := configDir()
	if err != nil {
		return nil, err
	}
	return tryLockFile(filepath.Join(dir, name))
}
