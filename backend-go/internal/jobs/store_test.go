package jobs

import (
	"context"
	"encoding/json"
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
