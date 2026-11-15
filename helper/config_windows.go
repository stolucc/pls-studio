//go:build windows

// Windows-specific config-path hardening.
//
// On Unix, os.Chmod(path, 0600) sets the underlying inode mode. On
// Windows, Go's syscall layer translates that into only the read-only
// bit — the NTFS DACL is left as whatever the file inherits from
// %USERPROFILE%, which on shared / corporate / family PCs can grant
// read access to other users on the same machine. That would let
// another local account read the bearer token out of
// ~/.pls-studio-helper/config.json and then drive /call
// against the loopback helper.
//
// Fix: shell out to icacls.exe (built into every Windows install
// since XP) to strip inherited ACLs and grant ONLY the current user
// FullControl on both the file and the directory. Idempotent —
// running multiple times produces the same ACL each call.
//
// Falls back to a logged warning if icacls is missing or errors:
// the helper still runs (the file at default ACL works fine for the
// owning user), just without the inter-user hardening.

package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"

	"golang.org/x/sys/windows"
)

// secureFileACL replaces the file's DACL with one that grants only
// the current user FullControl. Inheritance from the parent dir is
// removed so the file's permissions can't be widened by adding ACEs
// to the parent later.
func secureFileACL(path string) error {
	return icaclsLockdown(path, false)
}

// secureDirACL replaces the directory's DACL the same way, and
// propagates the lockdown to any pre-existing children (containers
// + objects). Used on ~/.pls-studio-helper at create-time.
func secureDirACL(path string) error {
	return icaclsLockdown(path, true)
}

func icaclsLockdown(path string, isDir bool) error {
	user := os.Getenv("USERNAME")
	if user == "" {
		return fmt.Errorf("USERNAME env var is empty; can't ACL")
	}
	// (OI)(CI) on directories so the lockdown propagates to anything
	// created inside later. F = FullControl. /inheritance:r removes
	// inherited ACEs entirely. /grant:r replaces any existing ACE
	// for the named principal (idempotent).
	grant := user + ":F"
	if isDir {
		grant = user + ":(OI)(CI)F"
	}
	cmd := exec.Command("icacls", path, "/inheritance:r", "/grant:r", grant)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("icacls failed: %w (output: %s)", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// warnIfRoamingProfile checks whether ~/.pls-studio-helper resolves to a
// UNC path (e.g. \\fileserver\users$\alice) — characteristic of
// roaming AD profiles. If so, the bearer token traverses SMB on
// every read, which is undesirable. Returns true if a warning is
// warranted; caller logs through its own logger.
func warnIfRoamingProfile(dir string) bool {
	return strings.HasPrefix(dir, `\\`)
}

// replaceFile renames src over dst. Windows refuses the rename (access denied
// or a sharing violation) while another process has dst open, for example the
// running helper reading its config while a CLI command writes it. Such
// readers close the file within milliseconds, so the rename is retried for up
// to two seconds, as the Go toolchain does (cmd/go/internal/robustio).
func replaceFile(src, dst string) error {
	deadline := time.Now().Add(2 * time.Second)
	delay := time.Millisecond
	for {
		err := os.Rename(src, dst)
		if err == nil {
			return nil
		}
		transient := errors.Is(err, windows.ERROR_ACCESS_DENIED) ||
			errors.Is(err, windows.ERROR_SHARING_VIOLATION)
		if !transient || time.Now().After(deadline) {
			return err
		}
		time.Sleep(delay)
		if delay < 100*time.Millisecond {
			delay *= 2
		}
	}
}
