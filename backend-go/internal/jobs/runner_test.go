package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/mutonby/openshorts/backend-go/internal/domain"
)

type fakeWorker struct {
	err error
}

type resultWorker struct{}

func (resultWorker) Run(_ context.Context, _ domain.Job, _ string, onLog func(string)) error {
	onLog("worker output")
	return nil
}

func (resultWorker) RunResult(_ context.Context, _ domain.Job, _ string, onLog func(string)) ([]byte, error) {
	onLog("worker output")
	return json.RawMessage(`{"clips":[{"title":"First"}]}`), nil
}

func (w fakeWorker) Run(_ context.Context, _ domain.Job, _ string, onLog func(string)) error {
	onLog("worker output")
	return w.err
}

func TestRunnerCompletesJobAndPersistsWorkerLogs(t *testing.T) {
	store := NewMemoryStore()
	job, err := store.Create(context.Background(), domain.CreateJobInput{
		Kind:      "clip-generation",
		SourceURL: "https://example.com/video.mp4",
		OutputDir: "output/job-1",
	})
	if err != nil {
		t.Fatalf("create job: %v", err)
	}
	runner := Runner{Store: store, Worker: fakeWorker{}}

	if err := runner.RunOnce(context.Background(), job.ID); err != nil {
		t.Fatalf("run job: %v", err)
	}

	completed, ok := store.Get(context.Background(), job.ID)
	if !ok {
		t.Fatal("job was not found")
	}
	if completed.Status != domain.JobStatusCompleted || completed.Error != "" {
		t.Fatalf("unexpected completed job: %#v", completed)
	}
	if len(completed.Logs) != 2 || completed.Logs[0].Message != "Job started by worker." || completed.Logs[1].Message != "worker output" {
		t.Fatalf("unexpected job logs: %#v", completed.Logs)
	}
}

func TestRunnerPersistsLifecycleAuditEvents(t *testing.T) {
	store := NewMemoryStore()
	job, err := store.Create(context.Background(), domain.CreateJobInput{Kind: "clip-generation"})
	if err != nil {
		t.Fatalf("create job: %v", err)
	}

	if err := (Runner{Store: store, Worker: fakeWorker{}}).RunOnce(context.Background(), job.ID); err != nil {
		t.Fatalf("run job: %v", err)
	}
	events, err := store.ListAuditEvents(context.Background(), job.ID)
	if err != nil {
		t.Fatalf("list audit events: %v", err)
	}
	if len(events) != 3 {
		t.Fatalf("expected three lifecycle events, got %#v", events)
	}
	expected := []struct {
		name   string
		status domain.AuditEventStatus
	}{
		{"job.queued", domain.AuditEventStatusCompleted},
		{"worker.started", domain.AuditEventStatusCompleted},
		{"worker.completed", domain.AuditEventStatusCompleted},
	}
	for index, want := range expected {
		if events[index].Sequence != index+1 || events[index].Name != want.name || events[index].Status != want.status {
			t.Fatalf("unexpected lifecycle event %d: %#v", index, events[index])
		}
	}
}

func TestRunnerMarksWorkerFailureAndCancellationInAuditTimeline(t *testing.T) {
	t.Run("failure", func(t *testing.T) {
		store := NewMemoryStore()
		job, err := store.Create(context.Background(), domain.CreateJobInput{Kind: "clip-generation"})
		if err != nil {
			t.Fatalf("create job: %v", err)
		}
		workerErr := errors.New("python exited with status 1")
		if err := (Runner{Store: store, Worker: fakeWorker{err: workerErr}}).RunOnce(context.Background(), job.ID); !errors.Is(err, workerErr) {
			t.Fatalf("expected worker error, got %v", err)
		}
		events, err := store.ListAuditEvents(context.Background(), job.ID)
		if err != nil {
			t.Fatalf("list audit events: %v", err)
		}
		if len(events) == 0 || events[len(events)-1].Name != "worker.failed" || events[len(events)-1].Status != domain.AuditEventStatusFailed {
			t.Fatalf("expected failed worker event, got %#v", events)
		}
	})

	t.Run("cancellation", func(t *testing.T) {
		store := NewMemoryStore()
		job, err := store.Create(context.Background(), domain.CreateJobInput{Kind: "highlight-generation"})
		if err != nil {
			t.Fatalf("create job: %v", err)
		}
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		if err := (Runner{Store: store, Worker: contextAwareWorker{}}).RunOnce(ctx, job.ID); err == nil {
			t.Fatal("expected cancellation error")
		}
		events, err := store.ListAuditEvents(context.Background(), job.ID)
		if err != nil {
			t.Fatalf("list audit events: %v", err)
		}
		if len(events) == 0 || events[len(events)-1].Name != "worker.started" || events[len(events)-1].Status != domain.AuditEventStatusUnknown {
			t.Fatalf("expected unresolved worker event, got %#v", events)
		}
	})
}

func TestRunnerMarksDeferredClipDiscoveryAsClipsReady(t *testing.T) {
	store := NewMemoryStore()
	job, err := store.Create(context.Background(), domain.CreateJobInput{
		Kind:     "clip-generation",
		Metadata: map[string]any{"defer_render": true},
	})
	if err != nil {
		t.Fatalf("create job: %v", err)
	}
	runner := Runner{Store: store, Worker: resultWorker{}}
	if err := runner.RunOnce(context.Background(), job.ID); err != nil {
		t.Fatalf("run deferred job: %v", err)
	}
	ready, _ := store.Get(context.Background(), job.ID)
	if ready.Status != domain.JobStatusClipsReady {
		t.Fatalf("expected clips_ready status, got %#v", ready)
	}
}

func TestRunnerMarksFailedJobAndReturnsWorkerError(t *testing.T) {
	store := NewMemoryStore()
	job, err := store.Create(context.Background(), domain.CreateJobInput{
		Kind:      "clip-generation",
		SourceURL: "https://example.com/video.mp4",
		OutputDir: "output/job-1",
	})
	if err != nil {
		t.Fatalf("create job: %v", err)
	}
	workerErr := errors.New("python exited with status 1")
	runner := Runner{Store: store, Worker: fakeWorker{err: workerErr}}

	if err := runner.RunOnce(context.Background(), job.ID); !errors.Is(err, workerErr) {
		t.Fatalf("expected worker error, got %v", err)
	}

	failed, ok := store.Get(context.Background(), job.ID)
	if !ok {
		t.Fatal("job was not found")
	}
	if failed.Status != domain.JobStatusFailed || failed.Error != workerErr.Error() {
		t.Fatalf("unexpected failed job: %#v", failed)
	}
}

func TestRunnerPersistsResultFromResultWorker(t *testing.T) {
	store := NewMemoryStore()
	job, err := store.Create(context.Background(), domain.CreateJobInput{Kind: "clip-generation"})
	if err != nil {
		t.Fatalf("create job: %v", err)
	}
	runner := Runner{Store: store, Worker: resultWorker{}}
	if err := runner.RunOnce(context.Background(), job.ID); err != nil {
		t.Fatalf("run job: %v", err)
	}
	completed, _ := store.Get(context.Background(), job.ID)
	if string(completed.Result) != `{"clips":[{"title":"First"}]}` {
		t.Fatalf("unexpected job result: %s", completed.Result)
	}
}

type contextAwareWorker struct{}

func (contextAwareWorker) Run(ctx context.Context, _ domain.Job, _ string, _ func(string)) error {
	<-ctx.Done()
	return ctx.Err()
}

func TestRunnerMarksContextCancellationAsCancelled(t *testing.T) {
	store := NewMemoryStore()
	job, err := store.Create(context.Background(), domain.CreateJobInput{Kind: "highlight-generation"})
	if err != nil {
		t.Fatalf("create job: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	runner := Runner{Store: store, Worker: contextAwareWorker{}}
	if err := runner.RunOnce(ctx, job.ID); err == nil {
		t.Fatal("expected cancellation error")
	}
	cancelled, _ := store.Get(context.Background(), job.ID)
	if cancelled.Status != domain.JobStatusCancelled {
		t.Fatalf("expected cancelled status, got %#v", cancelled)
	}
}

type metadataWorker struct {
	job      domain.Job
	released bool
}

func (w *metadataWorker) Run(_ context.Context, job domain.Job, _ string, _ func(string)) error {
	w.job = job
	return nil
}

func TestRunnerPassesRuntimeMetadataWithoutPersistingIt(t *testing.T) {
	store := NewMemoryStore()
	job, err := store.Create(context.Background(), domain.CreateJobInput{Kind: "highlight-generation"})
	if err != nil {
		t.Fatalf("create job: %v", err)
	}
	worker := &metadataWorker{}
	runner := Runner{
		Store:  store,
		Worker: worker,
		RuntimeMetadata: func(string) map[string]any {
			return map[string]any{"headers": map[string]string{"X-AI-Api-Key": "secret"}}
		},
		ReleaseRuntimeMetadata: func(string) { worker.released = true },
	}
	if err := runner.RunOnce(context.Background(), job.ID); err != nil {
		t.Fatalf("run job: %v", err)
	}
	if worker.job.Metadata["headers"].(map[string]string)["X-AI-Api-Key"] != "secret" || !worker.released {
		t.Fatalf("runtime metadata was not passed/released: %#v released=%v", worker.job.Metadata, worker.released)
	}
	persisted, _ := store.Get(context.Background(), job.ID)
	if _, ok := persisted.Metadata["headers"]; ok {
		t.Fatalf("runtime metadata was persisted: %#v", persisted.Metadata)
	}
}
