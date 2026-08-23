package main

import (
	"fmt"
	"os"
	"os/exec"
)

func needsHostEncoder(args []string) bool {
	for _, argument := range args {
		switch argument {
		case "h264_nvenc", "h264_amf", "hevc_nvenc", "hevc_amf":
			return true
		}
	}
	return false
}

func rewriteVideoArgs(args []string) []string {
	rewritten := make([]string, 0, len(args))
	for index := 0; index < len(args); index++ {
		argument := args[index]
		if argument == "-preset" {
			index++
			continue
		}
		switch argument {
		case "h264_nvenc":
			rewritten = append(rewritten, "h264_amf")
		case "hevc_nvenc":
			rewritten = append(rewritten, "hevc_amf")
		case "libfdk_aac":
			rewritten = append(rewritten, "aac")
		default:
			rewritten = append(rewritten, argument)
		}
	}
	return rewritten
}

func main() {
	args := os.Args[1:]
	commandPath := os.Getenv("OPENSHORTS_BUNDLED_FFMPEG_PATH")
	if needsHostEncoder(args) {
		commandPath = os.Getenv("OPENSHORTS_HOST_FFMPEG_PATH")
		args = rewriteVideoArgs(args)
	}
	if commandPath == "" {
		fmt.Fprintln(os.Stderr, "FFmpeg wrapper is missing its configured executable path")
		os.Exit(2)
	}

	command := exec.Command(commandPath, args...)
	command.Stdin = os.Stdin
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	if err := command.Run(); err != nil {
		if exitError, ok := err.(*exec.ExitError); ok {
			os.Exit(exitError.ExitCode())
		}
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
