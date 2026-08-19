package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mutonby/openshorts/backend-go/internal/config"
	"github.com/mutonby/openshorts/backend-go/internal/domain"
	"github.com/mutonby/openshorts/backend-go/internal/jobs"
)

type recordingProjectTranscription struct {
	payload map[string]any
}

func (r *recordingProjectTranscription) Run(_ context.Context, _ string, operation string, payload map[string]any, _ map[string]string) (json.RawMessage, error) {
	if operation != "transcribe" {
		return nil, fmt.Errorf("unexpected operation: %s", operation)
	}
	r.payload = payload
	return json.RawMessage(`{"language":"en","captions":[],"segments":[]}`), nil
}

func TestTranscribeProjectClipUsesCachedMasterAndClipRange(t *testing.T) {
	outputDir := t.TempDir()
	store := jobs.NewMemoryStore()
	job, err := store.Create(context.Background(), domain.CreateJobInput{Kind: "clip-generation", OutputDir: filepath.Join(outputDir, "project-1")})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(job.OutputDir, 0o755); err != nil {
		t.Fatal(err)
	}
	sourcePath := filepath.Join(job.OutputDir, "source.mp4")
	if err := os.WriteFile(sourcePath, []byte("cached master"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := store.SetResult(context.Background(), job.ID, []byte(`{"clips":[{"start":12.5,"end":20.75}]}`)); err != nil {
		t.Fatal(err)
	}
	runner := &recordingProjectTranscription{}
	server := NewServerWithDependencies(config.Config{OutputDir: outputDir}, store, nil, runner)

	request := httptest.NewRequest(http.MethodPost, "/api/projects/"+job.ID+"/clips/0/transcribe", strings.NewReader(`{}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected transcription to succeed, got %d: %s", response.Code, response.Body.String())
	}
	if got := runner.payload["source_path"]; got != sourcePath {
		t.Fatalf("expected cached master path %q, got %#v", sourcePath, got)
	}
	if got := runner.payload["start_seconds"]; got != 12.5 {
		t.Fatalf("expected clip start 12.5, got %#v", got)
	}
	if got := runner.payload["end_seconds"]; got != 20.75 {
		t.Fatalf("expected clip end 20.75, got %#v", got)
	}
}

func TestDeleteProjectRemovesItFromProjectHistory(t *testing.T) {
	store := jobs.NewMemoryStore()
	job, err := store.Create(context.Background(), domain.CreateJobInput{Kind: "clip-generation"})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetResult(context.Background(), job.ID, []byte(`{"clips":[{"video_filename":"clip.mp4"}]}`)); err != nil {
		t.Fatal(err)
	}
	server := NewServerWithStore(config.Config{OutputDir: t.TempDir()}, store)

	deleteRequest := httptest.NewRequest(http.MethodDelete, "/api/projects/"+job.ID, nil)
	deleteResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(deleteResponse, deleteRequest)
	if deleteResponse.Code != http.StatusOK {
		t.Fatalf("expected project deletion to succeed, got %d: %s", deleteResponse.Code, deleteResponse.Body.String())
	}

	historyRequest := httptest.NewRequest(http.MethodGet, "/api/projects/history", nil)
	historyResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(historyResponse, historyRequest)
	if historyResponse.Code != http.StatusOK {
		t.Fatalf("expected project history to load, got %d: %s", historyResponse.Code, historyResponse.Body.String())
	}
	if strings.Contains(historyResponse.Body.String(), job.ID) {
		t.Fatalf("deleted project still appears in history: %s", historyResponse.Body.String())
	}
}
