package jobs

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/mutonby/openshorts/backend-go/internal/domain"
)

type blockingSchedulerWorker struct {
	mu        sync.Mutex
	active    int
	maxActive int
	started   chan string
	release   chan struct{}
}

func (w *blockingSchedulerWorker) Run(_ context.Context, job domain.Job, _ string, _ func(string)) error {
	w.mu.Lock()
	w.active++
	if w.active > w.maxActive {
		w.maxActive = w.active
	}
	w.mu.Unlock()
	w.started <- job.ID
	<-w.release
	w.mu.Lock()
	w.active--
	w.mu.Unlock()
	return nil
}

func (w *blockingSchedulerWorker) maximumActive() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.maxActive
}

func TestSchedulerLimitsConcurrentJobs(t *testing.T) {
	store := NewMemoryStore()
	worker := &blockingSchedulerWorker{started: make(chan string, 3), release: make(chan struct{})}
	runner := &Runner{Store: store, Worker: worker}
	scheduler := NewScheduler(store, runner, 1)
	if err := scheduler.Start(context.Background()); err != nil {
		t.Fatalf("start scheduler: %v", err)
	}
	defer scheduler.Stop(context.Background())

	jobs := make([]domain.Job, 0, 2)
	for range 2 {
		job, err := store.Create(context.Background(), domain.CreateJobInput{Kind: "clip-generation"})
		if err != nil {
			t.Fatalf("create job: %v", err)
		}
		jobs = append(jobs, job)
		if err := scheduler.Submit(context.Background(), job.ID); err != nil {
			t.Fatalf("submit job: %v", err)
		}
	}

	select {
	case <-worker.started:
	case <-time.After(time.Second):
		t.Fatal("first job did not start")
	}
	select {
	case <-worker.started:
		t.Fatal("second job started before the first completed")
	case <-time.After(50 * time.Millisecond):
	}
	if got := worker.maximumActive(); got != 1 {
		t.Fatalf("expected one active worker, got %d", got)
	}
	close(worker.release)
}

func TestSchedulerRecoversQueuedAndProcessingJobs(t *testing.T) {
	store := NewMemoryStore()
	queued, err := store.Create(context.Background(), domain.CreateJobInput{Kind: "clip-generation"})
	if err != nil {
		t.Fatalf("create queued job: %v", err)
	}
	processing, err := store.Create(context.Background(), domain.CreateJobInput{Kind: "clip-generation"})
	if err != nil {
		t.Fatalf("create processing job: %v", err)
	}
	if _, err := store.Claim(context.Background(), processing.ID); err != nil {
		t.Fatalf("claim processing job: %v", err)
	}

	worker := &blockingSchedulerWorker{started: make(chan string, 2), release: make(chan struct{})}
	scheduler := NewScheduler(store, &Runner{Store: store, Worker: worker}, 1)
	if err := scheduler.Start(context.Background()); err != nil {
		t.Fatalf("start scheduler: %v", err)
	}
	defer func() {
		_ = scheduler.Stop(context.Background())
	}()

	seen := map[string]bool{}
	select {
	case id := <-worker.started:
		seen[id] = true
	case <-time.After(time.Second):
		t.Fatal("first recovered job did not start")
	}
	close(worker.release)
	select {
	case id := <-worker.started:
		seen[id] = true
	case <-time.After(time.Second):
		t.Fatal("second recovered job did not start")
	}
	if !seen[queued.ID] || !seen[processing.ID] {
		t.Fatalf("scheduler did not recover both jobs: %#v", seen)
	}
}
