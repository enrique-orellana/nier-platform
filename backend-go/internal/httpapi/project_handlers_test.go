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

func TestProjectHistoryIncludesSourceMetadataOnProjectAndClips(t *testing.T) {
	store := jobs.NewMemoryStore()
	job, err := store.Create(context.Background(), domain.CreateJobInput{Kind: "clip-generation"})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetResult(context.Background(), job.ID, []byte(`{"source_metadata":{"platform":"youtube","title":"A source video worth watching","channel":"OpenShorts"},"clips":[{"start":1,"end":5}]}`)); err != nil {
		t.Fatal(err)
	}

	server := NewServerWithStore(config.Config{OutputDir: t.TempDir()}, store)
	request := httptest.NewRequest(http.MethodGet, "/api/projects/history", nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected project history to load, got %d: %s", response.Code, response.Body.String())
	}
	var payload struct {
		Projects []struct {
			SourceMetadata map[string]any   `json:"source_metadata"`
			Clips          []map[string]any `json:"clips"`
		} `json:"projects"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Projects) != 1 || len(payload.Projects[0].Clips) != 1 {
		t.Fatalf("unexpected project history payload: %#v", payload)
	}
	if payload.Projects[0].SourceMetadata["title"] != "A source video worth watching" {
		t.Fatalf("project source metadata missing: %#v", payload.Projects[0].SourceMetadata)
	}
	clipMetadata, ok := payload.Projects[0].Clips[0]["source_metadata"].(map[string]any)
	if !ok || clipMetadata["channel"] != "OpenShorts" {
		t.Fatalf("clip source metadata missing: %#v", payload.Projects[0].Clips[0])
	}
}

func TestProjectHistoryRecoversSourceMetadataFromPersistedMetadataFile(t *testing.T) {
	store := jobs.NewMemoryStore()
	job, err := store.Create(context.Background(), domain.CreateJobInput{Kind: "clip-generation"})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetResult(context.Background(), job.ID, []byte(`{"clips":[{"start":1,"end":5}]}`)); err != nil {
		t.Fatal(err)
	}
	outputDir := t.TempDir()
	jobOutputDir := filepath.Join(outputDir, job.ID)
	if err := os.MkdirAll(jobOutputDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(jobOutputDir, "source_video_metadata.json"), []byte(`{"source_metadata":{"platform":"youtube","title":"Recovered source","channel":"OpenShorts"},"shorts":[{}]}`), 0o644); err != nil {
		t.Fatal(err)
	}

	server := NewServerWithStore(config.Config{OutputDir: outputDir}, store)
	request := httptest.NewRequest(http.MethodGet, "/api/projects/history", nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected project history to load, got %d: %s", response.Code, response.Body.String())
	}
	var payload struct {
		Projects []struct {
			SourceMetadata map[string]any `json:"source_metadata"`
		} `json:"projects"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Projects) != 1 || payload.Projects[0].SourceMetadata["title"] != "Recovered source" {
		t.Fatalf("persisted metadata file was not recovered: %#v", payload)
	}
}

func TestProjectAuditReturnsOrderedEventsAndEffectivePolicy(t *testing.T) {
	store := jobs.NewMemoryStore()
	job, err := store.Create(context.Background(), domain.CreateJobInput{Kind: "clip-generation"})
	if err != nil {
		t.Fatal(err)
	}
	started, err := store.StartAuditEvent(context.Background(), job.ID, domain.StartAuditEventInput{
		Category:    "external_request",
		Name:        "ai.analysis",
		Provider:    "openrouter",
		Host:        "openrouter.ai",
		Method:      "POST",
		RequestBody: `{"prompt":"hello"}`,
		CaptureMode: "full_redacted",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.FinishAuditEvent(context.Background(), job.ID, started.ID, domain.FinishAuditEventInput{
		Status:       domain.AuditEventStatusCompleted,
		HTTPStatus:   200,
		ResponseBody: `{"result":"ok"}`,
	}); err != nil {
		t.Fatal(err)
	}
	server := NewServerWithStore(config.Config{AuditBodyHostAllowlist: []string{"chatgpt.com", "openrouter.ai"}}, store)

	request := httptest.NewRequest(http.MethodGet, "/api/projects/"+job.ID+"/audit", nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("expected audit request to succeed, got %d: %s", response.Code, response.Body.String())
	}
	var payload struct {
		JobID  string           `json:"job_id"`
		Policy map[string]any   `json:"policy"`
		Events []map[string]any `json:"events"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.JobID != job.ID || len(payload.Events) != 1 {
		t.Fatalf("unexpected audit payload: %#v", payload)
	}
	if payload.Events[0]["sequence"] != float64(1) || payload.Events[0]["request_body"] != `{"prompt":"hello"}` {
		t.Fatalf("unexpected event payload: %#v", payload.Events[0])
	}
	allowlisted, ok := payload.Policy["body_allowlist"].([]any)
	if !ok || len(allowlisted) != 2 {
		t.Fatalf("unexpected audit policy: %#v", payload.Policy)
	}
}

func TestProjectAuditRejectsUnknownProjectsAndNonGetMethods(t *testing.T) {
	server := NewServer(config.Config{})
	missingRequest := httptest.NewRequest(http.MethodGet, "/api/projects/missing/audit", nil)
	missingResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(missingResponse, missingRequest)
	if missingResponse.Code != http.StatusNotFound {
		t.Fatalf("expected missing project to return 404, got %d", missingResponse.Code)
	}

	store := jobs.NewMemoryStore()
	job, err := store.Create(context.Background(), domain.CreateJobInput{Kind: "clip-generation"})
	if err != nil {
		t.Fatal(err)
	}
	server = NewServerWithStore(config.Config{}, store)
	postRequest := httptest.NewRequest(http.MethodPost, "/api/projects/"+job.ID+"/audit", nil)
	postResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(postResponse, postRequest)
	if postResponse.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected non-GET audit request to return 405, got %d", postResponse.Code)
	}
}
