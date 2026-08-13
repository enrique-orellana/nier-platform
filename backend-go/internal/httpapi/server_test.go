package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
