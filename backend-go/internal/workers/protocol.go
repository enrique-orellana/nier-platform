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

type ArtifactDownloader interface {
	DownloadJobSourceArtifact(context.Context, string, string, int64) error
}

type ExecProtocolRunner struct{}

func (ExecProtocolRunner) RunProtocol(ctx context.Context, spec CommandSpec, request map[string]any, onEvent func(ProtocolEvent)) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	command := exec.Command(spec.Name, spec.Args...)
	configureWorkerProcess(command)
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
	stopWatcher := make(chan struct{})
	waited := false
	go func() {
		select {
		case <-ctx.Done():
			_ = killWorkerProcess(command)
		case <-stopWatcher:
		}
	}()
	defer func() {
		close(stopWatcher)
		if !waited {
			_ = killWorkerProcess(command)
			_ = command.Wait()
		}
	}()

	encodeErr := json.NewEncoder(stdin).Encode(request)
	closeErr := stdin.Close()
	if encodeErr != nil {
		_ = killWorkerProcess(command)
		_ = command.Wait()
		waited = true
		return encodeErr
	}
	if closeErr != nil {
		_ = killWorkerProcess(command)
		_ = command.Wait()
		waited = true
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
		_ = killWorkerProcess(command)
		_ = command.Wait()
		waited = true
		return err
	}
	waitErr := command.Wait()
	waited = true
	if err := ctx.Err(); err != nil {
		return err
	}
	if waitErr != nil {
		return waitErr
	}
	return nil
}

type PythonWorkerAdapter struct {
	PythonBinary       string
	WorkerScript       string
	Runner             ProtocolRunner
	SourceDownloader   SourceDownloader
	ArtifactDownloader ArtifactDownloader
	SourceMaxBytes     int64
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
	operation := "clip_generation"
	if job.Kind == "clip-render" {
		operation = "clip_render"
	}
	request := map[string]any{
		"id":         job.ID,
		"operation":  operation,
		"output_dir": outputDir,
		"clip_count": job.ClipCount,
	}
	if deferred, ok := job.Metadata["defer_render"].(bool); ok && deferred {
		request["defer_render"] = true
	}
	if operation == "clip_render" {
		request["parent_job_id"] = job.ParentJobID
		request["clip_index"] = job.ClipIndex
	}
	if layoutFormat, ok := job.Metadata["layout_format"].(string); ok && layoutFormat != "" {
		request["layout_format"] = layoutFormat
	}
	if facecamSize, ok := job.Metadata["facecam_size"].(string); ok && facecamSize != "" {
		request["facecam_size"] = facecamSize
	}
	if headers, ok := job.Metadata["headers"].(map[string]string); ok {
		request["headers"] = cloneHeaders(headers)
	} else if headers, ok := job.Metadata["headers"].(map[string]any); ok {
		values := make(map[string]string, len(headers))
		for key, value := range headers {
			if text, ok := value.(string); ok {
				values[key] = text
			}
		}
		request["headers"] = values
	}
	if job.Kind == "highlight-generation" {
		request["operation"] = "highlight_generation"
		if value, ok := job.Metadata["min_minutes"]; ok {
			request["min_minutes"] = value
		}
		if value, ok := job.Metadata["ideal_minutes"]; ok {
			request["ideal_minutes"] = value
		}
		if value, ok := job.Metadata["source_context"]; ok {
			request["source_context"] = value
		}
	}
	if job.SourceURL != "" {
		request["source_url"] = job.SourceURL
	}
	sourcePath, hasSourcePath := job.Metadata["source_path"].(string)
	if hasSourcePath && sourcePath != "" {
		request["source_path"] = sourcePath
	}
	if sourceObject, ok := job.Metadata["source_object"].(map[string]any); ok && !hasSourcePath {
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
	} else if sourceObject, ok := job.Metadata["source_object"].(map[string]any); ok && hasSourcePath {
		if _, err := os.Stat(sourcePath); err != nil {
			bucket, _ := sourceObject["bucket"].(string)
			key, _ := sourceObject["key"].(string)
			destination := filepath.Join(outputDir, "source"+filepath.Ext(filepath.Base(key)))
			maxBytes := a.SourceMaxBytes
			if maxBytes <= 0 {
				maxBytes = 16 * 1024 * 1024 * 1024
			}
			restoredFromMaster := false
			masterDestination := filepath.Join(outputDir, "source.mp4")
			if operation == "clip_render" && a.ArtifactDownloader != nil && job.ParentJobID != "" {
				if err := a.ArtifactDownloader.DownloadJobSourceArtifact(ctx, job.ParentJobID, masterDestination, maxBytes); err == nil {
					restoredFromMaster = true
				}
			}
			if restoredFromMaster {
				request["source_path"] = masterDestination
			} else if a.SourceDownloader == nil {
				delete(request, "source_path")
				request["source_object"] = sourceObject
			} else if err := a.SourceDownloader.DownloadSourceObject(ctx, bucket, key, destination, maxBytes); err != nil {
				return nil, err
			} else {
				request["source_path"] = destination
			}
		}
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

func cloneHeaders(headers map[string]string) map[string]string {
	clone := make(map[string]string, len(headers))
	for key, value := range headers {
		clone[key] = value
	}
	return clone
}

var _ io.Writer = (*lineSink)(nil)
