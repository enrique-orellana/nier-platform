package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

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

func TestDeferredGenerationCanTransitionToClipsReady(t *testing.T) {
	store := NewMemoryStore()
	created, err := store.Create(context.Background(), domain.CreateJobInput{Kind: "clip-generation"})
	if err != nil {
		t.Fatalf("create job: %v", err)
	}
	if _, err := store.Transition(context.Background(), created.ID, domain.JobStatusProcessing, ""); err != nil {
		t.Fatalf("transition to processing: %v", err)
	}
	ready, err := store.Transition(context.Background(), created.ID, domain.JobStatusClipsReady, "")
	if err != nil {
		t.Fatalf("transition to clips_ready: %v", err)
	}
	if ready.Status != domain.JobStatusClipsReady || ready.Error != "" {
		t.Fatalf("unexpected clips-ready job: %#v", ready)
	}
}

func TestCreateClipRenderIfAbsentReusesActiveAndRerendersCompleted(t *testing.T) {
	store := NewMemoryStore()
	input := domain.CreateJobInput{
		Kind:        "clip-render",
		ParentJobID: "parent-1",
		ClipIndex:   2,
		OutputDir:   "output/parent-1",
	}

	first, err := store.CreateClipRenderIfAbsent(context.Background(), input)
	if err != nil {
		t.Fatalf("create first clip render: %v", err)
	}
	claimed, err := store.Claim(context.Background(), first.ID)
	if err != nil {
		t.Fatalf("claim first clip render: %v", err)
	}
	active, err := store.CreateClipRenderIfAbsent(context.Background(), input)
	if err != nil {
		t.Fatalf("get active clip render: %v", err)
	}
	if active.ID != claimed.ID || active.Status != domain.JobStatusProcessing {
		t.Fatalf("expected active render to be reused: %#v", active)
	}
	if _, err := store.Transition(context.Background(), first.ID, domain.JobStatusCompleted, ""); err != nil {
		t.Fatalf("complete first clip render: %v", err)
	}
	ready, err := store.CreateClipRenderIfAbsent(context.Background(), input)
	if err != nil {
		t.Fatalf("create rerender after completed clip render: %v", err)
	}
	if ready.ID == first.ID || ready.Status != domain.JobStatusQueued {
		t.Fatalf("expected completed render to create a new queued job: %#v", ready)
	}

	failedInput := input
	failedInput.ClipIndex = 3
	failed, err := store.CreateClipRenderIfAbsent(context.Background(), failedInput)
	if err != nil {
		t.Fatalf("create retry fixture: %v", err)
	}
	if _, err := store.Claim(context.Background(), failed.ID); err != nil {
		t.Fatalf("claim retry fixture: %v", err)
	}
	if _, err := store.Transition(context.Background(), failed.ID, domain.JobStatusFailed, "render failed"); err != nil {
		t.Fatalf("fail retry fixture: %v", err)
	}
	retry, err := store.CreateClipRenderIfAbsent(context.Background(), failedInput)
	if err != nil {
		t.Fatalf("create failed render retry: %v", err)
	}
	if retry.ID == failed.ID || retry.Status != domain.JobStatusQueued {
		t.Fatalf("expected failed render to be retried: %#v", retry)
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

func TestMemoryStorePersistsAuditEventBodiesAndSequence(t *testing.T) {
	store := NewMemoryStore()
	job, err := store.Create(context.Background(), domain.CreateJobInput{Kind: "audit-test"})
	if err != nil {
		t.Fatalf("create job: %v", err)
	}

	event, err := store.StartAuditEvent(context.Background(), job.ID, domain.StartAuditEventInput{
		Category:           "external_request",
		Name:               "ai.analysis",
		Host:               "openrouter.ai",
		Path:               "/api/v1/chat/completions",
		Method:             "POST",
		RequestBody:        `{"prompt":"safe","api_key":"[REDACTED]"}`,
		RequestContentType: "application/json",
		CaptureMode:        "full_redacted",
	})
	if err != nil {
		t.Fatalf("start audit event: %v", err)
	}

	finishedAt := event.StartedAt.Add(1250 * time.Millisecond)
	finished, err := store.FinishAuditEvent(context.Background(), job.ID, event.ID, domain.FinishAuditEventInput{
		Status:              domain.AuditEventStatusCompleted,
		HTTPStatus:          200,
		ResponseBody:        `{"choices":[{"message":{"content":"safe"}}]}`,
		ResponseContentType: "application/json",
		ResponseBytes:       47,
		FinishedAt:          finishedAt,
		DurationMS:          1250,
	})
	if err != nil {
		t.Fatalf("finish audit event: %v", err)
	}
	if finished.Status != domain.AuditEventStatusCompleted {
		t.Fatalf("expected completed event, got %q", finished.Status)
	}

	events, err := store.ListAuditEvents(context.Background(), job.ID)
	if err != nil {
		t.Fatalf("list audit events: %v", err)
	}
	if len(events) != 1 || events[0].Sequence != 1 {
		t.Fatalf("unexpected audit event sequence: %#v", events)
	}
	if events[0].RequestBody != `{"prompt":"safe","api_key":"[REDACTED]"}` || events[0].ResponseBody == "" {
		t.Fatalf("audit bodies were not preserved: %#v", events[0])
	}
	if events[0].DurationMS != 1250 || !events[0].FinishedAt.Equal(finishedAt) {
		t.Fatalf("audit timing was not preserved: %#v", events[0])
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
