package jobs

import (
	"context"
	"os"
	"testing"
	"time"
)

func TestMemoryStoreRenderPerformanceSummaryAggregatesSuccessfulMetrics(t *testing.T) {
	store := NewMemoryStore()
	now := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)
	metrics := []RenderPerformanceMetric{
		{
			RenderID: "done-1", JobID: "job-1", ClipIndex: 1, Status: "done",
			StartedAt: now.Add(-31 * time.Minute), FinishedAt: now.Add(-30 * time.Minute),
			TotalDurationMS: 1000, StageDurationsMS: map[string]int64{"compositing": 600, "encoding": 400},
			OutputBytes: 100, AccelerationMode: "gpu",
		},
		{
			RenderID: "done-2", JobID: "job-2", ClipIndex: 2, Status: "done",
			StartedAt: now.Add(-26*time.Hour - 3*time.Second), FinishedAt: now.Add(-26 * time.Hour),
			TotalDurationMS: 3000, StageDurationsMS: map[string]int64{"compositing": 1500, "encoding": 1500},
			OutputBytes: 300, AccelerationMode: "cpu",
		},
		{
			RenderID: "failed-1", JobID: "job-3", ClipIndex: 3, Status: "error",
			StartedAt: now.Add(-time.Hour - 4*time.Second), FinishedAt: now.Add(-time.Hour),
			TotalDurationMS: 9000, StageDurationsMS: map[string]int64{"encoding": 9000},
			OutputBytes: 0, AccelerationMode: "gpu", Error: "renderer failed",
		},
	}
	for _, metric := range metrics {
		if err := store.UpsertRenderPerformanceMetric(context.Background(), metric); err != nil {
			t.Fatal(err)
		}
	}

	got, err := store.GetRenderPerformanceSummary(context.Background(), "30d", now)
	if err != nil {
		t.Fatal(err)
	}
	if got.Summary.RenderCount != 3 || got.Summary.SuccessfulCount != 2 || got.Summary.FailedCount != 1 {
		t.Fatalf("unexpected counts: %#v", got.Summary)
	}
	if got.Summary.AverageDurationMS != 2000 || got.Summary.P95DurationMS != 2900 {
		t.Fatalf("failed render leaked into duration statistics: %#v", got.Summary)
	}
	if got.Summary.AccelerationCounts["gpu"] != 2 || got.Summary.AccelerationCounts["cpu"] != 1 {
		t.Fatalf("unexpected acceleration counts: %#v", got.Summary.AccelerationCounts)
	}
	if got.Stages[0].Name != "compositing" || got.Stages[0].Share != 52.5 {
		t.Fatalf("unexpected stage aggregation: %#v", got.Stages)
	}
	if len(got.Trend) != 2 || len(got.Recent) != 3 {
		t.Fatalf("unexpected trend/recent data: %#v %#v", got.Trend, got.Recent)
	}
}

func TestParseRenderPerformanceRangeRejectsUnsupportedValues(t *testing.T) {
	now := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)
	if _, err := ParseRenderPerformanceRange("365d", now); err == nil {
		t.Fatal("expected unsupported range to be rejected")
	}
	parsed, err := ParseRenderPerformanceRange("7d", now)
	if err != nil || parsed.From == nil || !parsed.From.Equal(now.Add(-7*24*time.Hour)) || !parsed.To.Equal(now) {
		t.Fatalf("unexpected seven-day range: %#v %v", parsed, err)
	}
}

func TestPostgresRenderPerformanceSummary(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not configured")
	}
	ctx := context.Background()
	now := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)
	store, err := OpenPostgresStore(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	metrics := []RenderPerformanceMetric{
		{
			RenderID: "summary-pg-done-1", JobID: "summary-pg-job-1", ClipIndex: 1, Status: "done",
			StartedAt: now.Add(-31 * time.Minute), FinishedAt: now.Add(-30 * time.Minute),
			TotalDurationMS: 1000, StageDurationsMS: map[string]int64{"compositing": 600, "encoding": 400},
			OutputBytes: 100, AccelerationMode: "gpu",
		},
		{
			RenderID: "summary-pg-done-2", JobID: "summary-pg-job-2", ClipIndex: 2, Status: "done",
			StartedAt: now.Add(-26*time.Hour - 3*time.Second), FinishedAt: now.Add(-26 * time.Hour),
			TotalDurationMS: 3000, StageDurationsMS: map[string]int64{"compositing": 1500, "encoding": 1500},
			OutputBytes: 300, AccelerationMode: "cpu",
		},
		{
			RenderID: "summary-pg-failed-1", JobID: "summary-pg-job-3", ClipIndex: 3, Status: "error",
			StartedAt: now.Add(-time.Hour - 4*time.Second), FinishedAt: now.Add(-time.Hour),
			TotalDurationMS: 9000, StageDurationsMS: map[string]int64{"encoding": 9000},
			OutputBytes: 0, AccelerationMode: "gpu", Error: "renderer failed",
		},
	}
	for _, metric := range metrics {
		metric := metric
		t.Cleanup(func() {
			_, _ = store.db.ExecContext(ctx, "DELETE FROM render_performance_metrics WHERE render_id = $1", metric.RenderID)
		})
		if err := store.UpsertRenderPerformanceMetric(ctx, metric); err != nil {
			t.Fatal(err)
		}
	}

	got, err := store.GetRenderPerformanceSummary(ctx, "30d", now)
	if err != nil {
		t.Fatal(err)
	}
	if got.Summary.RenderCount != 3 || got.Summary.AverageDurationMS != 2000 || got.Summary.P95DurationMS != 2900 {
		t.Fatalf("unexpected postgres summary: %#v", got.Summary)
	}
	if got.Stages[0].Name != "compositing" || got.Stages[0].Share != 52.5 {
		t.Fatalf("unexpected postgres stages: %#v", got.Stages)
	}
}
