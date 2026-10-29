//go:build !windows

package main

import (
	"os/exec"
	"syscall"
)

// R workers run in their own process group: cSEM's parallel plan forks child
// R processes, and cancelling must stop them too, not only the parent.
func setProcessGroup(cmd *exec.Cmd) { cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true} }

// killTree kills the worker and every process it forked.
func killTree(cmd *exec.Cmd) {
	if cmd.Process == nil {
		return
	}
	_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	_ = cmd.Process.Kill()
}
