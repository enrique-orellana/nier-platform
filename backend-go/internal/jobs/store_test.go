package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"

	"github.com/mutonby/openshorts/backend-go/internal/domain"
)

func TestCreateAndGetQueuedJob(t *testing.T) {
	store := NewMemoryStore()
	created, err := store.Create(context.Background(), domain.CreateJobInput{
		Kind:      "clip-generation",
		SourceURL: "https://example.com/video.mp4",
		ClipCount: 6,
	})
	if err != nil {
		t.Fatalf("create job: %v", err)
	}
	if created.ID == "" || created.Status != domain.JobStatusQueued {
		t.Fatalf("unexpected created job: %#v", created)
	}

	loaded, ok := store.Get(context.Background(), created.ID)
	if !ok {
		t.Fatal("created job was not found")
	}
	if loaded.SourceURL != "https://example.com/video.mp4" || loaded.ClipCount != 6 {
		t.Fatalf("unexpected loaded job: %#v", loaded)
	}
}

func TestJobTransitionsFromQueuedToCompleted(t *testing.T) {
	store := NewMemoryStore()
	created, err := store.Create(context.Background(), domain.CreateJobInput{Kind: "clip-generation"})
	if err != nil {
		t.Fatalf("create job: %v", err)
	}

	processing, err := store.Transition(context.Background(), created.ID, domain.JobStatusProcessing, "")
	if err != nil {
		t.Fatalf("transition to processing: %v", err)
	}
	if processing.Status != domain.JobStatusProcessing {
		t.Fatalf("expected processing status, got %q", processing.Status)
	}

	completed, err := store.Transition(context.Background(), created.ID, domain.JobStatusCompleted, "")
	if err != nil {
		t.Fatalf("transition to completed: %v", err)
	}
	if completed.Status != domain.JobStatusCompleted || completed.Error != "" {
		t.Fatalf("unexpected completed job: %#v", completed)
	}
}

func TestInvalidJobTransitionIsRejected(t *testing.T) {
	store := NewMemoryStore()
	created, err := store.Create(context.Background(), domain.CreateJobInput{Kind: "clip-generation"})
	if err != nil {
		t.Fatalf("create job: %v", err)
	}

	if _, err := store.Transition(context.Background(), created.ID, domain.JobStatusCompleted, ""); err == nil {
		t.Fatal("expected queued-to-completed transition to fail")
	}
}

func TestAppendLogPreservesOrder(t *testing.T) {
	store := NewMemoryStore()
	created, err := store.Create(context.Background(), domain.CreateJobInput{Kind: "clip-generation"})
	if err != nil {
		t.Fatalf("create job: %v", err)
	}
	for _, message := range []string{"queued", "started", "finished"} {
		if err := store.AppendLog(context.Background(), created.ID, message); err != nil {
			t.Fatalf("append log %q: %v", message, err)
		}
	}

	loaded, ok := store.Get(context.Background(), created.ID)
	if !ok {
		t.Fatal("job was not found")
	}
	if len(loaded.Logs) != 3 || loaded.Logs[0].Message != "queued" || loaded.Logs[2].Message != "finished" {
		t.Fatalf("logs were not preserved: %#v", loaded.Logs)
	}
}

func TestSetResultPersistsCompletedPayload(t *testing.T) {
	store := NewMemoryStore()
	created, err := store.Create(context.Background(), domain.CreateJobInput{Kind: "translation"})
	if err != nil {
		t.Fatalf("create job: %v", err)
	}
	payload := json.RawMessage(`{"track":{"id":"es"}}`)
	if err := store.SetResult(context.Background(), created.ID, payload); err != nil {
		t.Fatalf("set result: %v", err)
	}
	loaded, ok := store.Get(context.Background(), created.ID)
	if !ok || string(loaded.Result) != string(payload) {
		t.Fatalf("unexpected result: %#v", loaded.Result)
	}
}

func TestClaimMovesQueuedJobToProcessingOnce(t *testing.T) {
	store := NewMemoryStore()
	created, err := store.Create(context.Background(), domain.CreateJobInput{Kind: "clip-generation"})
	if err != nil {
		t.Fatalf("create job: %v", err)
	}

	claimed, err := store.Claim(context.Background(), created.ID)
	if err != nil {
		t.Fatalf("claim job: %v", err)
	}
	if claimed.Status != domain.JobStatusProcessing {
		t.Fatalf("expected processing status, got %q", claimed.Status)
	}
	if _, err := store.Claim(context.Background(), created.ID); err == nil {
		t.Fatal("expected a completed claim to be rejected")
	}
}

func TestRecoverProcessingJobsAndListQueuedJobs(t *testing.T) {
	store := NewMemoryStore()
	queued, err := store.Create(context.Background(), domain.CreateJobInput{Kind: "queued"})
	if err != nil {
		t.Fatalf("create queued job: %v", err)
	}
	processing, err := store.Create(context.Background(), domain.CreateJobInput{Kind: "processing"})
	if err != nil {
		t.Fatalf("create processing job: %v", err)
	}
	if _, err := store.Claim(context.Background(), processing.ID); err != nil {
		t.Fatalf("claim processing job: %v", err)
	}
	if err := store.RequeueProcessing(context.Background()); err != nil {
		t.Fatalf("requeue processing jobs: %v", err)
	}
	queuedJobs, err := store.ListByStatus(context.Background(), domain.JobStatusQueued)
	if err != nil {
		t.Fatalf("list queued jobs: %v", err)
	}
	seen := map[string]bool{}
	for _, job := range queuedJobs {
		seen[job.ID] = true
	}
	if len(queuedJobs) != 2 || !seen[queued.ID] || !seen[processing.ID] {
		t.Fatalf("unexpected queued jobs: %#v", queuedJobs)
	}
}

func TestStoreListsJobsByKindAndSupportsCancellation(t *testing.T) {
	store := NewMemoryStore()
	highlight, err := store.Create(context.Background(), domain.CreateJobInput{Kind: "highlight-generation"})
	if err != nil {
		t.Fatalf("create highlight job: %v", err)
	}
	_, err = store.Create(context.Background(), domain.CreateJobInput{Kind: "clip-generation"})
	if err != nil {
		t.Fatalf("create clip job: %v", err)
	}
	jobs, err := store.ListByKind(context.Background(), "highlight-generation")
	if err != nil || len(jobs) != 1 || jobs[0].ID != highlight.ID {
		t.Fatalf("unexpected jobs by kind: %#v, %v", jobs, err)
	}
	cancelled, err := store.Transition(context.Background(), highlight.ID, domain.JobStatusCancelled, "cancelled by user")
	if err != nil {
		t.Fatalf("cancel job: %v", err)
	}
	if cancelled.Status != domain.JobStatusCancelled || cancelled.Error != "cancelled by user" {
		t.Fatalf("unexpected cancelled job: %#v", cancelled)
	}
}

func TestCreateIfNoActiveHighlightIsAtomic(t *testing.T) {
	store := NewMemoryStore()
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := store.CreateIfNoActive(context.Background(), "highlight-generation", domain.CreateJobInput{Kind: "highlight-generation"})
			results <- err
		}()
	}
	wg.Wait()
	close(results)
	created := 0
	activeErrors := 0
	for err := range results {
		if err == nil {
			created++
		} else if errors.Is(err, ErrActiveJob) {
			activeErrors++
		}
	}
	if created != 1 || activeErrors != 1 {
		t.Fatalf("expected one creation and one active-job rejection, created=%d activeErrors=%d", created, activeErrors)
	}
}
