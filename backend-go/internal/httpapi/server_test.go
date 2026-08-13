package httpapi

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mutonby/openshorts/backend-go/internal/config"
)

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
