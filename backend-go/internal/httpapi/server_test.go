package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
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

	"github.com/mutonby/openshorts/backend-go/internal/config"
	"github.com/mutonby/openshorts/backend-go/internal/domain"
	"github.com/mutonby/openshorts/backend-go/internal/jobs"
	"github.com/mutonby/openshorts/backend-go/internal/manifests"
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

type burnOperation struct{}

func (burnOperation) Run(_ context.Context, _ string, operation string, payload map[string]any, _ map[string]string) (json.RawMessage, error) {
	if operation != "burn_subtitles" || payload["source_path"] == "" {
		return nil, fmt.Errorf("unexpected burn request: %s %#v", operation, payload)
	}
	return json.RawMessage(`{"outputUrl":"/videos/local-editor-1/subtitled_source.mp4"}`), nil
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

	listReq := httptest.NewRequest(http.MethodGet, "/api/clip/job-1/0/versions", nil)
	listRes := httptest.NewRecorder()
	server.Handler().ServeHTTP(listRes, listReq)
	if listRes.Code != http.StatusOK || !strings.Contains(listRes.Body.String(), created.Version.VersionID) {
		t.Fatalf("unexpected list response: %d %s", listRes.Code, listRes.Body.String())
	}

	branchReq := httptest.NewRequest(http.MethodPost, "/api/clip/job-1/0/versions/branch", strings.NewReader(`{"version_id":"`+created.Version.VersionID+`"}`))
	branchReq.Header.Set("Content-Type", "application/json")
	branchRes := httptest.NewRecorder()
	server.Handler().ServeHTTP(branchRes, branchReq)
	if branchRes.Code != http.StatusOK || !strings.Contains(branchRes.Body.String(), `"parent_version_id":"`+created.Version.VersionID+`"`) {
		t.Fatalf("unexpected branch response: %d %s", branchRes.Code, branchRes.Body.String())
	}

	completeReq := httptest.NewRequest(http.MethodPost, "/api/clip/job-1/0/versions/"+created.Version.VersionID+"/complete", strings.NewReader(`{"output_url":"/videos/job-1/rendered.mp4"}`))
	completeReq.Header.Set("Content-Type", "application/json")
	completeRes := httptest.NewRecorder()
	server.Handler().ServeHTTP(completeRes, completeReq)
	if completeRes.Code != http.StatusOK || !strings.Contains(completeRes.Body.String(), `"current_version_id":"`+created.Version.VersionID+`"`) {
		t.Fatalf("unexpected complete response: %d %s", completeRes.Code, completeRes.Body.String())
	}
}

func TestVideoProxyForwardsRangeAndContentHeaders(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Range") != "bytes=10-19" {
			t.Fatalf("expected range header, got %q", r.Header.Get("Range"))
		}
		w.Header().Set("Content-Type", "video/mp4")
		w.Header().Set("Content-Range", "bytes 10-19/100")
		w.Header().Set("Accept-Ranges", "bytes")
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write([]byte("0123456789"))
	}))
	defer upstream.Close()

	server := NewServer(config.Config{})
	req := httptest.NewRequest(http.MethodGet, "/api/video-proxy?url="+url.QueryEscape(upstream.URL+"/video.mp4"), nil)
	req.Header.Set("Range", "bytes=10-19")
	res := httptest.NewRecorder()
	server.Handler().ServeHTTP(res, req)
	if res.Code != http.StatusPartialContent || res.Header().Get("Content-Range") != "bytes 10-19/100" || res.Body.String() != "0123456789" {
		t.Fatalf("unexpected proxy response: %d %#v %q", res.Code, res.Header(), res.Body.String())
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

func TestProcessAcceptsMinioObjectSource(t *testing.T) {
	server := NewServer(config.Config{})
	req := httptest.NewRequest(http.MethodPost, "/api/process?clip_count=5", strings.NewReader(`{"source_object":{"bucket":"videos","key":"source.mp4"},"source_url":"https://youtube.com/watch?v=1","acknowledged":true}`))
	req.Header.Set("Content-Type", "application/json")
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
	_ = writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/process?clip_count=4", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
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
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"language":"en"`) || !strings.Contains(res.Body.String(), `"startMs":199`) {
		t.Fatalf("unexpected transcript response: %d %s", res.Code, res.Body.String())
	}
}

func TestProjectClipStatusesUseGoSidecarContract(t *testing.T) {
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

	patchReq := httptest.NewRequest(http.MethodPatch, "/api/projects/"+job.ID+"/clips/0/status", strings.NewReader(`{"status":"editing"}`))
	patchReq.Header.Set("Content-Type", "application/json")
	patchRes := httptest.NewRecorder()
	server.Handler().ServeHTTP(patchRes, patchReq)
	if patchRes.Code != http.StatusOK || !strings.Contains(patchRes.Body.String(), `"status":"editing"`) {
		t.Fatalf("unexpected status update: %d %s", patchRes.Code, patchRes.Body.String())
	}

	getReq := httptest.NewRequest(http.MethodGet, "/api/projects/"+job.ID+"/statuses", nil)
	getRes := httptest.NewRecorder()
	server.Handler().ServeHTTP(getRes, getReq)
	if getRes.Code != http.StatusOK || !strings.Contains(getRes.Body.String(), `"0"`) || !strings.Contains(getRes.Body.String(), `"editing"`) {
		t.Fatalf("unexpected statuses response: %d %s", getRes.Code, getRes.Body.String())
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
