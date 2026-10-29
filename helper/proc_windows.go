//go:build windows

package main

import (
	"os/exec"
	"strconv"
)

// On Windows cSEM's parallel plan starts separate R processes (multisession):
// taskkill /T ends the worker's whole process tree.
func setProcessGroup(*exec.Cmd) {}

func killTree(cmd *exec.Cmd) {
	if cmd.Process == nil {
		return
	}
	_ = exec.Command("taskkill", "/T", "/F", "/PID", strconv.Itoa(cmd.Process.Pid)).Run()
	_ = cmd.Process.Kill()
}
