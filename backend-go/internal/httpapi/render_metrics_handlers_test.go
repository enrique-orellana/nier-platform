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

func TestRenderMetricsHandlerReadsSummary(t *testing.T) {
	store := jobs.NewMemoryStore()
	now := time.Now().UTC()
	for _, metric := range []jobs.RenderPerformanceMetric{
		{
			RenderID: "summary-handler-done-1", JobID: "summary-handler-job-1", ClipIndex: 1, Status: "done",
			StartedAt: now.Add(-2 * time.Minute), FinishedAt: now.Add(-time.Minute), TotalDurationMS: 1000,
			StageDurationsMS: map[string]int64{"compositing": 600, "encoding": 400}, OutputBytes: 100,
			AccelerationMode: "gpu",
		},
		{
			RenderID: "summary-handler-done-2", JobID: "summary-handler-job-2", ClipIndex: 2, Status: "done",
			StartedAt: now.Add(-3 * time.Hour), FinishedAt: now.Add(-2 * time.Hour), TotalDurationMS: 3000,
			StageDurationsMS: map[string]int64{"compositing": 1500, "encoding": 1500}, OutputBytes: 300,
			AccelerationMode: "cpu",
		},
		{
			RenderID: "summary-handler-error-1", JobID: "summary-handler-job-3", ClipIndex: 3, Status: "error",
			StartedAt: now.Add(-2 * time.Hour), FinishedAt: now.Add(-time.Hour), TotalDurationMS: 9000,
			StageDurationsMS: map[string]int64{"encoding": 9000}, AccelerationMode: "gpu", Error: "renderer failed",
		},
	} {
		if err := store.UpsertRenderPerformanceMetric(context.Background(), metric); err != nil {
			t.Fatal(err)
		}
	}

	server := NewServerWithStore(config.Config{}, store)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/render-metrics?range=7d", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("expected summary response, got %d: %s", response.Code, response.Body.String())
	}

	var summary jobs.RenderPerformanceSummary
	if err := json.NewDecoder(response.Body).Decode(&summary); err != nil {
		t.Fatal(err)
	}
	if summary.Range != "7d" || summary.Summary.RenderCount != 3 || summary.Summary.AverageDurationMS != 2000 || summary.Summary.P95DurationMS != 2900 {
		t.Fatalf("unexpected summary response: %#v", summary)
	}
	if len(summary.Trend) != 1 || len(summary.Stages) != 2 || len(summary.Recent) != 3 {
		t.Fatalf("unexpected summary collections: %#v", summary)
	}
}

func TestRenderMetricsHandlerReadsFilteredRecentPage(t *testing.T) {
	store := jobs.NewMemoryStore()
	now := time.Now().UTC()
	for index, metric := range []jobs.RenderPerformanceMetric{
		{
			RenderID: "filtered-recent-done-1", JobID: "filtered-job-1", ClipIndex: 1, Status: "done",
			StartedAt: now.Add(-1 * time.Minute), FinishedAt: now.Add(-30 * time.Second), TotalDurationMS: 1000,
			StageDurationsMS: map[string]int64{}, AccelerationMode: "gpu",
		},
		{
			RenderID: "filtered-recent-error", JobID: "filtered-job-2", ClipIndex: 2, Status: "error",
			StartedAt: now.Add(-2 * time.Minute), FinishedAt: now.Add(-1 * time.Minute), TotalDurationMS: 2000,
			StageDurationsMS: map[string]int64{}, AccelerationMode: "gpu",
		},
		{
			RenderID: "filtered-recent-done-2", JobID: "filtered-job-3", ClipIndex: 3, Status: "done",
			StartedAt: now.Add(-3 * time.Minute), FinishedAt: now.Add(-2 * time.Minute), TotalDurationMS: 3000,
			StageDurationsMS: map[string]int64{}, AccelerationMode: "cpu",
		},
	} {
		if err := store.UpsertRenderPerformanceMetric(context.Background(), metric); err != nil {
			t.Fatalf("insert metric %d: %v", index, err)
		}
	}

	server := NewServerWithStore(config.Config{}, store)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/render-metrics?range=7d&recent_page=2&recent_page_size=1&recent_status=done", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("expected filtered recent response, got %d: %s", response.Code, response.Body.String())
	}

	var summary jobs.RenderPerformanceSummary
	if err := json.NewDecoder(response.Body).Decode(&summary); err != nil {
		t.Fatal(err)
	}
	if summary.RecentTotal != 2 || summary.RecentPage != 2 || summary.RecentPageSize != 1 || len(summary.Recent) != 1 {
		t.Fatalf("unexpected recent pagination: %#v", summary)
	}
	if summary.Recent[0].RenderID != "filtered-recent-done-2" || summary.Recent[0].Status != "done" {
		t.Fatalf("unexpected filtered recent item: %#v", summary.Recent[0])
	}
}

func TestRenderMetricsHandlerRejectsInvalidSummaryRange(t *testing.T) {
	server := NewServerWithStore(config.Config{}, jobs.NewMemoryStore())
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/render-metrics?range=365d", nil))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected invalid range to return 400, got %d: %s", response.Code, response.Body.String())
	}
}

func TestRenderMetricsHandlerReturnsEmptySummary(t *testing.T) {
	server := NewServerWithStore(config.Config{}, jobs.NewMemoryStore())
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/render-metrics?range=30d", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("expected empty summary response, got %d: %s", response.Code, response.Body.String())
	}

	var summary jobs.RenderPerformanceSummary
	if err := json.NewDecoder(response.Body).Decode(&summary); err != nil {
		t.Fatal(err)
	}
	if summary.Summary.RenderCount != 0 || len(summary.Trend) != 0 || len(summary.Stages) != 0 || len(summary.Recent) != 0 {
		t.Fatalf("expected empty summary, got %#v", summary)
	}
}
