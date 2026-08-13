package workers

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/mutonby/openshorts/backend-go/internal/domain"
)

type ProtocolEvent struct {
	ID      string          `json:"id"`
	Type    string          `json:"type"`
	Message string          `json:"message"`
	Error   string          `json:"error"`
	Result  json.RawMessage `json:"result"`
}

type ProtocolRunner interface {
	RunProtocol(context.Context, CommandSpec, map[string]any, func(ProtocolEvent)) error
}

type SourceDownloader interface {
	DownloadSourceObject(context.Context, string, string, string, int64) error
}

type ExecProtocolRunner struct{}

func (ExecProtocolRunner) RunProtocol(ctx context.Context, spec CommandSpec, request map[string]any, onEvent func(ProtocolEvent)) error {
	command := exec.CommandContext(ctx, spec.Name, spec.Args...)
	command.Dir = spec.Dir
	command.Env = append(os.Environ(), spec.Env...)
	stdin, err := command.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		return err
	}
	command.Stderr = io.Discard
	if err := command.Start(); err != nil {
		return err
	}

	encodeErr := json.NewEncoder(stdin).Encode(request)
	closeErr := stdin.Close()
	if encodeErr != nil {
		_ = command.Process.Kill()
		return encodeErr
	}
	if closeErr != nil {
		_ = command.Process.Kill()
		return closeErr
	}

	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 4096), 4*1024*1024)
	for scanner.Scan() {
		var event ProtocolEvent
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			return fmt.Errorf("decode worker event: %w", err)
		}
		if onEvent != nil {
			onEvent(event)
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	if err := command.Wait(); err != nil {
		return err
	}
	return nil
}

type PythonWorkerAdapter struct {
	PythonBinary     string
	WorkerScript     string
	Runner           ProtocolRunner
	SourceDownloader SourceDownloader
	SourceMaxBytes   int64
}

func (a PythonWorkerAdapter) Run(ctx context.Context, job domain.Job, outputDir string, onLog func(string)) error {
	_, err := a.RunResult(ctx, job, outputDir, onLog)
	return err
}

func (a PythonWorkerAdapter) RunResult(ctx context.Context, job domain.Job, outputDir string, onLog func(string)) ([]byte, error) {
	if job.ID == "" {
		return nil, errors.New("job ID is required")
	}
	if outputDir == "" {
		return nil, errors.New("job output directory is required")
	}
	runner := a.Runner
	if runner == nil {
		runner = ExecProtocolRunner{}
	}
	pythonBinary := a.PythonBinary
	if pythonBinary == "" {
		pythonBinary = "python"
	}
	workerScript := a.WorkerScript
	if workerScript == "" {
		workerScript = "python_worker.py"
	}
	request := map[string]any{
		"id":         job.ID,
		"operation":  "clip_generation",
		"output_dir": outputDir,
		"clip_count": job.ClipCount,
	}
	if job.SourceURL != "" {
		request["source_url"] = job.SourceURL
	}
	if sourceObject, ok := job.Metadata["source_object"].(map[string]any); ok {
		if a.SourceDownloader == nil {
			request["source_object"] = sourceObject
		} else {
			bucket, _ := sourceObject["bucket"].(string)
			key, _ := sourceObject["key"].(string)
			destination := filepath.Join(outputDir, "source"+filepath.Ext(filepath.Base(key)))
			maxBytes := a.SourceMaxBytes
			if maxBytes <= 0 {
				maxBytes = 16 * 1024 * 1024 * 1024
			}
			if err := a.SourceDownloader.DownloadSourceObject(ctx, bucket, key, destination, maxBytes); err != nil {
				return nil, err
			}
			request["source_path"] = destination
		}
	}
	if sourcePath, ok := job.Metadata["source_path"].(string); ok && sourcePath != "" {
		request["source_path"] = sourcePath
	}
	if sourceContext, ok := job.Metadata["source_url"].(string); ok {
		request["source_context_url"] = sourceContext
	}
	var protocolErr error
	var result []byte
	runErr := runner.RunProtocol(ctx, CommandSpec{
		Name: pythonBinary,
		Args: []string{"-u", workerScript},
		Env:  []string{"PYTHONUNBUFFERED=1"},
	}, request, func(event ProtocolEvent) {
		if event.Type == "error" && protocolErr == nil {
			protocolErr = errors.New(event.Error)
		}
		if event.Type == "result" {
			result = append(result[:0], event.Result...)
		}
		if event.Type == "log" && onLog != nil {
			onLog(event.Message)
		}
	})
	if runErr != nil {
		return nil, runErr
	}
	if protocolErr != nil {
		return nil, protocolErr
	}
	return result, nil
}

var _ io.Writer = (*lineSink)(nil)
