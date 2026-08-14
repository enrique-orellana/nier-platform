//go:build windows

package workers

import (
	"os/exec"
	"strconv"
	"syscall"
)

func configureWorkerProcess(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP}
}

func killWorkerProcess(command *exec.Cmd) error {
	if command.Process == nil {
		return nil
	}
	return exec.Command("taskkill", "/PID", strconv.Itoa(command.Process.Pid), "/T", "/F").Run()
}
