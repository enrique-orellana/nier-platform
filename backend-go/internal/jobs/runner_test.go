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
