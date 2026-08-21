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
	"strings"

	"github.com/mutonby/openshorts/backend-go/internal/domain"
)

type ProtocolEvent struct {
	ID      string          `json:"id"`
	Type    string          `json:"type"`
	Message string          `json:"message"`
	Error   string          `json:"error"`
	Result  json.RawMessage `json:"result"`
	Audit   json.RawMessage `json:"audit"`
}

type AuditSink interface {
	StartAuditEvent(context.Context, string, domain.StartAuditEventInput) (domain.JobAuditEvent, error)
	FinishAuditEvent(context.Context, string, string, domain.FinishAuditEventInput) (domain.JobAuditEvent, error)
}

type protocolAuditEvent struct {
	Phase               string                  `json:"phase"`
	EventID             string                  `json:"event_id"`
	Category            string                  `json:"category"`
	Name                string                  `json:"name"`
	Provider            string                  `json:"provider"`
	Host                string                  `json:"host"`
	Path                string                  `json:"path"`
	Method              string                  `json:"method"`
	Status              domain.AuditEventStatus `json:"status"`
	HTTPStatus          int                     `json:"http_status"`
	RequestBytes        int64                   `json:"request_bytes"`
	ResponseBytes       int64                   `json:"response_bytes"`
	DurationMS          int64                   `json:"duration_ms"`
	RequestBody         string                  `json:"request_body"`
	ResponseBody        string                  `json:"response_body"`
	RequestContentType  string                  `json:"request_content_type"`
	ResponseContentType string                  `json:"response_content_type"`
	CaptureMode         string                  `json:"capture_mode"`
	Detail              string                  `json:"detail"`
	Error               string                  `json:"error"`
	Metadata            map[string]any          `json:"metadata"`
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
	PythonBinary           string
	WorkerScript           string
	Runner                 ProtocolRunner
	SourceDownloader       SourceDownloader
	ArtifactDownloader     ArtifactDownloader
	SourceMaxBytes         int64
	AuditSink              AuditSink
	AuditBodyHostAllowlist []string
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
	auditIDs := make(map[string]string)
	env := []string{"PYTHONUNBUFFERED=1"}
	if len(a.AuditBodyHostAllowlist) > 0 {
		env = append(env, "AUDIT_BODY_HOST_ALLOWLIST="+strings.Join(a.AuditBodyHostAllowlist, ","))
	}
	runErr := runner.RunProtocol(ctx, CommandSpec{
		Name: pythonBinary,
		Args: []string{"-u", workerScript},
		Env:  env,
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
		if a.AuditSink != nil && len(event.Audit) > 0 && protocolErr == nil {
			if err := handleProtocolAuditEvent(ctx, job.ID, event.Audit, a.AuditSink, auditIDs, onLog); err != nil {
				protocolErr = err
			}
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

func handleProtocolAuditEvent(ctx context.Context, jobID string, raw json.RawMessage, sink AuditSink, auditIDs map[string]string, onLog func(string)) error {
	var payload protocolAuditEvent
	if err := json.Unmarshal(raw, &payload); err != nil {
		return fmt.Errorf("decode audit event: %w", err)
	}
	if payload.EventID == "" {
		return errors.New("audit event ID is required")
	}
	switch payload.Phase {
	case "start":
		event, err := sink.StartAuditEvent(ctx, jobID, domain.StartAuditEventInput{
			Category: payload.Category, Name: payload.Name, Provider: payload.Provider,
			Host: payload.Host, Path: payload.Path, Method: payload.Method,
			RequestBytes: payload.RequestBytes, RequestBody: payload.RequestBody,
			RequestContentType: payload.RequestContentType, CaptureMode: payload.CaptureMode,
			Detail: payload.Detail, Metadata: payload.Metadata,
		})
		if err != nil {
			if onLog != nil {
				onLog(fmt.Sprintf("audit persistence failed for %s: %v", payload.Name, err))
			}
			return nil
		}
		auditIDs[payload.EventID] = event.ID
	case "finish":
		eventID := auditIDs[payload.EventID]
		if eventID == "" {
			return fmt.Errorf("audit event %q finished before start", payload.EventID)
		}
		if _, err := sink.FinishAuditEvent(ctx, jobID, eventID, domain.FinishAuditEventInput{
			Status: payload.Status, HTTPStatus: payload.HTTPStatus, ResponseBytes: payload.ResponseBytes,
			DurationMS: payload.DurationMS, ResponseBody: payload.ResponseBody,
			ResponseContentType: payload.ResponseContentType, Detail: payload.Detail,
			Error: payload.Error, Metadata: payload.Metadata,
		}); err != nil {
			if onLog != nil {
				onLog(fmt.Sprintf("audit persistence failed for %s: %v", payload.EventID, err))
			}
		}
	default:
		return fmt.Errorf("unsupported audit phase %q", payload.Phase)
	}
	return nil
}

func cloneHeaders(headers map[string]string) map[string]string {
	clone := make(map[string]string, len(headers))
	for key, value := range headers {
		clone[key] = value
	}
	return clone
}

var _ io.Writer = (*lineSink)(nil)
