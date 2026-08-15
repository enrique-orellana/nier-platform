package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mutonby/openshorts/backend-go/internal/config"
	"github.com/mutonby/openshorts/backend-go/internal/domain"
	"github.com/mutonby/openshorts/backend-go/internal/jobs"
)

type failingHighlightWorker struct{}

func (failingHighlightWorker) Run(context.Context, domain.Job, string, func(string)) error {
	return errors.New("worker failed")
}

type blockingHighlightWorker struct {
	started chan struct{}
}

func (w blockingHighlightWorker) Run(ctx context.Context, _ domain.Job, _ string, _ func(string)) error {
	close(w.started)
	<-ctx.Done()
	return ctx.Err()
}

func newHighlightProjectServerWithWorker(t *testing.T, worker jobs.JobWorker) (*Server, *jobs.MemoryStore, *jobs.Scheduler) {
	t.Helper()
	store := jobs.NewMemoryStore()
	runner := &jobs.Runner{Store: store, Worker: worker}
	scheduler := jobs.NewScheduler(store, runner, 1)
	server := NewServerWithDependenciesAndScheduler(config.Config{OutputDir: t.TempDir()}, store, runner, nil, scheduler)
	if err := scheduler.Start(context.Background()); err != nil {
		t.Fatalf("start scheduler: %v", err)
	}
	t.Cleanup(func() { _ = scheduler.Stop(context.Background()) })
	return server, store, scheduler
}

func newHighlightProjectServer(t *testing.T) (*Server, *jobs.MemoryStore, *jobs.Scheduler) {
	return newHighlightProjectServerWithWorker(t, completingWorker{})
}

func createTestHighlightProject(t *testing.T, server *Server) string {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/api/highlights/projects", strings.NewReader(`{
        "name":"Episode one",
        "source_object":{"bucket":"youtube-downloads","key":"source.mp4"},
        "acknowledged":true,
        "min_minutes":12,
        "ideal_minutes":20
    }`))
	request.Header.Set("X-AI-Provider", "openai-codex")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusAccepted {
		t.Fatalf("create status=%d body=%s", response.Code, response.Body.String())
	}
	var payload map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	projectID, ok := payload["id"].(string)
	if !ok || projectID == "" {
		t.Fatalf("missing project id: %#v", payload)
	}
	return projectID
}

func TestHighlightProjectCreateReturnsProjectAndJob(t *testing.T) {
	server, _, _ := newHighlightProjectServer(t)
	request := httptest.NewRequest(http.MethodPost, "/api/highlights/projects", strings.NewReader(`{
        "name":"Episode one",
        "source_object":{"bucket":"youtube-downloads","key":"source.mp4"},
        "acknowledged":true,
        "min_minutes":12,
        "ideal_minutes":20
    }`))
	request.Header.Set("X-AI-Provider", "openai-codex")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusAccepted {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	var payload map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["id"] == nil || payload["job"] == nil || payload["source_object"] == nil {
		t.Fatalf("missing project payload: %#v", payload)
	}
}

func TestHighlightProjectDeleteRemovesGeneratedOutputOnly(t *testing.T) {
	server, store, _ := newHighlightProjectServer(t)
	projectID := createTestHighlightProject(t, server)
	projects, err := store.ListHighlightProjects(context.Background())
	if err != nil || len(projects) != 1 {
		t.Fatalf("project was not stored: %v %#v", err, projects)
	}
	jobsByKind, err := store.ListByKind(context.Background(), "highlight-generation")
	if err != nil || len(jobsByKind) != 1 {
		t.Fatalf("job was not stored: %v %#v", err, jobsByKind)
	}
	outputDir := filepath.Join(server.config.OutputDir, jobsByKind[0].ID)
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := store.SetOutputDir(context.Background(), jobsByKind[0].ID, outputDir); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodDelete, "/api/highlights/projects/"+projectID, nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if _, err := os.Stat(outputDir); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected generated output to be deleted, stat error=%v", err)
	}
}

func TestHighlightProjectRejectsMissingAcknowledgement(t *testing.T) {
	server, _, _ := newHighlightProjectServer(t)
	request := httptest.NewRequest(http.MethodPost, "/api/highlights/projects", strings.NewReader(`{
        "name":"Episode one",
        "source_object":{"bucket":"youtube-downloads","key":"source.mp4"}
    }`))
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected acknowledgement validation, got %d", response.Code)
	}
}

func TestHighlightProjectCanRetryAfterFailure(t *testing.T) {
	server, store, _ := newHighlightProjectServerWithWorker(t, failingHighlightWorker{})
	projectID := createTestHighlightProject(t, server)
	deadline := time.Now().Add(time.Second)
	var jobsByKind []domain.Job
	for time.Now().Before(deadline) {
		jobsByKind, _ = store.ListByKind(context.Background(), "highlight-generation")
		if len(jobsByKind) == 1 && jobsByKind[0].Status == domain.JobStatusFailed {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if len(jobsByKind) != 1 || jobsByKind[0].Status != domain.JobStatusFailed {
		t.Fatalf("initial job did not fail: %#v", jobsByKind)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/highlights/projects/"+projectID+"/retry", nil)
	request.Header.Set("X-AI-Provider", "openai-codex")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusAccepted {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}

	deadline = time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		jobsByKind, _ = store.ListByKind(context.Background(), "highlight-generation")
		if len(jobsByKind) == 2 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("expected retry job, got %#v", jobsByKind)
}

func TestHighlightProjectDeleteWaitsForProcessingCancellation(t *testing.T) {
	worker := blockingHighlightWorker{started: make(chan struct{})}
	server, _, _ := newHighlightProjectServerWithWorker(t, worker)
	projectID := createTestHighlightProject(t, server)
	select {
	case <-worker.started:
	case <-time.After(time.Second):
		t.Fatal("worker did not start")
	}

	request := httptest.NewRequest(http.MethodDelete, "/api/highlights/projects/"+projectID, nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusConflict {
		t.Fatalf("expected delete to wait for cancellation, got %d: %s", response.Code, response.Body.String())
	}
}
