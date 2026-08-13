package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/mutonby/openshorts/backend-go/internal/config"
	"github.com/mutonby/openshorts/backend-go/internal/domain"
	"github.com/mutonby/openshorts/backend-go/internal/jobs"
)

type completingWorker struct{}

func (completingWorker) Run(_ context.Context, _ domain.Job, _ string, onLog func(string)) error {
	onLog("python worker completed")
	return nil
}

type completingTranslation struct{}

func (completingTranslation) Run(_ context.Context, _ string, _ string, _ map[string]any, _ map[string]string) (json.RawMessage, error) {
	return json.RawMessage(`{"track":{"id":"es","label":"ES"}}`), nil
}

func TestHealthReturnsOK(t *testing.T) {
	server := NewServer(config.Config{})
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	res := httptest.NewRecorder()

	server.Handler().ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", res.Code)
	}
	if got := res.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("expected JSON content type, got %q", got)
	}
	var payload map[string]string
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload["status"] != "ok" {
		t.Fatalf("expected status ok, got %#v", payload)
	}
}

func TestConfigReturnsRuntimeSettings(t *testing.T) {
	cfg := config.Config{
		Port:              8123,
		MaxConcurrentJobs: 7,
		RenderServiceURL:  "http://renderer:3100",
	}
	server := NewServer(cfg)
	req := httptest.NewRequest(http.MethodGet, "/api/config", nil)
	res := httptest.NewRecorder()

	server.Handler().ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", res.Code)
	}
	var payload struct {
		Port              int    `json:"port"`
		MaxConcurrentJobs int    `json:"max_concurrent_jobs"`
		RenderServiceURL  string `json:"render_service_url"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Port != 8123 || payload.MaxConcurrentJobs != 7 || payload.RenderServiceURL != "http://renderer:3100" {
		t.Fatalf("unexpected config payload: %#v", payload)
	}
}

func TestUnknownRouteReturnsJSONNotFound(t *testing.T) {
	server := NewServer(config.Config{})
	req := httptest.NewRequest(http.MethodGet, "/missing", nil)
	res := httptest.NewRecorder()

	server.Handler().ServeHTTP(res, req)

	if res.Code != http.StatusNotFound {
		t.Fatalf("expected status 404, got %d", res.Code)
	}
	var payload map[string]string
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload["detail"] != "Not found" {
		t.Fatalf("unexpected error payload: %#v", payload)
	}
}

func TestProcessCreatesQueuedJob(t *testing.T) {
	server := NewServer(config.Config{})
	req := httptest.NewRequest(http.MethodPost, "/api/process", strings.NewReader(`{"url":"https://example.com/video.mp4","acknowledged":true,"clip_count":6}`))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()

	server.Handler().ServeHTTP(res, req)

	if res.Code != http.StatusAccepted {
		t.Fatalf("expected status 202, got %d: %s", res.Code, res.Body.String())
	}
	var payload struct {
		JobID  string `json:"job_id"`
		Status string `json:"status"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.JobID == "" || payload.Status != "queued" {
		t.Fatalf("unexpected process response: %#v", payload)
	}

	statusReq := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/status/%s", payload.JobID), nil)
	statusRes := httptest.NewRecorder()
	server.Handler().ServeHTTP(statusRes, statusReq)
	if statusRes.Code != http.StatusOK {
		t.Fatalf("expected status lookup 200, got %d", statusRes.Code)
	}
	var statusPayload struct {
		Status string   `json:"status"`
		Logs   []string `json:"logs"`
		Result any      `json:"result"`
	}
	if err := json.NewDecoder(statusRes.Body).Decode(&statusPayload); err != nil {
		t.Fatalf("decode status response: %v", err)
	}
	if statusPayload.Status != "queued" || len(statusPayload.Logs) != 1 || statusPayload.Result != nil {
		t.Fatalf("unexpected status response: %#v", statusPayload)
	}
}

func TestProcessStartsConfiguredWorker(t *testing.T) {
	store := jobs.NewMemoryStore()
	runner := &jobs.Runner{Store: store, Worker: completingWorker{}}
	server := NewServerWithStoreAndRunner(config.Config{}, store, runner)
	req := httptest.NewRequest(http.MethodPost, "/api/process", strings.NewReader(`{"url":"https://example.com/video.mp4","acknowledged":true}`))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()

	server.Handler().ServeHTTP(res, req)
	if res.Code != http.StatusAccepted {
		t.Fatalf("expected status 202, got %d: %s", res.Code, res.Body.String())
	}
	var payload struct {
		JobID string `json:"job_id"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode process response: %v", err)
	}

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		job, ok := store.Get(context.Background(), payload.JobID)
		if ok && job.Status == domain.JobStatusCompleted {
			if len(job.Logs) != 3 || job.Logs[2].Message != "python worker completed" {
				t.Fatalf("unexpected worker logs: %#v", job.Logs)
			}
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("job did not complete: %#v", payload)
}

func TestLocalEditorTranslationUsesGoJobAndPythonOperationBoundary(t *testing.T) {
	store := jobs.NewMemoryStore()
	server := NewServerWithDependencies(config.Config{}, store, nil, completingTranslation{})
	req := httptest.NewRequest(http.MethodPost, "/api/local-editor/translate", strings.NewReader(`{"target_language":"es","tracks":[{"id":"original","language":"en","cues":[{"text":"Hello"}]}]}`))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()

	server.Handler().ServeHTTP(res, req)
	if res.Code != http.StatusAccepted {
		t.Fatalf("expected status 202, got %d: %s", res.Code, res.Body.String())
	}
	var created struct {
		ID     string `json:"translationId"`
		Status string `json:"status"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode create response: %v", err)
	}
	if created.ID == "" || created.Status != "queued" {
		t.Fatalf("unexpected create response: %#v", created)
	}

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		statusReq := httptest.NewRequest(http.MethodGet, "/api/translation/"+created.ID, nil)
		statusRes := httptest.NewRecorder()
		server.Handler().ServeHTTP(statusRes, statusReq)
		if statusRes.Code == http.StatusOK {
			var status struct {
				Status string `json:"status"`
				Track  struct {
					ID string `json:"id"`
				} `json:"track"`
			}
			if err := json.Unmarshal(statusRes.Body.Bytes(), &status); err != nil {
				t.Fatalf("decode status response: %v", err)
			}
			if status.Status == "done" {
				if status.Track.ID != "es" {
					t.Fatalf("unexpected translated track: %#v", status)
				}
				return
			}
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("translation did not complete")
}

func TestRenderRoutesProxyToRendererService(t *testing.T) {
	renderer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/render" && r.Method == http.MethodPost {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"renderId":"render-1","status":"queued"}`))
			return
		}
		if r.URL.Path == "/render/render-1" && r.Method == http.MethodGet {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"renderId":"render-1","status":"done"}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer renderer.Close()

	server := NewServer(config.Config{RenderServiceURL: renderer.URL})
	createReq := httptest.NewRequest(http.MethodPost, "/api/render", strings.NewReader(`{"props":{"videoUrl":"/api/video-proxy?url=https://example.com/video.mp4"}}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRes := httptest.NewRecorder()
	server.Handler().ServeHTTP(createRes, createReq)
	if createRes.Code != http.StatusOK || !strings.Contains(createRes.Body.String(), `"renderId":"render-1"`) {
		t.Fatalf("unexpected render response: %d %s", createRes.Code, createRes.Body.String())
	}

	statusReq := httptest.NewRequest(http.MethodGet, "/api/render/render-1", nil)
	statusRes := httptest.NewRecorder()
	server.Handler().ServeHTTP(statusRes, statusReq)
	if statusRes.Code != http.StatusOK || !strings.Contains(statusRes.Body.String(), `"status":"done"`) {
		t.Fatalf("unexpected render status: %d %s", statusRes.Code, statusRes.Body.String())
	}
}

func TestProcessRequiresRightsAcknowledgement(t *testing.T) {
	server := NewServer(config.Config{})
	req := httptest.NewRequest(http.MethodPost, "/api/process", strings.NewReader(`{"url":"https://example.com/video.mp4"}`))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()

	server.Handler().ServeHTTP(res, req)

	if res.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d", res.Code)
	}
	body, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatalf("read response: %v", err)
	}
	var payload map[string]string
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload["detail"] != "You must confirm you own the content or have rights to process it." {
		t.Fatalf("unexpected validation detail: %#v", payload)
	}
}

func TestStatusReturnsNotFoundForUnknownJob(t *testing.T) {
	server := NewServer(config.Config{})
	req := httptest.NewRequest(http.MethodGet, "/api/status/missing-job", nil)
	res := httptest.NewRecorder()

	server.Handler().ServeHTTP(res, req)

	if res.Code != http.StatusNotFound {
		t.Fatalf("expected status 404, got %d", res.Code)
	}
	var payload map[string]string
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload["detail"] != "Job not found" {
		t.Fatalf("unexpected error payload: %#v", payload)
	}
}
