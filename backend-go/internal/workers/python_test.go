package workers

import (
	"context"
	"errors"
	"testing"

	"github.com/mutonby/openshorts/backend-go/internal/domain"
)

type recordingRunner struct {
	spec CommandSpec
	err  error
}

func (r *recordingRunner) Run(_ context.Context, spec CommandSpec, output LogSink) error {
	r.spec = spec
	_, _ = output.Write([]byte("starting\nfinished\n"))
	return r.err
}

func TestPythonAdapterBuildsMediaCommandAndStreamsLogs(t *testing.T) {
	recorder := &recordingRunner{}
	adapter := PythonAdapter{
		PythonBinary: "python-test",
		MainScript:   "main.py",
		Runner:       recorder,
	}
	job := domain.Job{
		ID:        "job-1",
		SourceURL: "https://example.com/source.mp4",
		ClipCount: 4,
		Metadata: map[string]any{
			"layout_format": "streamer_stack",
			"facecam_size":  "large",
		},
	}
	var logs []string

	err := adapter.Run(context.Background(), job, "output/job-1", func(message string) {
		logs = append(logs, message)
	})
	if err != nil {
		t.Fatalf("run adapter: %v", err)
	}
	if recorder.spec.Name != "python-test" {
		t.Fatalf("unexpected command name: %q", recorder.spec.Name)
	}
	expectedArgs := []string{"-u", "main.py", "--direct-url", "https://example.com/source.mp4", "--target-clips", "4", "--layout-format", "streamer_stack", "--facecam-size", "large", "-o", "output/job-1"}
	if len(recorder.spec.Args) != len(expectedArgs) {
		t.Fatalf("unexpected args: %#v", recorder.spec.Args)
	}
	for index, expected := range expectedArgs {
		if recorder.spec.Args[index] != expected {
			t.Fatalf("arg %d: expected %q, got %q", index, expected, recorder.spec.Args[index])
		}
	}
	if len(recorder.spec.Env) != 1 || recorder.spec.Env[0] != "PYTHONUNBUFFERED=1" {
		t.Fatalf("unexpected environment: %#v", recorder.spec.Env)
	}
	if len(logs) != 2 || logs[0] != "starting" || logs[1] != "finished" {
		t.Fatalf("unexpected logs: %#v", logs)
	}
}

func TestPythonAdapterRejectsMissingSourceURL(t *testing.T) {
	adapter := PythonAdapter{Runner: &recordingRunner{}}
	err := adapter.Run(context.Background(), domain.Job{}, "output/job", func(string) {})
	if err == nil {
		t.Fatal("expected missing source URL to fail")
	}
}

func TestPythonAdapterReturnsCommandErrorAfterFlushingLogs(t *testing.T) {
	recorder := &recordingRunner{err: errors.New("python exited with status 1")}
	adapter := PythonAdapter{Runner: recorder}
	var logs []string

	err := adapter.Run(context.Background(), domain.Job{SourceURL: "https://example.com/video"}, "output/job", func(message string) {
		logs = append(logs, message)
	})
	if err == nil || err.Error() != "python exited with status 1" {
		t.Fatalf("unexpected adapter error: %v", err)
	}
	if len(logs) != 2 || logs[1] != "finished" {
		t.Fatalf("expected logs before command failure, got %#v", logs)
	}
}
