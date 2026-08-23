package jobs

import (
	"context"
	"os"
	"testing"
	"time"
)

func TestMemoryStoreUpsertsRenderPerformanceMetricByRenderID(t *testing.T) {
	store := NewMemoryStore()
	metric := RenderPerformanceMetric{
		RenderID:          "render-1",
		JobID:             "job-1",
		VersionID:         "version-1",
		ClipIndex:         2,
		Status:            "done",
		StartedAt:         time.Date(2026, 8, 23, 10, 0, 0, 0, time.UTC),
		FinishedAt:        time.Date(2026, 8, 23, 10, 0, 1, 0, time.UTC),
		TotalDurationMS:   1000,
		StageDurationsMS:  map[string]int64{"render_media": 900},
		RenderConcurrency: 4,
		WorkerCount:       12,
		OutputBytes:       1234,
		AccelerationMode:  "gpu",
	}
	if err := store.UpsertRenderPerformanceMetric(context.Background(), metric); err != nil {
		t.Fatal(err)
	}

	metric.Status = "error"
	metric.Error = "retry failed"
	if err := store.UpsertRenderPerformanceMetric(context.Background(), metric); err != nil {
		t.Fatal(err)
	}

	got, ok, err := store.GetRenderPerformanceMetric(context.Background(), metric.RenderID)
	if err != nil {
		t.Fatal(err)
	}
	if !ok || got.Status != "error" || got.Error != metric.Error || got.OutputBytes != metric.OutputBytes {
		t.Fatalf("unexpected metric after upsert: %#v", got)
	}
	if got.StageDurationsMS["render_media"] != 900 {
		t.Fatalf("stage durations were not retained: %#v", got.StageDurationsMS)
	}
	if got.AccelerationMode != "gpu" {
		t.Fatalf("acceleration mode was not retained: %#v", got)
	}
}

func TestValidateRenderPerformanceMetricRequiresCPUOrGPUAccelerationMode(t *testing.T) {
	metric := RenderPerformanceMetric{
		RenderID:         "render-mode-test",
		JobID:            "job-mode-test",
		Status:           "done",
		StartedAt:        time.Date(2026, 8, 23, 10, 0, 0, 0, time.UTC),
		FinishedAt:       time.Date(2026, 8, 23, 10, 0, 1, 0, time.UTC),
		AccelerationMode: "gpu",
	}
	if err := ValidateRenderPerformanceMetric(metric); err != nil {
		t.Fatalf("expected GPU acceleration mode to be valid: %v", err)
	}
	metric.AccelerationMode = "tpu"
	if err := ValidateRenderPerformanceMetric(metric); err == nil {
		t.Fatal("expected unsupported acceleration mode to be rejected")
	}
}

func TestPostgresRenderPerformanceMetricSurvivesReopenAndDuplicateCallback(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not configured")
	}
	ctx := context.Background()
	metric := RenderPerformanceMetric{
		RenderID:          "render-pg-test-" + time.Now().UTC().Format("20060102150405.000000000"),
		JobID:             "job-pg-test",
		ClipIndex:         0,
		Status:            "done",
		StartedAt:         time.Now().UTC().Add(-time.Second),
		FinishedAt:        time.Now().UTC(),
		TotalDurationMS:   1000,
		StageDurationsMS:  map[string]int64{"render_media": 900},
		RenderConcurrency: 1,
		WorkerCount:       4,
		OutputBytes:       42,
		AccelerationMode:  "cpu",
	}
	first, err := OpenPostgresStore(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	if err := first.UpsertRenderPerformanceMetric(ctx, metric); err != nil {
		_ = first.Close()
		t.Fatal(err)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}

	second, err := OpenPostgresStore(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	defer second.db.ExecContext(ctx, `DELETE FROM render_performance_metrics WHERE render_id = $1`, metric.RenderID)
	metric.Status = "error"
	metric.Error = "duplicate callback update"
	if err := second.UpsertRenderPerformanceMetric(ctx, metric); err != nil {
		t.Fatal(err)
	}
	got, ok, err := second.GetRenderPerformanceMetric(ctx, metric.RenderID)
	if err != nil {
		t.Fatal(err)
	}
	if !ok || got.Status != "error" || got.Error != metric.Error {
		t.Fatalf("metric did not survive reopen/upsert: %#v", got)
	}
}
