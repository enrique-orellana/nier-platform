package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/mutonby/openshorts/backend-go/internal/config"
	"github.com/mutonby/openshorts/backend-go/internal/domain"
	"github.com/mutonby/openshorts/backend-go/internal/integrations"
	"github.com/mutonby/openshorts/backend-go/internal/jobs"
	"github.com/mutonby/openshorts/backend-go/internal/manifests"
)

func TestLegacyVideoRouteRedirectsToRendererOutput(t *testing.T) {
	server := NewServer(config.Config{OutputDir: t.TempDir()})

	request := httptest.NewRequest(http.MethodGet, "/videos/job-1/source.mp4", nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusTemporaryRedirect {
		t.Fatalf("expected legacy video route to redirect, got %d: %s", response.Code, response.Body.String())
	}
	if location := response.Header().Get("Location"); location != "/output/job-1/source.mp4" {
		t.Fatalf("unexpected redirect location: %q", location)
	}
}

func TestLegacyMasterVideoRouteRedirectsToMinioWhenConfigured(t *testing.T) {
	server := NewServer(config.Config{OutputDir: t.TempDir()})
	server.s3Store = &integrations.S3Store{Bucket: "openshorts-media", PublicURLBase: "https://minio.example"}
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/videos/job-1/master_0_version-1_123.mp4", nil))

	if response.Code != http.StatusTemporaryRedirect {
		t.Fatalf("expected redirect, got %d: %s", response.Code, response.Body.String())
	}
	if location := response.Header().Get("Location"); location != "https://minio.example/openshorts-media/job-1/master/master_0_version-1_123.mp4" {
		t.Fatalf("unexpected MinIO location: %s", location)
	}
}

type completingWorker struct{}

func (completingWorker) Run(_ context.Context, _ domain.Job, _ string, onLog func(string)) error {
	onLog("python worker completed")
	return nil
}

func TestHighlightsCreateRequiresAcknowledgementAndQueuesMinioJob(t *testing.T) {
	store := jobs.NewMemoryStore()
	runner := &jobs.Runner{Store: store, Worker: completingWorker{}}
	scheduler := jobs.NewScheduler(store, runner, 1)
	server := NewServerWithDependenciesAndScheduler(config.Config{OutputDir: t.TempDir()}, store, runner, nil, scheduler)
	if err := scheduler.Start(context.Background()); err != nil {
		t.Fatalf("start scheduler: %v", err)
	}
	defer scheduler.Stop(context.Background())

	missingAck := httptest.NewRecorder()
	server.Handler().ServeHTTP(missingAck, httptest.NewRequest(http.MethodPost, "/api/highlights", strings.NewReader(`{"source_object":{"bucket":"youtube-downloads","key":"source.mp4"}}`)))
	if missingAck.Code != http.StatusBadRequest {
		t.Fatalf("expected acknowledgement validation, got %d", missingAck.Code)
	}

	request := httptest.NewRequest(http.MethodPost, "/api/highlights", strings.NewReader(`{"source_object":{"bucket":"youtube-downloads","key":"source.mp4"},"acknowledged":true,"min_minutes":12,"ideal_minutes":20}`))
	request.Header.Set("X-AI-Provider", "ollama")
	queued := httptest.NewRecorder()
	server.Handler().ServeHTTP(queued, request)
	if queued.Code != http.StatusAccepted {
		t.Fatalf("expected highlight job to be accepted, got %d: %s", queued.Code, queued.Body.String())
	}
	var payload map[string]any
	if err := json.Unmarshal(queued.Body.Bytes(), &payload); err != nil || payload["id"] == "" {
		t.Fatalf("unexpected highlight response: %s", queued.Body.String())
	}
}

func TestHighlightsNeverReturnsOrPersistsAIHeaders(t *testing.T) {
	store := jobs.NewMemoryStore()
	runner := &jobs.Runner{Store: store, Worker: completingWorker{}}
	scheduler := jobs.NewScheduler(store, runner, 1)
	server := NewServerWithDependenciesAndScheduler(config.Config{OutputDir: t.TempDir()}, store, runner, nil, scheduler)
	if err := scheduler.Start(context.Background()); err != nil {
		t.Fatalf("start scheduler: %v", err)
	}
	defer scheduler.Stop(context.Background())

	request := httptest.NewRequest(http.MethodPost, "/api/highlights", strings.NewReader(`{"source_object":{"bucket":"youtube-downloads","key":"source.mp4"},"acknowledged":true}`))
	request.Header.Set("X-AI-Provider", "gemini")
	request.Header.Set("X-Gemini-Key", "super-secret")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if strings.Contains(response.Body.String(), "super-secret") {
		t.Fatalf("response leaked AI credentials: %s", response.Body.String())
	}
	jobsByKind, err := store.ListByKind(context.Background(), "highlight-generation")
	if err != nil || len(jobsByKind) != 1 {
		t.Fatalf("expected one stored job: %v %#v", err, jobsByKind)
	}
	if _, ok := jobsByKind[0].Metadata["headers"]; ok {
		t.Fatalf("stored job contains raw headers: %#v", jobsByKind[0].Metadata)
	}
}

type completingTranslation struct{}

func (completingTranslation) Run(_ context.Context, _ string, _ string, _ map[string]any, _ map[string]string) (json.RawMessage, error) {
	return json.RawMessage(`{"track":{"id":"es","label":"ES"}}`), nil
}

type galleryOperation struct{}

func (galleryOperation) Run(_ context.Context, _ string, operation string, payload map[string]any, _ map[string]string) (json.RawMessage, error) {
	if operation != "legacy_api" || payload["action"] != "saas_gallery" {
		return nil, fmt.Errorf("unexpected gallery request: %s %#v", operation, payload)
	}
	return json.RawMessage(`{"videos":[{"video_id":"v1","title":"Demo","video_url":"/videos/v1.mp4","actor_url":"/videos/v1.png","caption":"A demo","full_narration":"Full narration","product_name":"Product","product_url":"https://example.com/product","video_mode":"lowcost","duration":12.5,"language":"en","hashtags":["#demo"],"cost_estimate":{"total":1.25},"created_at":"2026-08-13T12:00:00Z","actor_description":"Friendly actor"}],"total":1}`), nil
}

type blockingThumbnailOperation struct {
	started chan map[string]any
	release chan struct{}
}

func (o blockingThumbnailOperation) Run(_ context.Context, _ string, operation string, payload map[string]any, _ map[string]string) (json.RawMessage, error) {
	if operation != "legacy_api" || payload["action"] != "thumbnail_publish" {
		return nil, fmt.Errorf("unexpected thumbnail publish request: %s %#v", operation, payload)
	}
	o.started <- payload
	<-o.release
	return json.RawMessage(`{"publish_id":"worker-result","status":"done","result":{"upload_id":"upload-1"},"error":null}`), nil
}

type transcribingOperation struct{}

func (transcribingOperation) Run(_ context.Context, _ string, operation string, payload map[string]any, _ map[string]string) (json.RawMessage, error) {
	if operation != "transcribe" || payload["source_path"] == "" {
		return nil, fmt.Errorf("unexpected transcription request: %s %#v", operation, payload)
	}
	return json.RawMessage(`{"language":"en","captions":[],"segments":[]}`), nil
}

type codexOperation struct{}

func (codexOperation) Run(_ context.Context, _ string, operation string, _ map[string]any, _ map[string]string) (json.RawMessage, error) {
	switch operation {
	case "codex_status":
		return json.RawMessage(`{"connected":true,"pending":false}`), nil
	case "codex_disconnect":
		return json.RawMessage(`{"connected":false,"pending":false}`), nil
	case "codex_models":
		return json.RawMessage(`{"models":[{"id":"gpt-test"}],"defaultModel":"gpt-test"}`), nil
	default:
		return nil, fmt.Errorf("unexpected operation %s", operation)
	}
}

type hashtagOperation struct{}

func (hashtagOperation) Run(_ context.Context, _ string, operation string, _ map[string]any, _ map[string]string) (json.RawMessage, error) {
	if operation != "hashtags" {
		return nil, fmt.Errorf("unexpected operation %s", operation)
	}
	return json.RawMessage(`{"hashtags":["#one","#two"]}`), nil
}

type clipInfoOperation struct{}

func (clipInfoOperation) Run(_ context.Context, _ string, operation string, payload map[string]any, _ map[string]string) (json.RawMessage, error) {
	if operation != "clip_info" || payload["trim_start_seconds"] != float64(120) {
		return nil, fmt.Errorf("unexpected clip info request: %s %#v", operation, payload)
	}
	return json.RawMessage(`{"video_title_for_youtube_short":"New title","video_description_for_tiktok":"TikTok caption","video_description_for_instagram":"Instagram caption","viral_hook_text":"NEW HOOK"}`), nil
}

type incompleteClipInfoOperation struct{}

func (incompleteClipInfoOperation) Run(_ context.Context, _ string, operation string, _ map[string]any, _ map[string]string) (json.RawMessage, error) {
	if operation != "clip_info" {
		return nil, fmt.Errorf("unexpected operation %s", operation)
	}
	return json.RawMessage(`{}`), nil
}

type burnOperation struct{}

func (burnOperation) Run(_ context.Context, _ string, operation string, payload map[string]any, _ map[string]string) (json.RawMessage, error) {
	if operation != "burn_subtitles" || payload["source_path"] == "" {
		return nil, fmt.Errorf("unexpected burn request: %s %#v", operation, payload)
	}
	return json.RawMessage(`{"outputUrl":"/videos/local-editor-1/subtitled_source.mp4"}`), nil
}

type clipVideoURLOperation struct{}

func (clipVideoURLOperation) Run(_ context.Context, _ string, operation string, _ map[string]any, _ map[string]string) (json.RawMessage, error) {
	if operation != "legacy_api" {
		return nil, fmt.Errorf("unexpected operation: %s", operation)
	}
	return json.RawMessage(`{"success":true}`), nil
}

type subtitleCommandRunner struct{ args []string }

func (r *subtitleCommandRunner) Run(_ context.Context, _ string, args ...string) error {
	r.args = args
	return os.WriteFile(args[len(args)-1], []byte("video"), 0o644)
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

func TestReadinessRequiresStartedScheduler(t *testing.T) {
	store := jobs.NewMemoryStore()
	runner := &jobs.Runner{Store: store, Worker: completingWorker{}}
	scheduler := jobs.NewScheduler(store, runner, 1)
	server := NewServerWithDependenciesAndScheduler(config.Config{}, store, runner, completingTranslation{}, scheduler)

	notReady := httptest.NewRecorder()
	server.Handler().ServeHTTP(notReady, httptest.NewRequest(http.MethodGet, "/ready", nil))
	if notReady.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected unstarted scheduler to be unavailable, got %d", notReady.Code)
	}
	if err := scheduler.Start(context.Background()); err != nil {
		t.Fatalf("start scheduler: %v", err)
	}
	defer scheduler.Stop(context.Background())

	ready := httptest.NewRecorder()
	server.Handler().ServeHTTP(ready, httptest.NewRequest(http.MethodGet, "/ready", nil))
	if ready.Code != http.StatusOK || !strings.Contains(ready.Body.String(), `"status":"ready"`) {
		t.Fatalf("expected ready response, got %d %s", ready.Code, ready.Body.String())
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
	if !strings.Contains(res.Body.String(), `"youtubeUrlEnabled":true`) || !strings.Contains(res.Body.String(), `"lmStudioConfig"`) {
		t.Fatalf("config is missing frontend provider fields: %s", res.Body.String())
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

func TestGalleryPageRendersWorkerVideos(t *testing.T) {
	server := NewServerWithDependencies(config.Config{}, jobs.NewMemoryStore(), nil, galleryOperation{})
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/gallery", nil))
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), "/video/v1") || !strings.Contains(res.Body.String(), "Demo") || !strings.Contains(res.Body.String(), "robots") || !strings.Contains(res.Body.String(), "CollectionPage") || !strings.Contains(res.Body.String(), "Product") {
		t.Fatalf("unexpected gallery response: %d %s", res.Code, res.Body.String())
	}
}

func TestVideoPageRendersSelectedVideoAndNotFound(t *testing.T) {
	server := NewServerWithDependencies(config.Config{}, jobs.NewMemoryStore(), nil, galleryOperation{})
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/video/v1", nil))
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), "Demo") || !strings.Contains(res.Body.String(), "/videos/v1.mp4") || !strings.Contains(res.Body.String(), "VideoObject") || !strings.Contains(res.Body.String(), "Full narration") || !strings.Contains(res.Body.String(), "Friendly actor") || !strings.Contains(res.Body.String(), "#demo") || !strings.Contains(res.Body.String(), "Product") {
		t.Fatalf("unexpected video response: %d %s", res.Code, res.Body.String())
	}
	missing := httptest.NewRecorder()
	server.Handler().ServeHTTP(missing, httptest.NewRequest(http.MethodGet, "/video/missing", nil))
	if missing.Code != http.StatusNotFound {
		t.Fatalf("expected missing video 404, got %d", missing.Code)
	}
}

func TestThumbnailPublishReturnsBeforeWorkerCompletes(t *testing.T) {
	started := make(chan map[string]any, 1)
	release := make(chan struct{})
	server := NewServerWithDependencies(config.Config{OutputDir: t.TempDir()}, jobs.NewMemoryStore(), nil, blockingThumbnailOperation{started: started, release: release})
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	_ = writer.WriteField("session_id", "session-1")
	_ = writer.WriteField("title", "Demo")
	_ = writer.WriteField("description", "Description")
	_ = writer.WriteField("thumbnail_url", "/thumbnails/session-1/thumb.jpg")
	_ = writer.WriteField("api_key", "key")
	_ = writer.WriteField("user_id", "user")
	_ = writer.Close()
	request := httptest.NewRequest(http.MethodPost, "/api/thumbnail/publish", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		recorder := httptest.NewRecorder()
		server.Handler().ServeHTTP(recorder, request)
		response <- recorder
	}()
	var payload map[string]any
	select {
	case recorder := <-response:
		if recorder.Code != http.StatusAccepted {
			t.Fatalf("expected 202, got %d: %s", recorder.Code, recorder.Body.String())
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
	case <-time.After(500 * time.Millisecond):
		close(release)
		t.Fatal("publish request waited for worker completion")
	}
	select {
	case workerPayload := <-started:
		if payload["publish_id"] != workerPayload["publish_id"] || payload["status"] != "uploading" {
			t.Fatalf("publish ID/status not propagated: response=%#v worker=%#v", payload, workerPayload)
		}
	case <-time.After(time.Second):
		close(release)
		t.Fatal("worker was not started")
	}
	close(release)
}

func TestProcessCreatesQueuedJob(t *testing.T) {
	server := NewServer(config.Config{})
	req := httptest.NewRequest(http.MethodPost, "/api/process", strings.NewReader(`{"url":"https://example.com/video.mp4","acknowledged":true,"clip_count":6}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-AI-Api-Key", "test-key")
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

func TestProcessRejectsMissingRemoteTranscriptionApiKey(t *testing.T) {
	server := NewServer(config.Config{})
	req := httptest.NewRequest(http.MethodPost, "/api/process", strings.NewReader(`{"url":"https://example.com/video.mp4","acknowledged":true,"clip_count":6}`))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()

	server.Handler().ServeHTTP(res, req)

	if res.Code != http.StatusBadRequest || !strings.Contains(res.Body.String(), "OpenRouter API key is required") {
		t.Fatalf("expected missing transcription key validation, got %d: %s", res.Code, res.Body.String())
	}
}

func TestProcessStoresStreamerLayoutOptions(t *testing.T) {
	store := jobs.NewMemoryStore()
	server := NewServerWithStore(config.Config{}, store)
	req := httptest.NewRequest(http.MethodPost, "/api/process", strings.NewReader(`{"url":"https://example.com/video.mp4","acknowledged":true,"layout_format":"streamer_stack","facecam_size":"large"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-AI-Api-Key", "test-key")
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(res, req)
	if res.Code != http.StatusAccepted {
		t.Fatalf("expected status 202, got %d: %s", res.Code, res.Body.String())
	}
	var payload struct {
		JobID string `json:"job_id"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	job, ok := store.Get(context.Background(), payload.JobID)
	if !ok {
		t.Fatal("job was not stored")
	}
	if job.Metadata["layout_format"] != "streamer_stack" || job.Metadata["facecam_size"] != "large" {
		t.Fatalf("layout options were not stored: %#v", job.Metadata)
	}
}

func TestProcessRejectsInvalidStreamerLayoutOptions(t *testing.T) {
	server := NewServer(config.Config{})
	req := httptest.NewRequest(http.MethodPost, "/api/process", strings.NewReader(`{"url":"https://example.com/video.mp4","acknowledged":true,"layout_format":"split_screen"}`))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(res, req)
	if res.Code != http.StatusBadRequest || !strings.Contains(res.Body.String(), "layout_format") {
		t.Fatalf("expected layout validation error, got %d: %s", res.Code, res.Body.String())
	}
}

func TestProcessRejectsInvalidFacecamSize(t *testing.T) {
	server := NewServer(config.Config{})
	req := httptest.NewRequest(http.MethodPost, "/api/process", strings.NewReader(`{"url":"https://example.com/video.mp4","acknowledged":true,"facecam_size":"huge"}`))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(res, req)
	if res.Code != http.StatusBadRequest || !strings.Contains(res.Body.String(), "facecam_size") {
		t.Fatalf("expected facecam validation error, got %d: %s", res.Code, res.Body.String())
	}
}

func TestProcessStartsConfiguredWorker(t *testing.T) {
	store := jobs.NewMemoryStore()
	runner := &jobs.Runner{Store: store, Worker: completingWorker{}}
	server := NewServerWithStoreAndRunner(config.Config{}, store, runner)
	req := httptest.NewRequest(http.MethodPost, "/api/process", strings.NewReader(`{"url":"https://example.com/video.mp4","acknowledged":true}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-AI-Api-Key", "test-key")
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
		if ok && job.Status == domain.JobStatusClipsReady {
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
	createReq := httptest.NewRequest(http.MethodPost, "/api/render", strings.NewReader(`{"props":{"videoUrl":"https://example.com/video.mp4"}}`))
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

func TestRenderProxyRenewsStaleS3ClipURLBeforeForwarding(t *testing.T) {
	var forwarded struct {
		JobID string         `json:"jobId"`
		Props map[string]any `json:"props"`
	}
	renderer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&forwarded); err != nil {
			t.Fatalf("decode forwarded render request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"renderId":"render-renewed","status":"queued"}`))
	}))
	defer renderer.Close()

	publicClient := s3.NewFromConfig(aws.Config{
		Region:      "eu-west-3",
		Credentials: credentials.NewStaticCredentialsProvider("key", "secret", ""),
	}, func(options *s3.Options) {
		options.BaseEndpoint = aws.String("http://minio.example")
		options.UsePathStyle = true
	})
	server := NewServer(config.Config{RenderServiceURL: renderer.URL})
	server.s3Store = &integrations.S3Store{
		Bucket:    "openshorts-media",
		Presigner: s3.NewPresignClient(publicClient),
	}
	staleURL := "http://minio.example/openshorts-media/job-1/clips/clip-1/source_clip_4.mp4?X-Amz-Date=20260821T160208Z&X-Amz-Expires=7200&X-Amz-Signature=stale"
	request := httptest.NewRequest(http.MethodPost, "/api/render", strings.NewReader(fmt.Sprintf(
		`{"jobId":"job-1","clipIndex":0,"props":{"videoUrl":%q}}`,
		staleURL,
	)))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected render proxy status 200, got %d: %s", response.Code, response.Body.String())
	}
	if forwarded.JobID != "job-1" {
		t.Fatalf("unexpected forwarded job id: %q", forwarded.JobID)
	}
	renewedURL, ok := forwarded.Props["videoUrl"].(string)
	if !ok {
		t.Fatalf("forwarded video URL is missing: %#v", forwarded.Props)
	}
	parsed, err := url.Parse(renewedURL)
	if err != nil {
		t.Fatalf("parse renewed video URL: %v", err)
	}
	if parsed.Query().Get("X-Amz-Date") == "20260821T160208Z" || parsed.Query().Get("X-Amz-Signature") == "stale" {
		t.Fatalf("stale S3 signature was forwarded: %q", renewedURL)
	}
	if parsed.Path != "/openshorts-media/job-1/clips/clip-1/source_clip_4.mp4" {
		t.Fatalf("renewed URL changed the clip object path: %q", renewedURL)
	}
}

func TestRenderStatusPublishesCompletedMasterToS3(t *testing.T) {
	outputDir := t.TempDir()
	jobDir := filepath.Join(outputDir, "job-1")
	if err := os.MkdirAll(jobDir, 0o755); err != nil {
		t.Fatalf("create output directory: %v", err)
	}
	masterPath := filepath.Join(jobDir, "master_0_version-1_123.mp4")
	if err := os.WriteFile(masterPath, []byte("master cache"), 0o644); err != nil {
		t.Fatalf("write master cache: %v", err)
	}
	renderer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"renderId":"render-1","status":"done","outputUrl":"/output/job-1/master_0_version-1_123.mp4"}`))
	}))
	defer renderer.Close()

	server := NewServer(config.Config{OutputDir: outputDir, RenderServiceURL: renderer.URL})
	client := &regionMetadataS3Client{}
	server.s3Store = &integrations.S3Store{
		Client:        client,
		Bucket:        "openshorts-media",
		PublicURLBase: "https://minio.example",
	}
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/render/render-1", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "https://minio.example/openshorts-media/job-1/master/master_0_version-1_123.mp4") {
		t.Fatalf("expected MinIO master URL, got %s", response.Body.String())
	}
	if client.putKey != "job-1/master/master_0_version-1_123.mp4" || client.putBody != "master cache" {
		t.Fatalf("master was not uploaded to the canonical cache key: key=%q body=%q", client.putKey, client.putBody)
	}
	if _, err := os.Stat(masterPath); !os.IsNotExist(err) {
		t.Fatalf("master staging file was not removed: %v", err)
	}
	secondResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(secondResponse, httptest.NewRequest(http.MethodGet, "/api/render/render-1", nil))
	if secondResponse.Code != http.StatusOK || !strings.Contains(secondResponse.Body.String(), "https://minio.example/openshorts-media/job-1/master/master_0_version-1_123.mp4") {
		t.Fatalf("expected cached MinIO master URL on repeat poll, got %d: %s", secondResponse.Code, secondResponse.Body.String())
	}
	if client.putCalls != 1 {
		t.Fatalf("expected one MinIO upload across repeated polls, got %d", client.putCalls)
	}
}

func TestRenderStatusPublishesRemotionOutputToClipScope(t *testing.T) {
	outputDir := t.TempDir()
	jobDir := filepath.Join(outputDir, "job-1")
	if err := os.MkdirAll(jobDir, 0o755); err != nil {
		t.Fatalf("create output directory: %v", err)
	}
	remotionPath := filepath.Join(jobDir, "remotion_8_1787260172918.mp4")
	if err := os.WriteFile(remotionPath, []byte("clip render"), 0o644); err != nil {
		t.Fatalf("write remotion output: %v", err)
	}
	renderer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"renderId":"clip-render-1","status":"done","outputUrl":"/output/job-1/remotion_8_1787260172918.mp4"}`))
	}))
	defer renderer.Close()

	server := NewServer(config.Config{OutputDir: outputDir, RenderServiceURL: renderer.URL})
	client := &regionMetadataS3Client{}
	server.s3Store = &integrations.S3Store{
		Client:        client,
		Bucket:        "openshorts-media",
		PublicURLBase: "https://minio.example",
	}
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/render/clip-render-1", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	expectedKey := "job-1/clips/clip-render-1/remotion_8_1787260172918.mp4"
	if !strings.Contains(response.Body.String(), "https://minio.example/openshorts-media/"+expectedKey) {
		t.Fatalf("expected MinIO clip URL, got %s", response.Body.String())
	}
	if client.putKey != expectedKey || client.putBody != "clip render" {
		t.Fatalf("remotion output was not uploaded to the clip key: key=%q body=%q", client.putKey, client.putBody)
	}
	if _, err := os.Stat(remotionPath); !os.IsNotExist(err) {
		t.Fatalf("remotion staging file was not removed: %v", err)
	}
}

func TestRenderStatusPublishesLocalEditorOutputOnceAndCleansStaging(t *testing.T) {
	outputDir := t.TempDir()
	jobDir := filepath.Join(outputDir, "local-editor-1")
	if err := os.MkdirAll(jobDir, 0o755); err != nil {
		t.Fatalf("create output directory: %v", err)
	}
	outputPath := filepath.Join(jobDir, "remotion_0_123.mp4")
	if err := os.WriteFile(outputPath, []byte("local editor render"), 0o644); err != nil {
		t.Fatalf("write local editor output: %v", err)
	}
	renderer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"renderId":"local-render-1","status":"done","outputUrl":"/output/local-editor-1/remotion_0_123.mp4"}`))
	}))
	defer renderer.Close()

	server := NewServer(config.Config{OutputDir: outputDir, RenderServiceURL: renderer.URL})
	client := &regionMetadataS3Client{}
	server.s3Store = &integrations.S3Store{
		Client:        client,
		Bucket:        "openshorts-media",
		PublicURLBase: "https://minio.example",
	}
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/render/local-render-1", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "https://minio.example/openshorts-media/local-editor-1/clips/local-render-1/remotion_0_123.mp4") {
		t.Fatalf("expected MinIO output URL, got %s", response.Body.String())
	}
	if client.putCalls != 1 {
		t.Fatalf("expected one local editor upload, got %d", client.putCalls)
	}
	if _, err := os.Stat(jobDir); !os.IsNotExist(err) {
		t.Fatalf("local editor staging directory was not removed: %v", err)
	}
	secondResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(secondResponse, httptest.NewRequest(http.MethodGet, "/api/render/local-render-1", nil))
	if secondResponse.Code != http.StatusOK || !strings.Contains(secondResponse.Body.String(), "https://minio.example/openshorts-media/local-editor-1/clips/local-render-1/remotion_0_123.mp4") {
		t.Fatalf("expected cached MinIO output URL on repeat poll, got %d: %s", secondResponse.Code, secondResponse.Body.String())
	}
	if client.putCalls != 1 {
		t.Fatalf("expected repeat local editor poll not to re-upload, got %d uploads", client.putCalls)
	}
}

func TestLocalRenderVideoURLUsesMasterCacheForMinioURL(t *testing.T) {
	server := NewServer(config.Config{})
	server.s3Store = &integrations.S3Store{Bucket: "openshorts-media"}
	got := server.localRenderVideoURL(
		"job-1",
		"http://minio.example/openshorts-media/job-1/master/source.mp4?X-Amz-Signature=test",
	)
	if got != "/videos/job-1/source.mp4" {
		t.Fatalf("expected local master cache URL, got %q", got)
	}
}

func TestClipVersionRoutesPersistAndBranchManifests(t *testing.T) {
	outputDir := t.TempDir()
	server := NewServer(config.Config{OutputDir: outputDir})
	manifest := `{"schema_version":1,"timeline":{"source_video_url":"/videos/job-1/source.mp4"},"layers":{}}`
	createReq := httptest.NewRequest(http.MethodPost, "/api/clip/job-1/0/versions", strings.NewReader(`{"manifest":`+manifest+`}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRes := httptest.NewRecorder()
	server.Handler().ServeHTTP(createRes, createReq)
	if createRes.Code != http.StatusOK {
		t.Fatalf("expected create status 200, got %d: %s", createRes.Code, createRes.Body.String())
	}
	var created struct {
		Version struct {
			VersionID string `json:"version_id"`
		} `json:"version"`
		Manifest map[string]any `json:"manifest"`
	}
	if err := json.Unmarshal(createRes.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode create response: %v", err)
	}
	if created.Version.VersionID == "" || created.Manifest["manifest_revision"] == nil {
		t.Fatalf("unexpected created version: %#v", created)
	}
	if _, err := os.Stat(filepath.Join(outputDir, "job-1", "clip_0", "versions")); !os.IsNotExist(err) {
		t.Fatalf("version creation unexpectedly created JSON storage: %v", err)
	}

	listReq := httptest.NewRequest(http.MethodGet, "/api/clip/job-1/0/versions", nil)
	listRes := httptest.NewRecorder()
	server.Handler().ServeHTTP(listRes, listReq)
	if listRes.Code != http.StatusOK || !strings.Contains(listRes.Body.String(), created.Version.VersionID) {
		t.Fatalf("unexpected list response: %d %s", listRes.Code, listRes.Body.String())
	}

	branchManifest := `{"schema_version":1,"timeline":{"source_video_url":"/videos/job-1/source.mp4"},"layers":{"subtitles":null},"subtitle_tracks":[],"subtitle_tracks_disabled":true}`
	branchReq := httptest.NewRequest(http.MethodPost, "/api/clip/job-1/0/versions/branch", strings.NewReader(`{"version_id":"`+created.Version.VersionID+`","manifest":`+branchManifest+`}`))
	branchReq.Header.Set("Content-Type", "application/json")
	branchRes := httptest.NewRecorder()
	server.Handler().ServeHTTP(branchRes, branchReq)
	if branchRes.Code != http.StatusOK || !strings.Contains(branchRes.Body.String(), `"parent_version_id":"`+created.Version.VersionID+`"`) {
		t.Fatalf("unexpected branch response: %d %s", branchRes.Code, branchRes.Body.String())
	}
	var branched struct {
		Version struct {
			VersionID string `json:"version_id"`
		} `json:"version"`
	}
	if err := json.Unmarshal(branchRes.Body.Bytes(), &branched); err != nil {
		t.Fatalf("decode branch response: %v", err)
	}
	if !strings.Contains(branchRes.Body.String(), `"subtitle_tracks_disabled":true`) {
		t.Fatalf("branch did not preserve the edited manifest: %s", branchRes.Body.String())
	}

	completeReq := httptest.NewRequest(http.MethodPost, "/api/clip/job-1/0/versions/"+created.Version.VersionID+"/complete", strings.NewReader(`{"output_url":"/videos/job-1/rendered.mp4"}`))
	completeReq.Header.Set("Content-Type", "application/json")
	completeRes := httptest.NewRecorder()
	server.Handler().ServeHTTP(completeRes, completeReq)
	if completeRes.Code != http.StatusOK || !strings.Contains(completeRes.Body.String(), `"current_version_id":"`+created.Version.VersionID+`"`) {
		t.Fatalf("unexpected complete response: %d %s", completeRes.Code, completeRes.Body.String())
	}

	deleteReq := httptest.NewRequest(http.MethodDelete, "/api/clip/job-1/0/versions/"+created.Version.VersionID, nil)
	deleteRes := httptest.NewRecorder()
	server.Handler().ServeHTTP(deleteRes, deleteReq)
	if deleteRes.Code != http.StatusConflict {
		t.Fatalf("unexpected delete response: %d %s", deleteRes.Code, deleteRes.Body.String())
	}

	completeBranchReq := httptest.NewRequest(http.MethodPost, "/api/clip/job-1/0/versions/"+branched.Version.VersionID+"/complete", strings.NewReader(`{"output_url":"/videos/job-1/branched.mp4"}`))
	completeBranchReq.Header.Set("Content-Type", "application/json")
	completeBranchRes := httptest.NewRecorder()
	server.Handler().ServeHTTP(completeBranchRes, completeBranchReq)
	if completeBranchRes.Code != http.StatusOK || !strings.Contains(completeBranchRes.Body.String(), `"current_version_id":"`+branched.Version.VersionID+`"`) {
		t.Fatalf("unexpected branch completion response: %d %s", completeBranchRes.Code, completeBranchRes.Body.String())
	}

	deleteReq = httptest.NewRequest(http.MethodDelete, "/api/clip/job-1/0/versions/"+branched.Version.VersionID, nil)
	deleteRes = httptest.NewRecorder()
	server.Handler().ServeHTTP(deleteRes, deleteReq)
	if deleteRes.Code != http.StatusOK || !strings.Contains(deleteRes.Body.String(), `"current_version_id":"`+created.Version.VersionID+`"`) {
		t.Fatalf("unexpected current-version deletion response: %d %s", deleteRes.Code, deleteRes.Body.String())
	}
	listRes = httptest.NewRecorder()
	server.Handler().ServeHTTP(listRes, listReq)
	var listed struct {
		Versions []struct {
			VersionID string `json:"version_id"`
		} `json:"versions"`
	}
	if err := json.Unmarshal(listRes.Body.Bytes(), &listed); err != nil {
		t.Fatalf("decode post-delete list response: %v", err)
	}
	deletedStillListed := false
	for _, version := range listed.Versions {
		if version.VersionID == branched.Version.VersionID {
			deletedStillListed = true
			break
		}
	}
	if listRes.Code != http.StatusOK || deletedStillListed {
		t.Fatalf("deleted version still appears in history: %d %s", listRes.Code, listRes.Body.String())
	}
}

func TestClipVersionRenderForwardsDatabaseManifestInsteadOfBrowserProps(t *testing.T) {
	var forwarded map[string]any
	renderer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&forwarded); err != nil {
			t.Fatalf("decode version render request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"renderId":"version-render-1","status":"queued"}`))
	}))
	defer renderer.Close()
	server := NewServer(config.Config{RenderServiceURL: renderer.URL})
	manifest := map[string]any{
		"schema_version": 1,
		"timeline":       map[string]any{"source_video_url": "/videos/job-1/source.mp4"},
		"render_spec": map[string]any{
			"video_start_seconds": 2,
			"duration_in_frames":  150,
			"fps":                 30,
			"width":               1080,
			"height":              1920,
			"video_fit":           "cover",
		},
		"layers": map[string]any{
			"hook": map[string]any{
				"color":      "#FF00AA",
				"fontSize":   48,
				"background": "#111111",
				"size":       "M",
			},
		},
	}
	created, _, err := server.versionRepository.Create(context.Background(), "job-1", 0, manifest, nil)
	if err != nil {
		t.Fatalf("create version: %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/clip/job-1/0/versions/"+created.VersionID+"/render", strings.NewReader(`{"props":{"videoUrl":"https://attacker.example/other.mp4","durationInFrames":1}}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"renderId":"version-render-1"`) {
		t.Fatalf("unexpected version render response: %d %s", response.Code, response.Body.String())
	}
	if forwarded["props"] != nil || forwarded["versionId"] != created.VersionID {
		t.Fatalf("renderer received browser props or wrong version id: %#v", forwarded)
	}
	forwardedManifest, ok := forwarded["manifest"].(map[string]any)
	if !ok {
		t.Fatalf("renderer did not receive persisted manifest: %#v", forwarded)
	}
	forwardedHook := forwardedManifest["layers"].(map[string]any)["hook"].(map[string]any)
	if forwardedHook["color"] != "#FF00AA" || forwardedHook["fontSize"] != float64(48) || forwardedHook["background"] != "#111111" || forwardedHook["size"] != "M" {
		t.Fatalf("renderer received incomplete viral hook: %#v", forwardedHook)
	}
}

func TestLocalRenderVideoURLRenewsPersistedS3ClipURL(t *testing.T) {
	server := NewServer(config.Config{})
	server.s3Store = &integrations.S3Store{
		Bucket:        "openshorts-media",
		PublicURLBase: "https://storage.example",
	}
	proxyURL := "https://storage.example/openshorts-media/job-1/clips/render-1/source_clip_14.mp4?X-Amz-Signature=expired"

	resolved := server.localRenderVideoURL("job-1", proxyURL)

	expected := "https://storage.example/openshorts-media/job-1/clips/render-1/source_clip_14.mp4"
	if resolved != expected {
		t.Fatalf("expected persisted media URL to resolve to %q, got %q", expected, resolved)
	}
}

func TestPersistSubtitlesUpdatesMasterManifestWithoutDroppingOtherLayers(t *testing.T) {
	outputDir := t.TempDir()
	manifestPath := filepath.Join(outputDir, "job-1", "manifests", "clip_1.json")
	if err := os.MkdirAll(filepath.Dir(manifestPath), 0o755); err != nil {
		t.Fatalf("create manifest directory: %v", err)
	}
	if err := os.WriteFile(
		manifestPath,
		[]byte(`{"schema_version":1,"layers":{"hook":{"text":"Keep me"},"effects":{"segments":[]}},"subtitle_tracks":[],"master":{"revision":"old"}}`),
		0o644,
	); err != nil {
		t.Fatalf("write manifest: %v", err)
	}
	server := NewServer(config.Config{OutputDir: outputDir})
	persistReq := httptest.NewRequest(
		http.MethodPost,
		"/api/clip/job-1/0/persist-subtitles",
		strings.NewReader(`{"trackId":"original","language":"es","style":{"fontSize":24},"cues":[{"id":"cue-1","text":"sé","startMs":0,"endMs":1000}]}`),
	)
	persistReq.Header.Set("Content-Type", "application/json")
	persistRes := httptest.NewRecorder()
	server.Handler().ServeHTTP(persistRes, persistReq)
	if persistRes.Code != http.StatusOK {
		t.Fatalf("expected persistence status 200, got %d: %s", persistRes.Code, persistRes.Body.String())
	}

	saved, err := manifests.Load(manifestPath)
	if err != nil {
		t.Fatalf("load persisted manifest: %v", err)
	}
	layers := saved["layers"].(map[string]any)
	if layers["hook"].(map[string]any)["text"] != "Keep me" {
		t.Fatalf("persistence dropped unrelated hook layer: %#v", layers)
	}
	tracks := saved["subtitle_tracks"].([]any)
	if len(tracks) != 1 || tracks[0].(map[string]any)["id"] != "original" {
		t.Fatalf("unexpected persisted subtitle tracks: %#v", tracks)
	}
	if saved["master"] != nil {
		t.Fatalf("expected the old master render to be invalidated: %#v", saved["master"])
	}

	removeReq := httptest.NewRequest(
		http.MethodPost,
		"/api/clip/job-1/0/persist-subtitles",
		strings.NewReader(`{"trackId":"original","language":"es","style":{"fontSize":24},"cues":[]}`),
	)
	removeReq.Header.Set("Content-Type", "application/json")
	removeRes := httptest.NewRecorder()
	server.Handler().ServeHTTP(removeRes, removeReq)
	if removeRes.Code != http.StatusOK {
		t.Fatalf("expected subtitle removal status 200, got %d: %s", removeRes.Code, removeRes.Body.String())
	}
	saved, err = manifests.Load(manifestPath)
	if err != nil {
		t.Fatalf("reload persisted manifest: %v", err)
	}
	if tracks, ok := saved["subtitle_tracks"].([]any); ok && len(tracks) != 0 {
		t.Fatalf("expected subtitle track removal, got %#v", tracks)
	}
	if saved["subtitle_tracks_disabled"] != true {
		t.Fatalf("expected subtitle track disable flag, got %#v", saved["subtitle_tracks_disabled"])
	}
}

func TestCompleteVersionPublishesLocalMasterToS3(t *testing.T) {
	outputDir := t.TempDir()
	masterDir := filepath.Join(outputDir, "job-1")
	if err := os.MkdirAll(masterDir, 0o755); err != nil {
		t.Fatalf("create master directory: %v", err)
	}
	if err := os.WriteFile(filepath.Join(masterDir, "master_0_version-1_123.mp4"), []byte("master cache"), 0o644); err != nil {
		t.Fatalf("write master cache: %v", err)
	}
	server := NewServer(config.Config{OutputDir: outputDir})
	client := &regionMetadataS3Client{}
	server.s3Store = &integrations.S3Store{
		Client:        client,
		Bucket:        "openshorts-media",
		PublicURLBase: "https://minio.example",
	}
	createReq := httptest.NewRequest(http.MethodPost, "/api/clip/job-1/0/versions", strings.NewReader(`{"manifest":{"schema_version":1,"timeline":{},"layers":{}}}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRes := httptest.NewRecorder()
	server.Handler().ServeHTTP(createRes, createReq)
	var payload struct {
		Version struct {
			VersionID string `json:"version_id"`
		} `json:"version"`
	}
	if createRes.Code != http.StatusOK || json.Unmarshal(createRes.Body.Bytes(), &payload) != nil {
		t.Fatalf("create version failed: %d %s", createRes.Code, createRes.Body.String())
	}

	completeReq := httptest.NewRequest(
		http.MethodPost,
		"/api/clip/job-1/0/versions/"+payload.Version.VersionID+"/complete",
		strings.NewReader(`{"output_url":"/output/job-1/master_0_version-1_123.mp4"}`),
	)
	completeReq.Header.Set("Content-Type", "application/json")
	completeRes := httptest.NewRecorder()
	server.Handler().ServeHTTP(completeRes, completeReq)

	if completeRes.Code != http.StatusOK || !strings.Contains(completeRes.Body.String(), "https://minio.example/openshorts-media/job-1/master/master_0_version-1_123.mp4") {
		t.Fatalf("expected published master version, got %d %s", completeRes.Code, completeRes.Body.String())
	}
	if client.putKey != "job-1/master/master_0_version-1_123.mp4" || client.putBody != "master cache" {
		t.Fatalf("master version was not uploaded: key=%q body=%q", client.putKey, client.putBody)
	}
}

func TestVersionDownloadRedirectsDirectlyToMinio(t *testing.T) {
	server := NewServer(config.Config{OutputDir: t.TempDir()})
	server.s3Store = &integrations.S3Store{Bucket: "openshorts-media", PublicURLBase: "https://minio.example"}
	created, _, err := server.versionRepository.Create(context.Background(), "job-1", 0, map[string]any{"timeline": map[string]any{}, "layers": map[string]any{}}, nil)
	if err != nil {
		t.Fatalf("create version: %v", err)
	}
	outputURL := "https://minio.example/openshorts-media/job-1/clips/0/versions/" + created.VersionID + "/version_0_" + created.VersionID + "_123.mp4"
	if _, err := server.versionRepository.Complete(context.Background(), "job-1", 0, created.VersionID, outputURL); err != nil {
		t.Fatalf("complete version: %v", err)
	}

	response := httptest.NewRecorder()
	path := "/api/clip/job-1/0/versions/" + created.VersionID + "/download"
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))

	if response.Code != http.StatusTemporaryRedirect {
		t.Fatalf("expected direct download redirect, got %d: %s", response.Code, response.Body.String())
	}
	if location := response.Header().Get("Location"); location != outputURL {
		t.Fatalf("unexpected direct download location: %s", location)
	}
}

func TestVersionPreviewRedirectsDirectlyToMinio(t *testing.T) {
	server := NewServer(config.Config{OutputDir: t.TempDir()})
	server.s3Store = &integrations.S3Store{Bucket: "openshorts-media", PublicURLBase: "https://minio.example"}
	created, _, err := server.versionRepository.Create(context.Background(), "job-1", 0, map[string]any{"timeline": map[string]any{}, "layers": map[string]any{}}, nil)
	if err != nil {
		t.Fatalf("create version: %v", err)
	}
	outputURL := "https://minio.example/openshorts-media/job-1/clips/0/versions/" + created.VersionID + "/version_0_" + created.VersionID + "_123.mp4"
	if _, err := server.versionRepository.Complete(context.Background(), "job-1", 0, created.VersionID, outputURL); err != nil {
		t.Fatalf("complete version: %v", err)
	}

	response := httptest.NewRecorder()
	path := "/api/clip/job-1/0/versions/" + created.VersionID + "/preview"
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))

	if response.Code != http.StatusTemporaryRedirect {
		t.Fatalf("expected direct preview redirect, got %d: %s", response.Code, response.Body.String())
	}
	if location := response.Header().Get("Location"); location != outputURL {
		t.Fatalf("unexpected direct preview location: %s", location)
	}
}

func TestClipVersionUpdateRouteKeepsSelectedVersionID(t *testing.T) {
	server := NewServer(config.Config{})
	createReq := httptest.NewRequest(http.MethodPost, "/api/clip/job-1/0/versions", strings.NewReader(`{"manifest":{"layers":{"hook":{"text":"before"}}}}`))
	createReq.Header.Set("Content-Type", "application/json")
	createRes := httptest.NewRecorder()
	server.Handler().ServeHTTP(createRes, createReq)
	if createRes.Code != http.StatusOK {
		t.Fatalf("create failed: %d %s", createRes.Code, createRes.Body.String())
	}
	var created struct {
		Version struct {
			VersionID string `json:"version_id"`
		} `json:"version"`
	}
	if err := json.Unmarshal(createRes.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode create response: %v", err)
	}

	updateReq := httptest.NewRequest(
		http.MethodPut,
		"/api/clip/job-1/0/versions/"+created.Version.VersionID,
		strings.NewReader(`{"manifest":{"layers":{"hook":{"text":"after"}}}}`),
	)
	updateReq.Header.Set("Content-Type", "application/json")
	updateRes := httptest.NewRecorder()
	server.Handler().ServeHTTP(updateRes, updateReq)
	if updateRes.Code != http.StatusOK || !strings.Contains(updateRes.Body.String(), `"version_id":"`+created.Version.VersionID+`"`) || !strings.Contains(updateRes.Body.String(), `"text":"after"`) {
		t.Fatalf("unexpected update response: %d %s", updateRes.Code, updateRes.Body.String())
	}

	listReq := httptest.NewRequest(http.MethodGet, "/api/clip/job-1/0/versions", nil)
	listRes := httptest.NewRecorder()
	server.Handler().ServeHTTP(listRes, listReq)
	if listRes.Code != http.StatusOK || strings.Count(listRes.Body.String(), `"version_id"`) != 1 {
		t.Fatalf("update created a child version: %d %s", listRes.Code, listRes.Body.String())
	}
}

func TestManifestRouteFindsOneBasedManifestLayout(t *testing.T) {
	outputDir := t.TempDir()
	manifestDir := filepath.Join(outputDir, "job-1", "manifests")
	if err := os.MkdirAll(manifestDir, 0o755); err != nil {
		t.Fatalf("create manifest directory: %v", err)
	}
	manifest := `{"schema_version":1,"timeline":{"source_video_url":"/videos/job-1/source.mp4"},"layers":{}}`
	if err := os.WriteFile(filepath.Join(manifestDir, "clip_1.json"), []byte(manifest), 0o644); err != nil {
		t.Fatalf("write manifest: %v", err)
	}

	server := NewServer(config.Config{OutputDir: outputDir})
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/api/clip/job-1/0/manifest", nil))

	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"source_video_url":"/videos/job-1/source.mp4"`) {
		t.Fatalf("expected one-based manifest to load, got %d: %s", res.Code, res.Body.String())
	}
}

func TestTranslationLanguagesReturnsSupportedCodes(t *testing.T) {
	server := NewServer(config.Config{})
	req := httptest.NewRequest(http.MethodGet, "/api/translate/languages", nil)
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(res, req)
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"es":"Spanish"`) || !strings.Contains(res.Body.String(), `"it":"Italian"`) {
		t.Fatalf("unexpected languages response: %d %s", res.Code, res.Body.String())
	}
}

func TestLMStudioDiscoveryReturnsNormalizedModels(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/models" {
			t.Fatalf("unexpected discovery path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"models":[{"key":"local-model","display_name":"Local Model","capabilities":{"vision":true},"loaded_instances":[{}],"max_context_length":8192}]}`))
	}))
	defer provider.Close()

	server := NewServer(config.Config{})
	req := httptest.NewRequest(http.MethodPost, "/api/ai/lmstudio/discover", strings.NewReader(`{"baseUrl":"`+provider.URL+`"}`))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(res, req)
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"available":true`) || !strings.Contains(res.Body.String(), `"id":"local-model"`) || !strings.Contains(res.Body.String(), `"supportsVision":true`) {
		t.Fatalf("unexpected LM Studio response: %d %s", res.Code, res.Body.String())
	}
}

func TestClipManifestRoutesReadAndPatchAtomically(t *testing.T) {
	outputDir := t.TempDir()
	manifestPath := filepath.Join(outputDir, "job-1", "clip_0", "manifest.json")
	if _, err := manifests.SaveAtomic(manifestPath, map[string]any{"schema_version": 1, "layers": map[string]any{"hook": nil}}); err != nil {
		t.Fatalf("write manifest: %v", err)
	}
	server := NewServer(config.Config{OutputDir: outputDir})

	getReq := httptest.NewRequest(http.MethodGet, "/api/clip/job-1/0/manifest", nil)
	getRes := httptest.NewRecorder()
	server.Handler().ServeHTTP(getRes, getReq)
	if getRes.Code != http.StatusOK || !strings.Contains(getRes.Body.String(), `"revision"`) {
		t.Fatalf("unexpected manifest response: %d %s", getRes.Code, getRes.Body.String())
	}

	patchReq := httptest.NewRequest(http.MethodPatch, "/api/clip/job-1/0/manifest", strings.NewReader(`{"layers":{"hook":{"text":"Stop"}}}`))
	patchReq.Header.Set("Content-Type", "application/json")
	patchRes := httptest.NewRecorder()
	server.Handler().ServeHTTP(patchRes, patchReq)
	if patchRes.Code != http.StatusOK || !strings.Contains(patchRes.Body.String(), `"text":"Stop"`) || !strings.Contains(patchRes.Body.String(), `"master_current":false`) {
		t.Fatalf("unexpected patched manifest response: %d %s", patchRes.Code, patchRes.Body.String())
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

func TestDeferredClipRenderRouteCreatesOneChildPerClipAndExposesState(t *testing.T) {
	store := jobs.NewMemoryStore()
	outputDir := t.TempDir()
	server := NewServerWithStore(config.Config{OutputDir: outputDir}, store)
	parent, err := store.Create(context.Background(), domain.CreateJobInput{
		Kind:      "clip-generation",
		OutputDir: filepath.Join(outputDir, "parent-1"),
		Metadata:  map[string]any{"defer_render": true},
	})
	if err != nil {
		t.Fatalf("create parent: %v", err)
	}
	if _, err := store.Claim(context.Background(), parent.ID); err != nil {
		t.Fatalf("claim parent: %v", err)
	}
	if _, err := store.Transition(context.Background(), parent.ID, domain.JobStatusClipsReady, ""); err != nil {
		t.Fatalf("mark parent ready: %v", err)
	}
	if err := store.SetResult(context.Background(), parent.ID, []byte(`{"source_path":"source.mp4","clips":[{"start":1,"end":4,"render_status":"found"},{"start":8,"end":12,"render_status":"found"}]}`)); err != nil {
		t.Fatalf("set parent result: %v", err)
	}

	path := fmt.Sprintf("/api/jobs/%s/clips/1/render", parent.ID)
	first := httptest.NewRecorder()
	server.Handler().ServeHTTP(first, httptest.NewRequest(http.MethodPost, path, nil))
	if first.Code != http.StatusAccepted {
		t.Fatalf("expected first render request accepted, got %d: %s", first.Code, first.Body.String())
	}
	var firstPayload struct {
		JobID string `json:"job_id"`
	}
	if err := json.Unmarshal(first.Body.Bytes(), &firstPayload); err != nil || firstPayload.JobID == "" {
		t.Fatalf("unexpected first render response: %s", first.Body.String())
	}

	second := httptest.NewRecorder()
	server.Handler().ServeHTTP(second, httptest.NewRequest(http.MethodPost, path, nil))
	if second.Code != http.StatusAccepted {
		t.Fatalf("expected duplicate render request accepted, got %d: %s", second.Code, second.Body.String())
	}
	var secondPayload struct {
		JobID string `json:"job_id"`
	}
	if err := json.Unmarshal(second.Body.Bytes(), &secondPayload); err != nil || secondPayload.JobID != firstPayload.JobID {
		t.Fatalf("duplicate render created another child: %s", second.Body.String())
	}

	status := httptest.NewRecorder()
	server.Handler().ServeHTTP(status, httptest.NewRequest(http.MethodGet, "/api/status/"+parent.ID, nil))
	if status.Code != http.StatusOK {
		t.Fatalf("status lookup failed: %d %s", status.Code, status.Body.String())
	}
	var statusPayload struct {
		Status string `json:"status"`
		Result struct {
			Clips []map[string]any `json:"clips"`
		} `json:"result"`
		ClipRenders []map[string]any `json:"clip_renders"`
	}
	if err := json.Unmarshal(status.Body.Bytes(), &statusPayload); err != nil {
		t.Fatalf("decode staged status: %v", err)
	}
	if statusPayload.Status != string(domain.JobStatusClipsReady) || len(statusPayload.ClipRenders) != 1 || statusPayload.ClipRenders[0]["job_id"] != firstPayload.JobID {
		t.Fatalf("unexpected staged status: %#v", statusPayload)
	}
	if statusPayload.Result.Clips[1]["render_status"] != "queued" || statusPayload.Result.Clips[1]["render_job_id"] != firstPayload.JobID {
		t.Fatalf("render state was not merged into result: %#v", statusPayload.Result.Clips)
	}
}

func TestDeferredClipWebcamRegionPatchPersistsResultAndMetadata(t *testing.T) {
	store := jobs.NewMemoryStore()
	outputDir := t.TempDir()
	parent, jobDir := createDeferredRegionTestJob(t, store, outputDir, `{"clips":[{"layout_format":"streamer_stack"},{"layout_format":"streamer_stack"}]}`)
	if err := os.WriteFile(filepath.Join(jobDir, "source_metadata.json"), []byte(`{"shorts":[{},{}]}`), 0o644); err != nil {
		t.Fatalf("write metadata: %v", err)
	}
	server := NewServerWithStore(config.Config{OutputDir: outputDir}, store)

	req := httptest.NewRequest(
		http.MethodPatch,
		fmt.Sprintf("/api/jobs/%s/clips/0/webcam-region", parent.ID),
		strings.NewReader(`{"webcam_region":{"x":0.02,"y":0.18,"width":0.23,"height":0.43},"facecam_size":"large"}`),
	)
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("expected webcam region patch to succeed, got %d: %s", res.Code, res.Body.String())
	}
	var response struct {
		ClipIndex    int            `json:"clip_index"`
		WebcamRegion map[string]any `json:"webcam_region"`
		FacecamSize  string         `json:"facecam_size"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode webcam region response: %v", err)
	}
	if response.ClipIndex != 0 || response.WebcamRegion["x"] != 0.02 || response.FacecamSize != "large" {
		t.Fatalf("unexpected webcam region response: %#v", response)
	}

	updated, ok := store.Get(context.Background(), parent.ID)
	if !ok {
		t.Fatal("parent job disappeared")
	}
	var result struct {
		Clips []map[string]any `json:"clips"`
	}
	if err := json.Unmarshal(updated.Result, &result); err != nil {
		t.Fatalf("decode stored result: %v", err)
	}
	if result.Clips[0]["webcam_region"].(map[string]any)["width"] != 0.23 {
		t.Fatalf("stored result missing webcam region: %#v", result.Clips)
	}
	if result.Clips[0]["facecam_size"] != "large" {
		t.Fatalf("stored result missing facecam size: %#v", result.Clips)
	}
	if _, exists := result.Clips[1]["webcam_region"]; exists {
		t.Fatalf("patch changed neighboring clip: %#v", result.Clips)
	}

	metadata, err := os.ReadFile(filepath.Join(jobDir, "source_metadata.json"))
	if err != nil {
		t.Fatalf("read metadata: %v", err)
	}
	var document struct {
		Shorts []map[string]any `json:"shorts"`
	}
	if err := json.Unmarshal(metadata, &document); err != nil {
		t.Fatalf("decode metadata: %v", err)
	}
	if document.Shorts[0]["webcam_region"].(map[string]any)["height"] != 0.43 {
		t.Fatalf("metadata missing webcam region: %#v", document.Shorts)
	}
	if document.Shorts[0]["facecam_size"] != "large" {
		t.Fatalf("metadata missing facecam size: %#v", document.Shorts)
	}
	if _, exists := document.Shorts[1]["webcam_region"]; exists {
		t.Fatalf("metadata patch changed neighboring clip: %#v", document.Shorts)
	}
}

func TestProjectClipsHydratesLegacyLayoutFromDeferredJobMetadata(t *testing.T) {
	store := jobs.NewMemoryStore()
	outputDir := t.TempDir()
	parent, err := store.Create(context.Background(), domain.CreateJobInput{
		Kind:      "clip-generation",
		OutputDir: filepath.Join(outputDir, "parent-layout"),
		Metadata: map[string]any{
			"defer_render":  true,
			"layout_format": "streamer_stack",
			"facecam_size":  "small",
		},
	})
	if err != nil {
		t.Fatalf("create parent: %v", err)
	}
	if _, err := store.Claim(context.Background(), parent.ID); err != nil {
		t.Fatalf("claim parent: %v", err)
	}
	if _, err := store.Transition(context.Background(), parent.ID, domain.JobStatusClipsReady, ""); err != nil {
		t.Fatalf("mark parent ready: %v", err)
	}
	if err := store.SetResult(context.Background(), parent.ID, []byte(`{"clips":[{"start":1,"end":4,"render_status":"failed"}]}`)); err != nil {
		t.Fatalf("set parent result: %v", err)
	}

	server := NewServerWithStore(config.Config{OutputDir: outputDir}, store)
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(
		res,
		httptest.NewRequest(http.MethodGet, "/api/projects/clips/"+parent.ID, nil),
	)
	if res.Code != http.StatusOK {
		t.Fatalf("project clips lookup failed: %d %s", res.Code, res.Body.String())
	}

	var payload struct {
		Clips []map[string]any `json:"clips"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode project clips response: %v", err)
	}
	if len(payload.Clips) != 1 || payload.Clips[0]["layout_format"] != "streamer_stack" || payload.Clips[0]["facecam_size"] != "small" {
		t.Fatalf("legacy clip did not inherit layout metadata: %#v", payload.Clips)
	}
}

func TestDeferredClipWebcamRegionPatchHydratesAndUpdatesS3Metadata(t *testing.T) {
	store := jobs.NewMemoryStore()
	outputDir := t.TempDir()
	parent, _ := createDeferredRegionTestJob(t, store, outputDir, `{"clips":[{"layout_format":"streamer_stack"}]}`)
	client := &regionMetadataS3Client{body: `{"shorts":[{}]}`}
	server := NewServerWithStore(config.Config{OutputDir: outputDir}, store)
	server.s3Store = &integrations.S3Store{Client: client, Bucket: "openshorts-media"}

	req := httptest.NewRequest(
		http.MethodPatch,
		fmt.Sprintf("/api/jobs/%s/clips/0/webcam-region", parent.ID),
		strings.NewReader(`{"webcam_region":{"x":0.02,"y":0.18,"width":0.23,"height":0.43},"facecam_size":"small"}`),
	)
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("expected S3-backed webcam region patch to succeed, got %d: %s", res.Code, res.Body.String())
	}
	if client.putKey != parent.ID+"/master/source_metadata.json" {
		t.Fatalf("unexpected S3 metadata key: %q", client.putKey)
	}
	if !strings.Contains(client.putBody, `"webcam_region"`) || !strings.Contains(client.putBody, `"facecam_size": "small"`) {
		t.Fatalf("updated webcam region was not uploaded to S3: %s", client.putBody)
	}
}

func TestDeferredClipSourceRangePatchPersistsResultAndMetadata(t *testing.T) {
	store := jobs.NewMemoryStore()
	outputDir := t.TempDir()
	parent, jobDir := createDeferredRegionTestJob(t, store, outputDir, `{"clips":[{"start":176,"end":204},{"start":20,"end":40}]}`)
	if err := os.WriteFile(filepath.Join(jobDir, "source_metadata.json"), []byte(`{"source_asset":{"probe":{"duration_seconds":3577}},"shorts":[{"start":176,"end":204},{"start":20,"end":40}]}`), 0o644); err != nil {
		t.Fatalf("write metadata: %v", err)
	}
	server := NewServerWithStore(config.Config{OutputDir: outputDir}, store)

	req := httptest.NewRequest(
		http.MethodPatch,
		fmt.Sprintf("/api/jobs/%s/clips/0/source-range", parent.ID),
		strings.NewReader(`{"start":150,"end":230}`),
	)
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("expected source range patch to succeed, got %d: %s", res.Code, res.Body.String())
	}

	updated, ok := store.Get(context.Background(), parent.ID)
	if !ok {
		t.Fatal("parent job disappeared")
	}
	var result struct {
		Clips []map[string]any `json:"clips"`
	}
	if err := json.Unmarshal(updated.Result, &result); err != nil {
		t.Fatalf("decode stored result: %v", err)
	}
	if result.Clips[0]["start"] != 150.0 || result.Clips[0]["end"] != 230.0 {
		t.Fatalf("stored result missing source range: %#v", result.Clips)
	}
	if result.Clips[1]["start"] != 20.0 || result.Clips[1]["end"] != 40.0 {
		t.Fatalf("source range patch changed neighboring clip: %#v", result.Clips)
	}

	metadata, err := os.ReadFile(filepath.Join(jobDir, "source_metadata.json"))
	if err != nil {
		t.Fatalf("read metadata: %v", err)
	}
	var document struct {
		Shorts []map[string]any `json:"shorts"`
	}
	if err := json.Unmarshal(metadata, &document); err != nil {
		t.Fatalf("decode metadata: %v", err)
	}
	if document.Shorts[0]["start"] != 150.0 || document.Shorts[0]["end"] != 230.0 {
		t.Fatalf("metadata missing source range: %#v", document.Shorts)
	}
}

func TestDeferredClipSourceRangePatchRegeneratesExistingSubtitlesWithoutAI(t *testing.T) {
	store := jobs.NewMemoryStore()
	outputDir := t.TempDir()
	parent, jobDir := createDeferredRegionTestJob(t, store, outputDir, `{"clips":[{"start":176,"end":204,"subtitle_tracks":[{"id":"original","origin":"generated","cues":[{"text":"old","startMs":0,"endMs":1000}],"captions":[{"text":"old","startMs":0,"endMs":1000}]}],"subtitles":{"id":"original","origin":"generated","cues":[{"text":"old","startMs":0,"endMs":1000}],"captions":[{"text":"old","startMs":0,"endMs":1000}]},"layers":{"subtitles":{"captions":[{"text":"old","startMs":0,"endMs":1000}]}}}]}`)
	if err := os.WriteFile(filepath.Join(jobDir, "source_metadata.json"), []byte(`{"source_asset":{"probe":{"duration_seconds":3577}},"transcript":{"language":"en","segments":[{"words":[{"word":"Earlier","start":155,"end":156},{"word":"Inside","start":180,"end":181},{"word":"Later","start":220,"end":221}]}]},"shorts":[{"start":176,"end":204,"subtitle_tracks":[{"id":"original","origin":"generated","cues":[{"text":"old","startMs":0,"endMs":1000}],"captions":[{"text":"old","startMs":0,"endMs":1000}]}],"subtitles":{"id":"original","origin":"generated","cues":[{"text":"old","startMs":0,"endMs":1000}],"captions":[{"text":"old","startMs":0,"endMs":1000}]},"layers":{"subtitles":{"captions":[{"text":"old","startMs":0,"endMs":1000}]}}}]}`), 0o644); err != nil {
		t.Fatalf("write metadata: %v", err)
	}
	server := NewServerWithStore(config.Config{OutputDir: outputDir}, store)

	request := httptest.NewRequest(
		http.MethodPatch,
		fmt.Sprintf("/api/jobs/%s/clips/0/source-range", parent.ID),
		strings.NewReader(`{"start":150,"end":230}`),
	)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("expected source range patch to succeed, got %d: %s", response.Code, response.Body.String())
	}

	var payload struct {
		SubtitleTracks []map[string]any `json:"subtitle_tracks"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode source range response: %v", err)
	}
	if len(payload.SubtitleTracks) != 1 {
		t.Fatalf("expected regenerated subtitle track in response: %#v", payload)
	}
	if cues := payload.SubtitleTracks[0]["cues"].([]any); len(cues) != 3 || cues[0].(map[string]any)["text"] != "Earlier" || cues[0].(map[string]any)["startMs"] != 5000.0 || cues[2].(map[string]any)["startMs"] != 70000.0 {
		t.Fatalf("unexpected regenerated cues: %#v", payload.SubtitleTracks[0]["cues"])
	}

	updated, ok := store.Get(context.Background(), parent.ID)
	if !ok {
		t.Fatal("parent job disappeared")
	}
	var result struct {
		Clips []map[string]any `json:"clips"`
	}
	if err := json.Unmarshal(updated.Result, &result); err != nil {
		t.Fatalf("decode stored result: %v", err)
	}
	resultCues := result.Clips[0]["subtitle_tracks"].([]any)[0].(map[string]any)["cues"].([]any)
	if resultCues[0].(map[string]any)["text"] != "Earlier" {
		t.Fatalf("stored result subtitles were not regenerated: %#v", resultCues)
	}

	metadata, err := os.ReadFile(filepath.Join(jobDir, "source_metadata.json"))
	if err != nil {
		t.Fatalf("read metadata: %v", err)
	}
	var document struct {
		Shorts []map[string]any `json:"shorts"`
	}
	if err := json.Unmarshal(metadata, &document); err != nil {
		t.Fatalf("decode metadata: %v", err)
	}
	metadataCues := document.Shorts[0]["subtitle_tracks"].([]any)[0].(map[string]any)["cues"].([]any)
	if metadataCues[2].(map[string]any)["text"] != "Later" {
		t.Fatalf("stored metadata subtitles were not regenerated: %#v", metadataCues)
	}
}

func TestDeferredClipSourceRangePatchRejectsInvalidRanges(t *testing.T) {
	store := jobs.NewMemoryStore()
	outputDir := t.TempDir()
	parent, jobDir := createDeferredRegionTestJob(t, store, outputDir, `{"clips":[{"start":176,"end":204}]}`)
	if err := os.WriteFile(filepath.Join(jobDir, "source_metadata.json"), []byte(`{"source_asset":{"probe":{"duration_seconds":220}},"shorts":[{"start":176,"end":204}]}`), 0o644); err != nil {
		t.Fatalf("write metadata: %v", err)
	}
	server := NewServerWithStore(config.Config{OutputDir: outputDir}, store)

	for _, body := range []string{
		`{"start":-1,"end":20}`,
		`{"start":100,"end":100}`,
		`{"start":200,"end":221}`,
	} {
		req := httptest.NewRequest(
			http.MethodPatch,
			fmt.Sprintf("/api/jobs/%s/clips/0/source-range", parent.ID),
			strings.NewReader(body),
		)
		req.Header.Set("Content-Type", "application/json")
		res := httptest.NewRecorder()
		server.Handler().ServeHTTP(res, req)
		if res.Code != http.StatusBadRequest {
			t.Fatalf("expected invalid source range to return 400, got %d: %s", res.Code, res.Body.String())
		}
	}
}

func TestDeferredClipWebcamRegionPatchRejectsInvalidCoordinates(t *testing.T) {
	store := jobs.NewMemoryStore()
	outputDir := t.TempDir()
	parent, jobDir := createDeferredRegionTestJob(t, store, outputDir, `{"clips":[{"layout_format":"streamer_stack"}]}`)
	if err := os.WriteFile(filepath.Join(jobDir, "source_metadata.json"), []byte(`{"shorts":[{}]}`), 0o644); err != nil {
		t.Fatalf("write metadata: %v", err)
	}
	server := NewServerWithStore(config.Config{OutputDir: outputDir}, store)

	for _, body := range []string{
		`{"webcam_region":{"x":0.8,"y":0.1,"width":0.3,"height":0.2}}`,
		`{"webcam_region":{"x":0.1,"y":0.1,"width":0,"height":0.2}}`,
		`{"webcam_region":{"x":0.1,"y":0.1,"width":0.2}}`,
	} {
		req := httptest.NewRequest(
			http.MethodPatch,
			fmt.Sprintf("/api/jobs/%s/clips/0/webcam-region", parent.ID),
			strings.NewReader(body),
		)
		req.Header.Set("Content-Type", "application/json")
		res := httptest.NewRecorder()
		server.Handler().ServeHTTP(res, req)
		if res.Code != http.StatusBadRequest {
			t.Fatalf("expected invalid webcam region to return 400, got %d: %s", res.Code, res.Body.String())
		}
	}
}

func TestDeferredClipWebcamRegionPatchRejectsInvalidFacecamSize(t *testing.T) {
	store := jobs.NewMemoryStore()
	outputDir := t.TempDir()
	parent, jobDir := createDeferredRegionTestJob(t, store, outputDir, `{"clips":[{"layout_format":"streamer_stack"}]}`)
	if err := os.WriteFile(filepath.Join(jobDir, "source_metadata.json"), []byte(`{"shorts":[{}]}`), 0o644); err != nil {
		t.Fatalf("write metadata: %v", err)
	}
	server := NewServerWithStore(config.Config{OutputDir: outputDir}, store)

	for _, facecamSize := range []string{"huge", "", "portrait"} {
		req := httptest.NewRequest(
			http.MethodPatch,
			fmt.Sprintf("/api/jobs/%s/clips/0/webcam-region", parent.ID),
			strings.NewReader(fmt.Sprintf(`{"webcam_region":{"x":0.1,"y":0.1,"width":0.2,"height":0.2},"facecam_size":%q}`, facecamSize)),
		)
		req.Header.Set("Content-Type", "application/json")
		res := httptest.NewRecorder()
		server.Handler().ServeHTTP(res, req)
		if res.Code != http.StatusBadRequest {
			t.Fatalf("expected invalid facecam size %q to return 400, got %d: %s", facecamSize, res.Code, res.Body.String())
		}
	}

	updated, ok := store.Get(context.Background(), parent.ID)
	if !ok {
		t.Fatal("parent job disappeared")
	}
	var result struct {
		Clips []map[string]any `json:"clips"`
	}
	if err := json.Unmarshal(updated.Result, &result); err != nil {
		t.Fatalf("decode stored result: %v", err)
	}
	if _, exists := result.Clips[0]["facecam_size"]; exists {
		t.Fatalf("invalid facecam size changed the stored clip: %#v", result.Clips)
	}
}

func TestDeferredClipGameplayRegionPatchPersistsResultAndMetadata(t *testing.T) {
	store := jobs.NewMemoryStore()
	outputDir := t.TempDir()
	parent, jobDir := createDeferredRegionTestJob(t, store, outputDir, `{"clips":[{"layout_format":"streamer_stack"},{"layout_format":"streamer_stack"}]}`)
	if err := os.WriteFile(filepath.Join(jobDir, "source_metadata.json"), []byte(`{"shorts":[{},{}]}`), 0o644); err != nil {
		t.Fatalf("write metadata: %v", err)
	}
	server := NewServerWithStore(config.Config{OutputDir: outputDir}, store)

	req := httptest.NewRequest(
		http.MethodPatch,
		fmt.Sprintf("/api/jobs/%s/clips/0/gameplay-region", parent.ID),
		strings.NewReader(`{"gameplay_region":{"x":0.28,"y":0.08,"width":0.70,"height":0.84}}`),
	)
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("expected gameplay region patch to succeed, got %d: %s", res.Code, res.Body.String())
	}

	updated, ok := store.Get(context.Background(), parent.ID)
	if !ok {
		t.Fatal("parent job disappeared")
	}
	var result struct {
		Clips []map[string]any `json:"clips"`
	}
	if err := json.Unmarshal(updated.Result, &result); err != nil {
		t.Fatalf("decode stored result: %v", err)
	}
	if result.Clips[0]["gameplay_region"].(map[string]any)["width"] != 0.70 {
		t.Fatalf("stored result missing gameplay region: %#v", result.Clips)
	}
	if _, exists := result.Clips[1]["gameplay_region"]; exists {
		t.Fatalf("patch changed neighboring clip: %#v", result.Clips)
	}

	metadata, err := os.ReadFile(filepath.Join(jobDir, "source_metadata.json"))
	if err != nil {
		t.Fatalf("read metadata: %v", err)
	}
	var document struct {
		Shorts []map[string]any `json:"shorts"`
	}
	if err := json.Unmarshal(metadata, &document); err != nil {
		t.Fatalf("decode metadata: %v", err)
	}
	if document.Shorts[0]["gameplay_region"].(map[string]any)["height"] != 0.84 {
		t.Fatalf("metadata missing gameplay region: %#v", document.Shorts)
	}
	if _, exists := document.Shorts[1]["gameplay_region"]; exists {
		t.Fatalf("metadata patch changed neighboring clip: %#v", document.Shorts)
	}
}

func TestDeferredClipTrackingPatchPersistsResultAndMetadata(t *testing.T) {
	store := jobs.NewMemoryStore()
	outputDir := t.TempDir()
	parent, jobDir := createDeferredRegionTestJob(t, store, outputDir, `{"clips":[{"layout_format":"streamer_stack"}]}`)
	if err := os.WriteFile(filepath.Join(jobDir, "source_metadata.json"), []byte(`{"shorts":[{}]}`), 0o644); err != nil {
		t.Fatalf("write metadata: %v", err)
	}
	server := NewServerWithStore(config.Config{OutputDir: outputDir}, store)

	req := httptest.NewRequest(
		http.MethodPatch,
		fmt.Sprintf("/api/jobs/%s/clips/0/streamer-tracking", parent.ID),
		strings.NewReader(`{"streamer_tracking_enabled":true}`),
	)
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("expected tracking patch to succeed, got %d: %s", res.Code, res.Body.String())
	}

	updated, ok := store.Get(context.Background(), parent.ID)
	if !ok {
		t.Fatal("parent job disappeared")
	}
	var result struct {
		Clips []map[string]any `json:"clips"`
	}
	if err := json.Unmarshal(updated.Result, &result); err != nil {
		t.Fatalf("decode stored result: %v", err)
	}
	if result.Clips[0]["streamer_tracking_enabled"] != true {
		t.Fatalf("stored result missing tracking flag: %#v", result.Clips)
	}

	metadata, err := os.ReadFile(filepath.Join(jobDir, "source_metadata.json"))
	if err != nil {
		t.Fatalf("read metadata: %v", err)
	}
	var document struct {
		Shorts []map[string]any `json:"shorts"`
	}
	if err := json.Unmarshal(metadata, &document); err != nil {
		t.Fatalf("decode metadata: %v", err)
	}
	if document.Shorts[0]["streamer_tracking_enabled"] != true {
		t.Fatalf("metadata missing tracking flag: %#v", document.Shorts)
	}
}

func TestDeferredClipGameplayZoomPatchPersistsResultAndMetadata(t *testing.T) {
	store := jobs.NewMemoryStore()
	outputDir := t.TempDir()
	parent, jobDir := createDeferredRegionTestJob(t, store, outputDir, `{"clips":[{},{}]}`)
	if err := os.WriteFile(filepath.Join(jobDir, "source_metadata.json"), []byte(`{"shorts":[{},{}]}`), 0o644); err != nil {
		t.Fatalf("write metadata: %v", err)
	}
	server := NewServerWithStore(config.Config{OutputDir: outputDir}, store)

	req := httptest.NewRequest(
		http.MethodPatch,
		fmt.Sprintf("/api/jobs/%s/clips/0/gameplay-zoom", parent.ID),
		strings.NewReader(`{"gameplay_zoom":1.25}`),
	)
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("expected gameplay zoom patch to succeed, got %d: %s", res.Code, res.Body.String())
	}

	updated, ok := store.Get(context.Background(), parent.ID)
	if !ok {
		t.Fatal("parent job disappeared")
	}
	var result struct {
		Clips []map[string]any `json:"clips"`
	}
	if err := json.Unmarshal(updated.Result, &result); err != nil {
		t.Fatalf("decode stored result: %v", err)
	}
	if result.Clips[0]["gameplay_zoom"] != 1.25 {
		t.Fatalf("stored result missing gameplay zoom: %#v", result.Clips)
	}
	if _, exists := result.Clips[1]["gameplay_zoom"]; exists {
		t.Fatalf("patch changed neighboring clip: %#v", result.Clips)
	}

	metadata, err := os.ReadFile(filepath.Join(jobDir, "source_metadata.json"))
	if err != nil {
		t.Fatalf("read metadata: %v", err)
	}
	var document struct {
		Shorts []map[string]any `json:"shorts"`
	}
	if err := json.Unmarshal(metadata, &document); err != nil {
		t.Fatalf("decode metadata: %v", err)
	}
	if document.Shorts[0]["gameplay_zoom"] != 1.25 {
		t.Fatalf("metadata missing gameplay zoom: %#v", document.Shorts)
	}
}

func TestDeferredClipGameplayRegionPatchRejectsInvalidCoordinates(t *testing.T) {
	store := jobs.NewMemoryStore()
	outputDir := t.TempDir()
	parent, jobDir := createDeferredRegionTestJob(t, store, outputDir, `{"clips":[{"layout_format":"streamer_stack"}]}`)
	if err := os.WriteFile(filepath.Join(jobDir, "source_metadata.json"), []byte(`{"shorts":[{}]}`), 0o644); err != nil {
		t.Fatalf("write metadata: %v", err)
	}
	server := NewServerWithStore(config.Config{OutputDir: outputDir}, store)

	for _, body := range []string{
		`{"gameplay_region":{"x":0.8,"y":0.1,"width":0.3,"height":0.2}}`,
		`{"gameplay_region":{"x":0.1,"y":0.1,"width":0,"height":0.2}}`,
		`{"gameplay_region":{"x":0.1,"y":0.1,"width":0.2}}`,
	} {
		req := httptest.NewRequest(
			http.MethodPatch,
			fmt.Sprintf("/api/jobs/%s/clips/0/gameplay-region", parent.ID),
			strings.NewReader(body),
		)
		req.Header.Set("Content-Type", "application/json")
		res := httptest.NewRecorder()
		server.Handler().ServeHTTP(res, req)
		if res.Code != http.StatusBadRequest {
			t.Fatalf("expected invalid gameplay region to return 400, got %d: %s", res.Code, res.Body.String())
		}
	}
}

func TestDeferredClipRenderCopiesWebcamRegionToChildMetadata(t *testing.T) {
	store := jobs.NewMemoryStore()
	outputDir := t.TempDir()
	parent, _ := createDeferredRegionTestJob(t, store, outputDir, `{"source_path":"source.mp4","clips":[{"layout_format":"streamer_stack","facecam_size":"large","webcam_region":{"x":0.02,"y":0.18,"width":0.23,"height":0.43},"gameplay_region":{"x":0.28,"y":0.08,"width":0.70,"height":0.84},"gameplay_zoom":1.25,"streamer_tracking_enabled":true}]}`)
	server := NewServerWithStore(config.Config{OutputDir: outputDir}, store)

	req := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/jobs/%s/clips/0/render", parent.ID), nil)
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(res, req)
	if res.Code != http.StatusAccepted {
		t.Fatalf("expected render request accepted, got %d: %s", res.Code, res.Body.String())
	}
	children, err := store.ListByKind(context.Background(), "clip-render")
	if err != nil || len(children) != 1 {
		t.Fatalf("expected one child render job, got %d (%v)", len(children), err)
	}
	if children[0].Metadata["webcam_region"].(map[string]any)["width"] != 0.23 {
		t.Fatalf("child job did not receive webcam region: %#v", children[0].Metadata)
	}
	if children[0].Metadata["facecam_size"] != "large" {
		t.Fatalf("child job did not receive facecam size: %#v", children[0].Metadata)
	}
	if children[0].Metadata["gameplay_region"].(map[string]any)["height"] != 0.84 {
		t.Fatalf("child job did not receive gameplay region: %#v", children[0].Metadata)
	}
	if children[0].Metadata["streamer_tracking_enabled"] != true {
		t.Fatalf("child job did not receive tracking flag: %#v", children[0].Metadata)
	}
	if children[0].Metadata["gameplay_zoom"] != 1.25 {
		t.Fatalf("child job did not receive gameplay zoom: %#v", children[0].Metadata)
	}
}

func TestDeferredClipRenderRejectsStreamerStackWithoutGameplayRegion(t *testing.T) {
	store := jobs.NewMemoryStore()
	outputDir := t.TempDir()
	parent, _ := createDeferredRegionTestJob(t, store, outputDir, `{"source_path":"source.mp4","clips":[{"layout_format":"streamer_stack","webcam_region":{"x":0.02,"y":0.18,"width":0.23,"height":0.43}}]}`)
	server := NewServerWithStore(config.Config{OutputDir: outputDir}, store)

	req := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/jobs/%s/clips/0/render", parent.ID), nil)
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(res, req)
	if res.Code != http.StatusConflict {
		t.Fatalf("expected missing gameplay region to return 409, got %d: %s", res.Code, res.Body.String())
	}
	children, err := store.ListByKind(context.Background(), "clip-render")
	if err != nil {
		t.Fatalf("list child jobs: %v", err)
	}
	if len(children) != 0 {
		t.Fatalf("missing gameplay region created child jobs: %#v", children)
	}
}

func TestDeferredClipRenderRejectsStreamerStackWithoutWebcamRegion(t *testing.T) {
	store := jobs.NewMemoryStore()
	outputDir := t.TempDir()
	parent, _ := createDeferredRegionTestJob(t, store, outputDir, `{"source_path":"source.mp4","clips":[{"layout_format":"streamer_stack"}]}`)
	server := NewServerWithStore(config.Config{OutputDir: outputDir}, store)

	req := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/jobs/%s/clips/0/render", parent.ID), nil)
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(res, req)
	if res.Code != http.StatusConflict {
		t.Fatalf("expected missing webcam region to return 409, got %d: %s", res.Code, res.Body.String())
	}
	children, err := store.ListByKind(context.Background(), "clip-render")
	if err != nil {
		t.Fatalf("list child jobs: %v", err)
	}
	if len(children) != 0 {
		t.Fatalf("missing webcam region created child jobs: %#v", children)
	}
}

func createDeferredRegionTestJob(t *testing.T, store *jobs.MemoryStore, outputDir, result string) (domain.Job, string) {
	t.Helper()
	parentDir := filepath.Join(outputDir, "parent-region")
	parent, err := store.Create(context.Background(), domain.CreateJobInput{
		Kind:      "clip-generation",
		OutputDir: parentDir,
		Metadata:  map[string]any{"defer_render": true},
	})
	if err != nil {
		t.Fatalf("create parent: %v", err)
	}
	if _, err := store.Claim(context.Background(), parent.ID); err != nil {
		t.Fatalf("claim parent: %v", err)
	}
	if _, err := store.Transition(context.Background(), parent.ID, domain.JobStatusClipsReady, ""); err != nil {
		t.Fatalf("mark parent ready: %v", err)
	}
	if err := store.SetResult(context.Background(), parent.ID, []byte(result)); err != nil {
		t.Fatalf("set parent result: %v", err)
	}
	if err := os.MkdirAll(parentDir, 0o755); err != nil {
		t.Fatalf("create parent directory: %v", err)
	}
	return parent, parentDir
}

func TestProcessPersistsDeferredModeAndDurableOutputDir(t *testing.T) {
	store := jobs.NewMemoryStore()
	outputDir := t.TempDir()
	server := NewServerWithStore(config.Config{OutputDir: outputDir}, store)
	req := httptest.NewRequest(http.MethodPost, "/api/process?clip_count=3", strings.NewReader(`{"url":"https://example.com/video.mp4","acknowledged":true,"defer_render":true,"layout_format":"streamer_stack","facecam_size":"large"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-AI-Api-Key", "test-key")
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(res, req)
	if res.Code != http.StatusAccepted {
		t.Fatalf("expected deferred process accepted, got %d: %s", res.Code, res.Body.String())
	}
	var payload struct {
		JobID string `json:"job_id"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode process response: %v", err)
	}
	job, ok := store.Get(context.Background(), payload.JobID)
	if !ok {
		t.Fatal("deferred job was not stored")
	}
	if job.Metadata["defer_render"] != true || job.Metadata["layout_format"] != "streamer_stack" || job.Metadata["facecam_size"] != "large" {
		t.Fatalf("deferred metadata was not persisted: %#v", job.Metadata)
	}
	if job.OutputDir != filepath.Join(outputDir, job.ID) {
		t.Fatalf("unexpected durable output directory: %q", job.OutputDir)
	}
}

func TestProcessDefaultsToDeferredClipDiscovery(t *testing.T) {
	store := jobs.NewMemoryStore()
	server := NewServerWithStore(config.Config{OutputDir: t.TempDir()}, store)
	req := httptest.NewRequest(http.MethodPost, "/api/process?clip_count=3", strings.NewReader(`{"url":"https://example.com/video.mp4","acknowledged":true,"layout_format":"streamer_stack","facecam_size":"large"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-AI-Api-Key", "test-key")
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(res, req)
	if res.Code != http.StatusAccepted {
		t.Fatalf("expected process accepted, got %d: %s", res.Code, res.Body.String())
	}
	var payload struct {
		JobID string `json:"job_id"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode process response: %v", err)
	}
	job, ok := store.Get(context.Background(), payload.JobID)
	if !ok {
		t.Fatal("job was not stored")
	}
	if job.Metadata["defer_render"] != true {
		t.Fatalf("clip discovery was not deferred by default: %#v", job.Metadata)
	}
}

func TestProcessAcceptsMinioObjectSource(t *testing.T) {
	server := NewServer(config.Config{})
	req := httptest.NewRequest(http.MethodPost, "/api/process?clip_count=5", strings.NewReader(`{"source_object":{"bucket":"videos","key":"source.mp4"},"source_url":"https://youtube.com/watch?v=1","acknowledged":true}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-AI-Api-Key", "test-key")
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(res, req)
	if res.Code != http.StatusAccepted {
		t.Fatalf("expected status 202, got %d: %s", res.Code, res.Body.String())
	}
}

func TestProcessAcceptsMultipartVideoAndStoresWorkerSourcePath(t *testing.T) {
	outputDir := t.TempDir()
	store := jobs.NewMemoryStore()
	server := NewServerWithStore(config.Config{OutputDir: outputDir}, store)
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	file, err := writer.CreateFormFile("file", "source.mp4")
	if err != nil {
		t.Fatalf("create file part: %v", err)
	}
	_, _ = file.Write([]byte("fake-video"))
	_ = writer.WriteField("acknowledged", "true")
	_ = writer.WriteField("source_url", "https://youtube.com/watch?v=1")
	_ = writer.WriteField("layout_format", "streamer_stack")
	_ = writer.WriteField("facecam_size", "large")
	_ = writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/process?clip_count=4", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("X-AI-Api-Key", "test-key")
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(res, req)
	if res.Code != http.StatusAccepted {
		t.Fatalf("expected status 202, got %d: %s", res.Code, res.Body.String())
	}
	var created struct {
		JobID string `json:"job_id"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	job, ok := store.Get(context.Background(), created.JobID)
	if !ok {
		t.Fatal("job was not stored")
	}
	path, ok := job.Metadata["source_path"].(string)
	if !ok || path == "" {
		t.Fatalf("missing source path metadata: %#v", job.Metadata)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("uploaded source was not saved: %v", err)
	}
	if job.Metadata["layout_format"] != "streamer_stack" || job.Metadata["facecam_size"] != "large" {
		t.Fatalf("multipart layout options were not stored: %#v", job.Metadata)
	}
}

func TestLocalEditorTranscribeUsesPythonWorkerOperation(t *testing.T) {
	outputDir := t.TempDir()
	server := NewServerWithDependencies(config.Config{OutputDir: outputDir}, jobs.NewMemoryStore(), nil, transcribingOperation{})
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	file, err := writer.CreateFormFile("file", "local.mp4")
	if err != nil {
		t.Fatalf("create file part: %v", err)
	}
	_, _ = file.Write([]byte("fake-video"))
	_ = writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/local-editor/transcribe", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(res, req)
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"language":"en"`) {
		t.Fatalf("unexpected transcription response: %d %s", res.Code, res.Body.String())
	}
}

func TestTranslationHeadersIncludesOpenRouterTranscriptionProvider(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/local-editor/transcribe", nil)
	req.Header.Set("X-AI-Transcription-OpenRouter-Provider", "deepinfra")

	headers := translationHeaders(req)
	if headers["X-AI-Transcription-OpenRouter-Provider"] != "deepinfra" {
		t.Fatalf("expected OpenRouter transcription provider header to be forwarded: %#v", headers)
	}
}

func TestTranslationHeadersIncludesTranscriptionLanguage(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/local-editor/transcribe", nil)
	req.Header.Set("X-AI-Transcription-Language", "it")

	headers := translationHeaders(req)
	if headers["X-AI-Transcription-Language"] != "it" {
		t.Fatalf("expected transcription language header to be forwarded: %#v", headers)
	}
}

func TestClipTranscriptRouteReadsWordTimingFromMetadata(t *testing.T) {
	outputDir := t.TempDir()
	metadataPath := filepath.Join(outputDir, "job-1", "source_metadata.json")
	if err := os.MkdirAll(filepath.Dir(metadataPath), 0o755); err != nil {
		t.Fatalf("create metadata directory: %v", err)
	}
	if err := os.WriteFile(metadataPath, []byte(`{"transcript":{"language":"en","segments":[{"words":[{"word":"Hello","start":1.2,"end":1.7}]}]},"shorts":[{"start":1,"end":3}]}`), 0o644); err != nil {
		t.Fatalf("write metadata: %v", err)
	}
	server := NewServer(config.Config{OutputDir: outputDir})
	req := httptest.NewRequest(http.MethodGet, "/api/clip/job-1/0/transcript", nil)
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(res, req)
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"language":"en"`) || !strings.Contains(res.Body.String(), `"startMs":200`) {
		t.Fatalf("unexpected transcript response: %d %s", res.Code, res.Body.String())
	}
}

func TestClipTranscriptRouteReadsSegmentTimingFromMetadata(t *testing.T) {
	outputDir := t.TempDir()
	metadataPath := filepath.Join(outputDir, "job-segments", "source_metadata.json")
	if err := os.MkdirAll(filepath.Dir(metadataPath), 0o755); err != nil {
		t.Fatalf("create metadata directory: %v", err)
	}
	if err := os.WriteFile(metadataPath, []byte(`{"transcript":{"language":"en","segments":[{"start":1.2,"end":2.7,"text":"Segment caption"}]},"shorts":[{"start":1,"end":3}]}`), 0o644); err != nil {
		t.Fatalf("write metadata: %v", err)
	}
	server := NewServer(config.Config{OutputDir: outputDir})
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/api/clip/job-segments/0/transcript", nil))
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"text":"Segment caption"`) || !strings.Contains(res.Body.String(), `"startMs":200`) {
		t.Fatalf("unexpected transcript response: %d %s", res.Code, res.Body.String())
	}
}

type regionMetadataS3Client struct {
	body     string
	putKey   string
	putBody  string
	putCalls int
}

func (c *regionMetadataS3Client) GetObject(_ context.Context, _ *s3.GetObjectInput, _ ...func(*s3.Options)) (*s3.GetObjectOutput, error) {
	return &s3.GetObjectOutput{Body: io.NopCloser(strings.NewReader(c.body))}, nil
}

func (c *regionMetadataS3Client) PutObject(_ context.Context, input *s3.PutObjectInput, _ ...func(*s3.Options)) (*s3.PutObjectOutput, error) {
	c.putCalls++
	contents, err := io.ReadAll(input.Body)
	if err != nil {
		return nil, err
	}
	c.putKey = aws.ToString(input.Key)
	c.putBody = string(contents)
	return &s3.PutObjectOutput{}, nil
}

func (c *regionMetadataS3Client) ListObjectsV2(context.Context, *s3.ListObjectsV2Input, ...func(*s3.Options)) (*s3.ListObjectsV2Output, error) {
	return &s3.ListObjectsV2Output{}, nil
}

func (c *regionMetadataS3Client) DeleteObjects(context.Context, *s3.DeleteObjectsInput, ...func(*s3.Options)) (*s3.DeleteObjectsOutput, error) {
	return &s3.DeleteObjectsOutput{}, nil
}

type transcriptMetadataS3Client struct {
	body string
}

func (c transcriptMetadataS3Client) GetObject(_ context.Context, _ *s3.GetObjectInput, _ ...func(*s3.Options)) (*s3.GetObjectOutput, error) {
	return &s3.GetObjectOutput{Body: io.NopCloser(strings.NewReader(c.body))}, nil
}

func (transcriptMetadataS3Client) ListObjectsV2(context.Context, *s3.ListObjectsV2Input, ...func(*s3.Options)) (*s3.ListObjectsV2Output, error) {
	return &s3.ListObjectsV2Output{}, nil
}

func (transcriptMetadataS3Client) DeleteObjects(context.Context, *s3.DeleteObjectsInput, ...func(*s3.Options)) (*s3.DeleteObjectsOutput, error) {
	return &s3.DeleteObjectsOutput{Deleted: []types.DeletedObject{}}, nil
}

func (transcriptMetadataS3Client) PutObject(context.Context, *s3.PutObjectInput, ...func(*s3.Options)) (*s3.PutObjectOutput, error) {
	return &s3.PutObjectOutput{}, nil
}

func TestClipTranscriptRouteReadsMetadataFromS3WhenLocalOutputMissing(t *testing.T) {
	server := NewServer(config.Config{OutputDir: t.TempDir()})
	server.s3Store = &integrations.S3Store{
		Client: transcriptMetadataS3Client{body: `{"transcript":{"language":"es","segments":[{"start":10.2,"end":11.7,"text":"Hola"}]},"shorts":[{"start":10,"end":12}]}`},
		Bucket: "openshorts-media",
	}
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/api/clip/job-s3/0/transcript", nil))
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"language":"es"`) || !strings.Contains(res.Body.String(), `"startMs":200`) {
		t.Fatalf("unexpected transcript response: %d %s", res.Code, res.Body.String())
	}
}

func TestProjectClipStatusesPersistInStoreInsteadOfSidecar(t *testing.T) {
	outputDir := t.TempDir()
	store := jobs.NewMemoryStore()
	job, err := store.Create(context.Background(), domain.CreateJobInput{Kind: "clip-generation"})
	if err != nil {
		t.Fatalf("create job: %v", err)
	}
	if err := store.SetResult(context.Background(), job.ID, []byte(`{"clips":[{"title":"First"}]}`)); err != nil {
		t.Fatalf("set result: %v", err)
	}
	server := NewServerWithStore(config.Config{OutputDir: outputDir}, store)

	patchReq := httptest.NewRequest(http.MethodPatch, "/api/projects/"+job.ID+"/clips/0/status", strings.NewReader(`{"status":"discarded"}`))
	patchReq.Header.Set("Content-Type", "application/json")
	patchRes := httptest.NewRecorder()
	server.Handler().ServeHTTP(patchRes, patchReq)
	if patchRes.Code != http.StatusOK || !strings.Contains(patchRes.Body.String(), `"status":"discarded"`) {
		t.Fatalf("unexpected status update: %d %s", patchRes.Code, patchRes.Body.String())
	}
	if _, err := os.Stat(filepath.Join(outputDir, job.ID, "clip_statuses.json")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("clip status was written to sidecar: %v", err)
	}

	// A fresh server with a different output directory simulates a restart or
	// redeploy where local/object storage is unavailable to the API process.
	server = NewServerWithStore(config.Config{OutputDir: t.TempDir()}, store)
	getReq := httptest.NewRequest(http.MethodGet, "/api/projects/"+job.ID+"/statuses", nil)
	getRes := httptest.NewRecorder()
	server.Handler().ServeHTTP(getRes, getReq)
	if getRes.Code != http.StatusOK || !strings.Contains(getRes.Body.String(), `"0"`) || !strings.Contains(getRes.Body.String(), `"discarded"`) {
		t.Fatalf("unexpected statuses response: %d %s", getRes.Code, getRes.Body.String())
	}
}

func TestProjectClipHashtagsPersistInJobResult(t *testing.T) {
	store := jobs.NewMemoryStore()
	job, err := store.Create(context.Background(), domain.CreateJobInput{Kind: "clip-generation"})
	if err != nil {
		t.Fatalf("create job: %v", err)
	}
	if err := store.SetResult(context.Background(), job.ID, []byte(`{"clips":[{"title":"First","caption":"Keep this","video_filename":"source_clip_1.mp4","hashtags":["#old"]}],"source":"preserve"}`)); err != nil {
		t.Fatalf("set result: %v", err)
	}
	server := NewServerWithStore(config.Config{OutputDir: t.TempDir()}, store)

	request := httptest.NewRequest(
		http.MethodPatch,
		"/api/projects/"+job.ID+"/clips/0/metadata",
		strings.NewReader(`{"hashtags":["#new","#viral"],"video_title_for_youtube_short":"New title","video_description_for_tiktok":"TikTok caption","video_description_for_instagram":"Instagram caption","viral_hook_text":"NEW HOOK"}`),
	)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("expected metadata update to succeed, got %d: %s", response.Code, response.Body.String())
	}

	updated, ok := store.Get(context.Background(), job.ID)
	if !ok {
		t.Fatalf("load updated job")
	}
	var payload map[string]any
	if err := json.Unmarshal(updated.Result, &payload); err != nil {
		t.Fatalf("decode stored result: %v", err)
	}
	clips, ok := payload["clips"].([]any)
	if !ok || len(clips) != 1 {
		t.Fatalf("unexpected stored clips: %#v", payload["clips"])
	}
	clip, ok := clips[0].(map[string]any)
	if !ok {
		t.Fatalf("unexpected stored clip: %#v", clips[0])
	}
	encodedHashtags, err := json.Marshal(clip["hashtags"])
	if err != nil || string(encodedHashtags) != `["#new","#viral"]` {
		t.Fatalf("expected hashtags in stored result, got %#v", clip["hashtags"])
	}
	if clip["title"] != "First" || clip["caption"] != "Keep this" || clip["video_filename"] != "source_clip_1.mp4" || payload["source"] != "preserve" {
		t.Fatalf("metadata update dropped existing result fields: %#v", payload)
	}
	if clip["video_title_for_youtube_short"] != "New title" || clip["video_description_for_tiktok"] != "TikTok caption" || clip["video_description_for_instagram"] != "Instagram caption" || clip["viral_hook_text"] != "NEW HOOK" {
		t.Fatalf("expected regenerated clip information in stored result, got %#v", clip)
	}
}

func TestDeleteProjectRemovesItsLocalOutputDirectory(t *testing.T) {
	outputDir := t.TempDir()
	store := jobs.NewMemoryStore()
	job, err := store.Create(context.Background(), domain.CreateJobInput{Kind: "clip-generation"})
	if err != nil {
		t.Fatalf("create job: %v", err)
	}
	projectDir := filepath.Join(outputDir, job.ID)
	if err := os.MkdirAll(projectDir, 0o755); err != nil {
		t.Fatalf("create project directory: %v", err)
	}
	if err := os.WriteFile(filepath.Join(projectDir, "render-cache.mp4"), []byte("stale"), 0o644); err != nil {
		t.Fatalf("write project artifact: %v", err)
	}

	server := NewServerWithStore(config.Config{OutputDir: outputDir}, store)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodDelete, "/api/projects/"+job.ID, nil))

	if response.Code != http.StatusOK {
		t.Fatalf("expected delete status 200, got %d: %s", response.Code, response.Body.String())
	}
	if _, err := os.Stat(projectDir); !os.IsNotExist(err) {
		t.Fatalf("project output directory was not removed: %v", err)
	}
	if _, exists := store.Get(context.Background(), job.ID); exists {
		t.Fatal("deleted project still exists in the store")
	}
}

func TestProjectHistoryReadsLocalMetadataForGoJobs(t *testing.T) {
	outputDir := t.TempDir()
	metadataPath := filepath.Join(outputDir, "job-1", "source_metadata.json")
	if err := os.MkdirAll(filepath.Dir(metadataPath), 0o755); err != nil {
		t.Fatalf("create project directory: %v", err)
	}
	if err := os.WriteFile(metadataPath, []byte(`{"shorts":[{"title":"First clip","video_filename":"clip.mp4"}]}`), 0o644); err != nil {
		t.Fatalf("write metadata: %v", err)
	}
	server := NewServer(config.Config{OutputDir: outputDir})
	req := httptest.NewRequest(http.MethodGet, "/api/projects/history?limit=48", nil)
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(res, req)
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"job_id":"job-1"`) || !strings.Contains(res.Body.String(), `"video_url":"/videos/job-1/clip.mp4"`) {
		t.Fatalf("unexpected project history response: %d %s", res.Code, res.Body.String())
	}
}

func TestProjectHistoryReadsPersistedJobResultWithoutLocalFiles(t *testing.T) {
	store := jobs.NewMemoryStore()
	job, err := store.Create(context.Background(), domain.CreateJobInput{Kind: "clip-generation"})
	if err != nil {
		t.Fatalf("create job: %v", err)
	}
	if err := store.SetResult(context.Background(), job.ID, []byte(`{"source_asset":{"probe":{"duration_seconds":3577}},"clips":[{"title":"First clip","video_filename":"clip.mp4"}]}`)); err != nil {
		t.Fatalf("set result: %v", err)
	}
	server := NewServerWithStore(config.Config{OutputDir: t.TempDir()}, store)
	request := httptest.NewRequest(http.MethodGet, "/api/projects/history?limit=48", nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"job_id":"`+job.ID+`"`) || !strings.Contains(response.Body.String(), `"video_url":"/videos/`+job.ID+`/clip.mp4"`) || !strings.Contains(response.Body.String(), `"master_duration":3577`) {
		t.Fatalf("unexpected project history response: %d %s", response.Code, response.Body.String())
	}
}

func TestProjectClipsReadsMasterDurationFromSidecarForPersistedResult(t *testing.T) {
	outputDir := t.TempDir()
	store := jobs.NewMemoryStore()
	job, err := store.Create(context.Background(), domain.CreateJobInput{Kind: "clip-generation"})
	if err != nil {
		t.Fatalf("create job: %v", err)
	}
	if err := store.SetResult(context.Background(), job.ID, []byte(`{"source_path":"source.mp4","clips":[{"start":962,"end":1022,"video_filename":"clip.mp4"}]}`)); err != nil {
		t.Fatalf("set result: %v", err)
	}
	metadataPath := filepath.Join(outputDir, job.ID, "source_metadata.json")
	if err := os.MkdirAll(filepath.Dir(metadataPath), 0o755); err != nil {
		t.Fatalf("create metadata directory: %v", err)
	}
	if err := os.WriteFile(metadataPath, []byte(`{"source_asset":{"probe":{"duration_seconds":2575.88}}}`), 0o644); err != nil {
		t.Fatalf("write metadata: %v", err)
	}

	server := NewServerWithStore(config.Config{OutputDir: outputDir}, store)
	request := httptest.NewRequest(http.MethodGet, "/api/projects/clips/"+job.ID, nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"master_duration":2575.88`) {
		t.Fatalf("expected sidecar master duration, got %d %s", response.Code, response.Body.String())
	}
}

func TestProjectClipsReturnsDirectS3ArtifactURLWhenConfigured(t *testing.T) {
	store := jobs.NewMemoryStore()
	job, err := store.Create(context.Background(), domain.CreateJobInput{Kind: "clip-generation"})
	if err != nil {
		t.Fatalf("create job: %v", err)
	}
	if err := store.SetResult(context.Background(), job.ID, []byte(`{"clips":[{"title":"First clip","video_filename":"source_clip_1.mp4"}]}`)); err != nil {
		t.Fatalf("set result: %v", err)
	}
	server := NewServerWithStore(config.Config{OutputDir: t.TempDir()}, store)
	server.artifactURLOverride = func(jobID, filename string) string {
		return "https://storage.example/openshorts-media/" + jobID + "/" + filename + "?X-Amz-Signature=test"
	}
	request := httptest.NewRequest(http.MethodGet, "/api/projects/clips/"+job.ID, nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "https://storage.example/openshorts-media/"+job.ID+"/source_clip_1.mp4?") {
		t.Fatalf("expected direct S3 URL, got %d %s", response.Code, response.Body.String())
	}
}

func TestProjectClipsUsesPersistedRenderJobIDForClipArtifactURL(t *testing.T) {
	store := jobs.NewMemoryStore()
	job, err := store.Create(context.Background(), domain.CreateJobInput{Kind: "clip-generation"})
	if err != nil {
		t.Fatalf("create job: %v", err)
	}
	if err := store.SetResult(context.Background(), job.ID, []byte(`{"clips":[{"video_filename":"remotion_8_1787260172918.mp4","render_job_id":"clip-render-1"}]}`)); err != nil {
		t.Fatalf("set result: %v", err)
	}
	server := NewServerWithStore(config.Config{OutputDir: t.TempDir()}, store)
	server.s3Store = &integrations.S3Store{Bucket: "openshorts-media", PublicURLBase: "https://minio.example"}

	request := httptest.NewRequest(http.MethodGet, "/api/projects/clips/"+job.ID, nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	want := "https://minio.example/openshorts-media/" + job.ID + "/clips/clip-render-1/remotion_8_1787260172918.mp4"
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), want) {
		t.Fatalf("expected clip-scoped Remotion URL, got %d %s", response.Code, response.Body.String())
	}
}

func TestClipVideoURLPersistsRenderJobIDInProjectResult(t *testing.T) {
	store := jobs.NewMemoryStore()
	job, err := store.Create(context.Background(), domain.CreateJobInput{Kind: "clip-generation"})
	if err != nil {
		t.Fatalf("create job: %v", err)
	}
	if err := store.SetResult(context.Background(), job.ID, []byte(`{"clips":[{"video_filename":"remotion_8_1787260172918.mp4"}]}`)); err != nil {
		t.Fatalf("set result: %v", err)
	}
	server := NewServerWithDependencies(config.Config{OutputDir: t.TempDir()}, store, nil, clipVideoURLOperation{})
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/clip/"+job.ID+"/0/video-url",
		strings.NewReader(`{"new_video_url":"/videos/`+job.ID+`/remotion_8_1787260172918.mp4","render_job_id":"clip-render-1"}`),
	)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected video URL persistence to succeed, got %d: %s", response.Code, response.Body.String())
	}
	updated, ok := store.Get(context.Background(), job.ID)
	if !ok || !strings.Contains(string(updated.Result), `"render_job_id":"clip-render-1"`) {
		t.Fatalf("render job ID was not persisted in project result: %#v", updated.Result)
	}
}

func TestProjectClipsUsesCompletedDeferredRenderArtifact(t *testing.T) {
	store := jobs.NewMemoryStore()
	parent, err := store.Create(context.Background(), domain.CreateJobInput{
		Kind:     "clip-generation",
		Metadata: map[string]any{"defer_render": true},
	})
	if err != nil {
		t.Fatalf("create parent job: %v", err)
	}
	if err := store.SetResult(context.Background(), parent.ID, []byte(`{"clips":[{"source_video_filename":"source.mp4","render_status":"found"}]}`)); err != nil {
		t.Fatalf("set parent result: %v", err)
	}
	child, err := store.Create(context.Background(), domain.CreateJobInput{
		Kind:        "clip-render",
		ParentJobID: parent.ID,
		ClipIndex:   0,
	})
	if err != nil {
		t.Fatalf("create render job: %v", err)
	}
	if err := store.SetResult(context.Background(), child.ID, []byte(`{"clips":[{"video_filename":"source_clip_1.mp4"}]}`)); err != nil {
		t.Fatalf("set render result: %v", err)
	}
	if _, err := store.Transition(context.Background(), child.ID, domain.JobStatusProcessing, ""); err != nil {
		t.Fatalf("start render job: %v", err)
	}
	if _, err := store.Transition(context.Background(), child.ID, domain.JobStatusCompleted, ""); err != nil {
		t.Fatalf("complete render job: %v", err)
	}

	server := NewServerWithStore(config.Config{OutputDir: t.TempDir()}, store)
	server.artifactURLOverride = func(jobID, filename string) string {
		return "https://storage.example/openshorts-media/" + jobID + "/" + filename + "?X-Amz-Signature=test"
	}
	request := httptest.NewRequest(http.MethodGet, "/api/projects/clips/"+parent.ID, nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	want := "https://storage.example/openshorts-media/" + parent.ID + "/source_clip_1.mp4?"
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), want) {
		t.Fatalf("expected completed render artifact URL, got %d %s", response.Code, response.Body.String())
	}
}

func TestCodexStatelessRoutesUseWorkerOperations(t *testing.T) {
	server := NewServerWithDependencies(config.Config{}, jobs.NewMemoryStore(), nil, codexOperation{})
	for _, test := range []struct {
		method string
		path   string
		body   string
		want   string
	}{
		{http.MethodGet, "/api/ai/openai-codex/status", "", `"connected":true`},
		{http.MethodPost, "/api/ai/openai-codex/disconnect", "", `"connected":false`},
		{http.MethodGet, "/api/ai/openai-codex/models", "", `"defaultModel":"gpt-test"`},
	} {
		req := httptest.NewRequest(test.method, test.path, strings.NewReader(test.body))
		res := httptest.NewRecorder()
		server.Handler().ServeHTTP(res, req)
		if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), test.want) {
			t.Fatalf("unexpected %s %s response: %d %s", test.method, test.path, res.Code, res.Body.String())
		}
	}
}

func TestLocalEditorHashtagsUseGoWorkerBoundary(t *testing.T) {
	server := NewServerWithDependencies(config.Config{}, jobs.NewMemoryStore(), nil, hashtagOperation{})
	req := httptest.NewRequest(http.MethodPost, "/api/local-editor/hashtags", strings.NewReader(`{"title":"A title"}`))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(res, req)
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"#one"`) {
		t.Fatalf("unexpected hashtag response: %d %s", res.Code, res.Body.String())
	}
}

func TestLocalEditorClipInfoUsesGoWorkerBoundary(t *testing.T) {
	server := NewServerWithDependencies(config.Config{}, jobs.NewMemoryStore(), nil, clipInfoOperation{})
	req := httptest.NewRequest(http.MethodPost, "/api/local-editor/clip-info", strings.NewReader(`{"title":"A title","caption":"A caption","subtitle_text":"Current subtitles","trim_start_seconds":120,"trim_end_seconds":158,"source_metadata":{"channel":"Rubius"},"source_context":{"what":"Meltopia"}}`))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(res, req)
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"New title"`) || !strings.Contains(res.Body.String(), `"NEW HOOK"`) {
		t.Fatalf("unexpected clip info response: %d %s", res.Code, res.Body.String())
	}
}

func TestLocalEditorClipInfoRejectsIncompleteWorkerResult(t *testing.T) {
	server := NewServerWithDependencies(config.Config{}, jobs.NewMemoryStore(), nil, incompleteClipInfoOperation{})
	req := httptest.NewRequest(http.MethodPost, "/api/local-editor/clip-info", strings.NewReader(`{"title":"A title","caption":"A caption","subtitle_text":"Current subtitles"}`))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(res, req)
	if res.Code != http.StatusBadGateway || !strings.Contains(res.Body.String(), "incomplete") {
		t.Fatalf("expected incomplete worker result to be rejected, got %d %s", res.Code, res.Body.String())
	}
}

func TestLocalEditorRenderStoresSourceAndStartsRenderer(t *testing.T) {
	renderer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/render" || r.Method != http.MethodPost {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"renderId":"render-local-1","status":"queued"}`))
	}))
	defer renderer.Close()
	outputDir := t.TempDir()
	server := NewServer(config.Config{OutputDir: outputDir, RenderServiceURL: renderer.URL})

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	file, err := writer.CreateFormFile("file", "local.mp4")
	if err != nil {
		t.Fatalf("create file part: %v", err)
	}
	_, _ = file.Write([]byte("fake-video"))
	_ = writer.WriteField("props", `{"durationInFrames":30,"fps":30,"width":1080,"height":1920}`)
	_ = writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/local-editor/render", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(res, req)
	if res.Code != http.StatusAccepted || !strings.Contains(res.Body.String(), `"renderId":"render-local-1"`) || !strings.Contains(res.Body.String(), `"jobId":"local-editor-`) {
		t.Fatalf("unexpected local render response: %d %s", res.Code, res.Body.String())
	}
}

func TestLocalEditorBurnSubtitlesUsesPythonWorker(t *testing.T) {
	outputDir := t.TempDir()
	jobDir := filepath.Join(outputDir, "local-editor-1")
	if err := os.MkdirAll(jobDir, 0o755); err != nil {
		t.Fatalf("create local editor directory: %v", err)
	}
	if err := os.WriteFile(filepath.Join(jobDir, "source.mp4"), []byte("fake-video"), 0o644); err != nil {
		t.Fatalf("write source: %v", err)
	}
	server := NewServerWithDependencies(config.Config{OutputDir: outputDir}, jobs.NewMemoryStore(), nil, burnOperation{})
	body := `{"job_id":"local-editor-1","input_filename":"source.mp4","subtitle_cues":[{"start":0,"end":1,"text":"Hello"}],"subtitle_style":{}}`
	req := httptest.NewRequest(http.MethodPost, "/api/local-editor/burn-subtitles", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(res, req)
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"outputUrl"`) {
		t.Fatalf("unexpected subtitle burn response: %d %s", res.Code, res.Body.String())
	}
}

func TestSocialUserRouteProxiesProfilesToUploadPost(t *testing.T) {
	vendor := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Apikey secret" {
			t.Fatalf("unexpected authorization header: %q", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"profiles":[{"username":"creator","social_accounts":{"youtube":{},"tiktok":{}}}]}`))
	}))
	defer vendor.Close()
	server := NewServer(config.Config{UploadPostUserURL: vendor.URL})
	req := httptest.NewRequest(http.MethodGet, "/api/social/user", nil)
	req.Header.Set("X-Upload-Post-Key", "secret")
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(res, req)
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"username":"creator"`) || !strings.Contains(res.Body.String(), `"youtube"`) {
		t.Fatalf("unexpected social user response: %d %s", res.Code, res.Body.String())
	}
}

func TestSocialPostRoutePublishesClipFromGo(t *testing.T) {
	vendor := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Apikey secret" {
			t.Fatalf("unexpected authorization header: %q", r.Header.Get("Authorization"))
		}
		if err := r.ParseMultipartForm(1024 * 1024); err != nil {
			t.Fatalf("parse multipart form: %v", err)
		}
		if r.FormValue("user") != "creator" || r.FormValue("platform[]") != "youtube" {
			t.Fatalf("unexpected publish fields: %#v", r.Form)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"success":true,"upload_id":"upload-1"}`))
	}))
	defer vendor.Close()

	outputDir := t.TempDir()
	store := jobs.NewMemoryStore()
	job, err := store.Create(context.Background(), domain.CreateJobInput{Kind: "clip-generation", OutputDir: filepath.Join(outputDir, "job-1")})
	if err != nil {
		t.Fatal(err)
	}
	jobDir := filepath.Join(outputDir, job.ID)
	if err := os.MkdirAll(jobDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(jobDir, "clip.mp4"), []byte("video"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := store.SetResult(context.Background(), job.ID, []byte(`{"clips":[{"video_url":"/videos/`+job.ID+`/clip.mp4","title":"T"}]}`)); err != nil {
		t.Fatal(err)
	}
	server := NewServerWithStore(config.Config{OutputDir: outputDir, UploadPostURL: vendor.URL}, store)
	req := httptest.NewRequest(http.MethodPost, "/api/social/post", strings.NewReader(`{"job_id":"`+job.ID+`","clip_index":0,"api_key":"secret","user_id":"creator","platforms":["youtube"]}`))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(res, req)
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"upload_id":"upload-1"`) {
		t.Fatalf("unexpected social post response: %d %s", res.Code, res.Body.String())
	}
}

func TestSubtitleRouteBurnsWithGoFFmpegRunner(t *testing.T) {
	outputDir := t.TempDir()
	store := jobs.NewMemoryStore()
	job, err := store.Create(context.Background(), domain.CreateJobInput{Kind: "clip-generation"})
	if err != nil {
		t.Fatal(err)
	}
	jobDir := filepath.Join(outputDir, job.ID)
	if err := os.MkdirAll(jobDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(jobDir, "clip.mp4"), []byte("video"), 0o644); err != nil {
		t.Fatal(err)
	}
	metadata := `{"transcript":{"language":"en","segments":[{"start":0,"end":1,"text":"Hello from a segment"}]},"shorts":[{"start":0,"end":1}]}`
	if err := os.WriteFile(filepath.Join(jobDir, "clip_metadata.json"), []byte(metadata), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := store.SetResult(context.Background(), job.ID, []byte(`{"clips":[{"video_url":"/videos/`+job.ID+`/clip.mp4"}]}`)); err != nil {
		t.Fatal(err)
	}
	server := NewServerWithStore(config.Config{OutputDir: outputDir}, store)
	runner := &subtitleCommandRunner{}
	server.mediaRunner = runner
	req := httptest.NewRequest(http.MethodPost, "/api/subtitle", strings.NewReader(`{"job_id":"`+job.ID+`","clip_index":0}`))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(res, req)
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"success":true`) || len(runner.args) == 0 {
		t.Fatalf("unexpected subtitle response: %d %s args=%#v", res.Code, res.Body.String(), runner.args)
	}
	if _, err := os.Stat(filepath.Join(jobDir, "subtitles_0.srt")); err != nil {
		t.Fatalf("expected persisted subtitle file: %v", err)
	}
	var savedResult struct {
		Clips []map[string]any `json:"clips"`
	}
	savedJob, ok := store.Get(context.Background(), job.ID)
	if !ok || json.Unmarshal(savedJob.Result, &savedResult) != nil {
		t.Fatalf("expected saved job result")
	}
	if savedResult.Clips[0]["active_subtitle_track_id"] != "original" || savedResult.Clips[0]["subtitle_url"] != "/videos/"+job.ID+"/subtitles_0.srt" {
		t.Fatalf("subtitle track was not persisted in job result: %#v", savedResult.Clips[0])
	}
	metadataContents, err := os.ReadFile(filepath.Join(jobDir, "clip_metadata.json"))
	if err != nil || !strings.Contains(string(metadataContents), `"subtitle_tracks"`) || !strings.Contains(string(metadataContents), `"layers"`) {
		t.Fatalf("subtitle metadata was not persisted: %v %s", err, string(metadataContents))
	}
}

func TestTranslateRouteUsesGoElevenLabsClient(t *testing.T) {
	vendor := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/dubbing":
			_, _ = w.Write([]byte(`{"dubbing_id":"dub-1"}`))
		case "/v1/dubbing/dub-1":
			_, _ = w.Write([]byte(`{"status":"dubbed"}`))
		case "/v1/dubbing/dub-1/audio/es":
			_, _ = w.Write([]byte("translated"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer vendor.Close()
	outputDir := t.TempDir()
	store := jobs.NewMemoryStore()
	job, err := store.Create(context.Background(), domain.CreateJobInput{Kind: "clip-generation"})
	if err != nil {
		t.Fatal(err)
	}
	jobDir := filepath.Join(outputDir, job.ID)
	if err := os.MkdirAll(jobDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(jobDir, "clip.mp4"), []byte("source"), 0o644); err != nil {
		t.Fatal(err)
	}
	metadata := `{"shorts":[{"start":0,"end":1}]}`
	if err := os.WriteFile(filepath.Join(jobDir, "clip_metadata.json"), []byte(metadata), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := store.SetResult(context.Background(), job.ID, []byte(`{"clips":[{"video_url":"/videos/`+job.ID+`/clip.mp4"}]}`)); err != nil {
		t.Fatal(err)
	}
	server := NewServerWithStore(config.Config{OutputDir: outputDir, ElevenLabsURL: vendor.URL + "/v1"}, store)
	req := httptest.NewRequest(http.MethodPost, "/api/translate", strings.NewReader(`{"job_id":"`+job.ID+`","clip_index":0,"target_language":"es"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-ElevenLabs-Key", "secret")
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(res, req)
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"new_video_url"`) {
		t.Fatalf("unexpected translation response: %d %s", res.Code, res.Body.String())
	}
	if _, err := os.Stat(filepath.Join(jobDir, "translated_es_clip.mp4")); err != nil {
		t.Fatalf("translated output missing: %v", err)
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
