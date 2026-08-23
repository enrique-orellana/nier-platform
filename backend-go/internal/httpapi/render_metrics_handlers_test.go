package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/mutonby/openshorts/backend-go/internal/config"
	"github.com/mutonby/openshorts/backend-go/internal/jobs"
)

func TestRenderMetricsHandlerPersistsCompletedAndFailedMetrics(t *testing.T) {
	store := jobs.NewMemoryStore()
	server := NewServerWithStore(config.Config{}, store)
	payload := map[string]any{
		"render_id":          "render-handler-1",
		"job_id":             "job-1",
		"version_id":         "version-1",
		"clip_index":         1,
		"status":             "done",
		"started_at":         time.Date(2026, 8, 23, 10, 0, 0, 0, time.UTC),
		"finished_at":        time.Date(2026, 8, 23, 10, 0, 1, 0, time.UTC),
		"total_duration_ms":  1000,
		"stage_durations_ms": map[string]int64{"render_media": 900},
		"render_concurrency": 4,
		"worker_count":       12,
		"output_bytes":       1234,
		"acceleration_mode":  "gpu",
	}
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/render-metrics", bytes.NewReader(body)))
	if response.Code != http.StatusOK {
		t.Fatalf("expected successful metric persistence, got %d: %s", response.Code, response.Body.String())
	}

	got, ok, err := store.GetRenderPerformanceMetric(context.Background(), "render-handler-1")
	if err != nil {
		t.Fatal(err)
	}
	if !ok || got.JobID != "job-1" || got.StageDurationsMS["render_media"] != 900 {
		t.Fatalf("metric was not persisted: %#v", got)
	}
	if got.AccelerationMode != "gpu" {
		t.Fatalf("acceleration mode was not persisted: %#v", got)
	}

	payload["status"] = "error"
	payload["error"] = "renderer failed"
	body, err = json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/render-metrics", bytes.NewReader(body)))
	if response.Code != http.StatusOK {
		t.Fatalf("expected failed metric persistence, got %d: %s", response.Code, response.Body.String())
	}
	got, ok, err = store.GetRenderPerformanceMetric(context.Background(), "render-handler-1")
	if err != nil {
		t.Fatal(err)
	}
	if !ok || got.Status != "error" || got.Error != "renderer failed" {
		t.Fatalf("failed metric did not replace completed metric: %#v", got)
	}
}
