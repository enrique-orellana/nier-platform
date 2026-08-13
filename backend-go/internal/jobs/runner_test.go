package jobs

import (
	"context"
	"errors"
	"testing"

	"github.com/mutonby/openshorts/backend-go/internal/domain"
)

type fakeWorker struct {
	err error
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
