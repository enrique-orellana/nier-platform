package workers

import (
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"strconv"
	"strings"

	"github.com/mutonby/openshorts/backend-go/internal/domain"
)

type LogSink interface {
	Write([]byte) (int, error)
}

type CommandSpec struct {
	Name string
	Args []string
	Dir  string
	Env  []string
}

type CommandRunner interface {
	Run(context.Context, CommandSpec, LogSink) error
}

type PythonAdapter struct {
	PythonBinary string
	MainScript   string
	Runner       CommandRunner
}

func (a PythonAdapter) Run(ctx context.Context, job domain.Job, outputDir string, onLog func(string)) error {
	if strings.TrimSpace(job.SourceURL) == "" {
		return errors.New("job source URL is required")
	}
	if strings.TrimSpace(outputDir) == "" {
		return errors.New("job output directory is required")
	}
	runner := a.Runner
	if runner == nil {
		runner = ExecRunner{}
	}
	pythonBinary := a.PythonBinary
	if pythonBinary == "" {
		pythonBinary = "python"
	}
	mainScript := a.MainScript
	if mainScript == "" {
		mainScript = "main.py"
	}
	clipCount := job.ClipCount
	if clipCount == 0 {
		clipCount = 6
	}

	lines := &lineSink{onLine: onLog}
	err := runner.Run(ctx, CommandSpec{
		Name: pythonBinary,
		Args: []string{
			"-u", mainScript,
			"--direct-url", job.SourceURL,
			"--target-clips", strconv.Itoa(clipCount),
			"-o", outputDir,
		},
		Env: []string{"PYTHONUNBUFFERED=1"},
	}, lines)
	lines.Flush()
	return err
}

type ExecRunner struct{}

func (ExecRunner) Run(ctx context.Context, spec CommandSpec, output LogSink) error {
	command := exec.CommandContext(ctx, spec.Name, spec.Args...)
	command.Dir = spec.Dir
	command.Env = append(os.Environ(), spec.Env...)
	command.Stdout = output
	command.Stderr = output
	return command.Run()
}

type lineSink struct {
	onLine func(string)
	buffer []byte
}

func (s *lineSink) Write(value []byte) (int, error) {
	s.buffer = append(s.buffer, value...)
	for {
		index := -1
		for i, char := range s.buffer {
			if char == '\n' {
				index = i
				break
			}
		}
		if index < 0 {
			break
		}
		s.emit(string(s.buffer[:index]))
		s.buffer = s.buffer[index+1:]
	}
	return len(value), nil
}

func (s *lineSink) Flush() {
	if len(s.buffer) > 0 {
		s.emit(string(s.buffer))
		s.buffer = nil
	}
}

func (s *lineSink) emit(value string) {
	if s.onLine != nil {
		s.onLine(strings.TrimSuffix(value, "\r"))
	}
}

var _ io.Writer = (*lineSink)(nil)
