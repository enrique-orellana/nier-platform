package workers

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/mutonby/openshorts/backend-go/internal/domain"
)

func TestWorkerGrandchild(t *testing.T) {
	if os.Getenv("OPENSHORTS_GRANDCHILD") != "1" {
		return
	}
	time.Sleep(500 * time.Millisecond)
	_ = os.WriteFile(os.Getenv("OPENSHORTS_GRANDCHILD_MARKER"), []byte("survived"), 0o600)
}

func TestWorkerProcessHelper(t *testing.T) {
	if os.Getenv("OPENSHORTS_WORKER_HELPER") != "1" {
		return
	}
	child := exec.Command(os.Args[0], "-test.run=TestWorkerGrandchild", "-test.v=false")
	child.Env = append(os.Environ(), "OPENSHORTS_GRANDCHILD=1")
	if err := child.Start(); err != nil {
		return
	}
	_ = child.Process.Release()
	time.Sleep(10 * time.Second)
}

type recordingProtocolRunner struct {
	spec    CommandSpec
	request map[string]any
}

func (r *recordingProtocolRunner) RunProtocol(_ context.Context, spec CommandSpec, request map[string]any, onEvent func(ProtocolEvent)) error {
	r.spec = spec
	r.request = request
	onEvent(ProtocolEvent{Type: "log", Message: "worker started"})
	onEvent(ProtocolEvent{Type: "result", Result: json.RawMessage(`{"job_id":"job-1"}`)})
	return nil
}

type errorEventRunner struct{}

func (errorEventRunner) RunProtocol(_ context.Context, _ CommandSpec, _ map[string]any, onEvent func(ProtocolEvent)) error {
	onEvent(ProtocolEvent{Type: "error", Error: "worker rejected request"})
	return nil
}

type recordingSourceDownloader struct{ bucket, key, destination string }

func (d *recordingSourceDownloader) DownloadSourceObject(_ context.Context, bucket, key, destination string, _ int64) error {
	d.bucket, d.key, d.destination = bucket, key, destination
	return nil
}

func TestPythonWorkerAdapterReturnsProtocolError(t *testing.T) {
	adapter := PythonWorkerAdapter{Runner: errorEventRunner{}}

	err := adapter.Run(context.Background(), domain.Job{ID: "job-1", SourceURL: "https://example.com/video"}, "output/job-1", nil)
	if err == nil || err.Error() != "worker rejected request" {
		t.Fatalf("expected protocol failure, got %v", err)
	}
}

func TestExecProtocolRunnerCancelsWorkerProcessTree(t *testing.T) {
	marker := filepath.Join(t.TempDir(), "grandchild-survived")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runner := ExecProtocolRunner{}
	done := make(chan error, 1)
	go func() {
		done <- runner.RunProtocol(ctx, CommandSpec{Name: os.Args[0], Args: []string{"-test.run=TestWorkerProcessHelper", "-test.v=false"}, Env: []string{"OPENSHORTS_WORKER_HELPER=1", "OPENSHORTS_GRANDCHILD_MARKER=" + marker}}, map[string]any{"id": "job-1"}, nil)
	}()
	time.Sleep(150 * time.Millisecond)
	cancel()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("expected worker cancellation to return an error")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("worker did not stop after cancellation")
	}
	time.Sleep(800 * time.Millisecond)
	if _, err := os.Stat(marker); err == nil {
		t.Fatal("worker grandchild survived cancellation")
	}
}

func TestPythonWorkerAdapterSendsNonURLSourcesAndContext(t *testing.T) {
	runner := &recordingProtocolRunner{}
	adapter := PythonWorkerAdapter{Runner: runner}
	job := domain.Job{
		ID:        "job-2",
		ClipCount: 5,
		Metadata: map[string]any{
			"source_url": "https://youtube.com/watch?v=2",
			"source_object": map[string]any{
				"bucket": "videos",
				"key":    "source.mp4",
			},
		},
	}
	if err := adapter.Run(context.Background(), job, "output/job-2", nil); err != nil {
		t.Fatalf("run worker: %v", err)
	}
	if runner.request["source_object"] == nil || runner.request["source_context_url"] != "https://youtube.com/watch?v=2" {
		t.Fatalf("missing object/context fields: %#v", runner.request)
	}
	job.Metadata = map[string]any{"source_path": "/tmp/source.mp4", "source_url": "https://youtube.com/watch?v=2"}
	if err := adapter.Run(context.Background(), job, "output/job-2", nil); err != nil {
		t.Fatalf("run file worker: %v", err)
	}
	if runner.request["source_path"] != "/tmp/source.mp4" || runner.request["source_context_url"] != "https://youtube.com/watch?v=2" {
		t.Fatalf("missing file/context fields: %#v", runner.request)
	}
}

func TestPythonWorkerAdapterDownloadsSourceObjectsBeforeStartingPython(t *testing.T) {
	runner := &recordingProtocolRunner{}
	downloader := &recordingSourceDownloader{}
	adapter := PythonWorkerAdapter{Runner: runner, SourceDownloader: downloader}
	job := domain.Job{ID: "job-source", Metadata: map[string]any{"source_object": map[string]any{"bucket": "youtube-downloads", "key": "folder/source.mp4"}}}
	if err := adapter.Run(context.Background(), job, "output/job-source", nil); err != nil {
		t.Fatal(err)
	}
	if downloader.bucket != "youtube-downloads" || downloader.key != "folder/source.mp4" {
		t.Fatalf("unexpected download: %#v", downloader)
	}
	if runner.request["source_path"] != filepath.Join("output/job-source", "source.mp4") || runner.request["source_object"] != nil {
		t.Fatalf("unexpected worker request: %#v", runner.request)
	}
}

func TestPythonWorkerAdapterSendsJSONLJobRequest(t *testing.T) {
	runner := &recordingProtocolRunner{}
	adapter := PythonWorkerAdapter{
		PythonBinary: "python-test",
		WorkerScript: "python_worker.py",
		Runner:       runner,
	}
	job := domain.Job{
		ID:        "job-1",
		SourceURL: "https://example.com/video.mp4",
		ClipCount: 4,
		Metadata: map[string]any{
			"headers": map[string]string{
				"X-AI-Provider": "openrouter",
				"X-AI-Api-Key":  "secret",
			},
		},
	}
	var logs []string

	if err := adapter.Run(context.Background(), job, "output/job-1", func(message string) { logs = append(logs, message) }); err != nil {
		t.Fatalf("run worker: %v", err)
	}
	if runner.spec.Name != "python-test" {
		t.Fatalf("unexpected command: %#v", runner.spec)
	}
	expectedArgs := []string{"-u", "python_worker.py"}
	if len(runner.spec.Args) != len(expectedArgs) {
		t.Fatalf("unexpected args: %#v", runner.spec.Args)
	}
	for i, expected := range expectedArgs {
		if runner.spec.Args[i] != expected {
			t.Fatalf("arg %d: expected %q, got %q", i, expected, runner.spec.Args[i])
		}
	}
	if runner.request["id"] != "job-1" || runner.request["operation"] != "clip_generation" {
		t.Fatalf("unexpected worker request: %#v", runner.request)
	}
	if runner.request["source_url"] != job.SourceURL || runner.request["output_dir"] != "output/job-1" {
		t.Fatalf("unexpected job inputs: %#v", runner.request)
	}
	headers, ok := runner.request["headers"].(map[string]string)
	if !ok || headers["X-AI-Provider"] != "openrouter" || headers["X-AI-Api-Key"] != "secret" {
		t.Fatalf("clip-generation AI headers were not forwarded: %#v", runner.request)
	}
	if len(logs) != 1 || logs[0] != "worker started" {
		t.Fatalf("unexpected logs: %#v", logs)
	}
}

func TestPythonWorkerAdapterSendsHighlightOperationAndAIHeaders(t *testing.T) {
	runner := &recordingProtocolRunner{}
	adapter := PythonWorkerAdapter{Runner: runner}
	job := domain.Job{
		ID:   "highlight-1",
		Kind: "highlight-generation",
		Metadata: map[string]any{
			"min_minutes":   12.0,
			"ideal_minutes": 20.0,
			"headers": map[string]any{
				"X-AI-Provider": "ollama",
			},
		},
	}
	if err := adapter.Run(context.Background(), job, "output/highlight-1", nil); err != nil {
		t.Fatalf("run highlight worker: %v", err)
	}
	if runner.request["operation"] != "highlight_generation" || runner.request["min_minutes"] != 12.0 || runner.request["headers"].(map[string]string)["X-AI-Provider"] != "ollama" {
		t.Fatalf("unexpected highlight worker request: %#v", runner.request)
	}
}
