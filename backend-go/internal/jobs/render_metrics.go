package jobs

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
)

var ErrRenderMetricNotFound = errors.New("render metric not found")

type RenderPerformanceMetric struct {
	RenderID          string           `json:"render_id"`
	JobID             string           `json:"job_id"`
	VersionID         string           `json:"version_id,omitempty"`
	ClipIndex         int              `json:"clip_index"`
	Status            string           `json:"status"`
	StartedAt         time.Time        `json:"started_at"`
	FinishedAt        time.Time        `json:"finished_at"`
	TotalDurationMS   int64            `json:"total_duration_ms"`
	StageDurationsMS  map[string]int64 `json:"stage_durations_ms"`
	RenderConcurrency int              `json:"render_concurrency"`
	WorkerCount       int              `json:"worker_count"`
	OutputBytes       int64            `json:"output_bytes"`
	AccelerationMode  string           `json:"acceleration_mode"`
	Error             string           `json:"error,omitempty"`
	CreatedAt         time.Time        `json:"created_at,omitempty"`
	UpdatedAt         time.Time        `json:"updated_at,omitempty"`
}

func validateRenderPerformanceMetric(metric RenderPerformanceMetric) error {
	if metric.RenderID == "" || metric.JobID == "" {
		return errors.New("render_id and job_id are required")
	}
	if metric.Status != "done" && metric.Status != "error" {
		return errors.New("render metric status must be done or error")
	}
	if metric.ClipIndex < 0 || metric.TotalDurationMS < 0 || metric.OutputBytes < 0 {
		return errors.New("render metric numeric values must not be negative")
	}
	if metric.AccelerationMode != "cpu" && metric.AccelerationMode != "gpu" {
		return errors.New("render metric acceleration_mode must be cpu or gpu")
	}
	if metric.StartedAt.IsZero() || metric.FinishedAt.IsZero() {
		return errors.New("render metric timestamps are required")
	}
	if metric.FinishedAt.Before(metric.StartedAt) {
		return errors.New("render metric finished_at must not precede started_at")
	}
	if metric.StageDurationsMS == nil {
		metric.StageDurationsMS = map[string]int64{}
	}
	for stage, duration := range metric.StageDurationsMS {
		if stage == "" || duration < 0 {
			return errors.New("render metric stage durations must be named and non-negative")
		}
	}
	return nil
}

func ValidateRenderPerformanceMetric(metric RenderPerformanceMetric) error {
	return validateRenderPerformanceMetric(metric)
}

func cloneRenderPerformanceMetric(metric RenderPerformanceMetric) RenderPerformanceMetric {
	stageDurations := make(map[string]int64, len(metric.StageDurationsMS))
	for stage, duration := range metric.StageDurationsMS {
		stageDurations[stage] = duration
	}
	metric.StageDurationsMS = stageDurations
	return metric
}

func (s *MemoryStore) UpsertRenderPerformanceMetric(_ context.Context, metric RenderPerformanceMetric) error {
	if err := validateRenderPerformanceMetric(metric); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.renderMetrics == nil {
		s.renderMetrics = make(map[string]RenderPerformanceMetric)
	}
	existing, ok := s.renderMetrics[metric.RenderID]
	if ok {
		metric.CreatedAt = existing.CreatedAt
	} else {
		metric.CreatedAt = time.Now().UTC()
	}
	metric.UpdatedAt = time.Now().UTC()
	s.renderMetrics[metric.RenderID] = cloneRenderPerformanceMetric(metric)
	return nil
}

func (s *MemoryStore) GetRenderPerformanceMetric(_ context.Context, renderID string) (RenderPerformanceMetric, bool, error) {
	s.mu.RLock()
	metric, ok := s.renderMetrics[renderID]
	s.mu.RUnlock()
	if !ok {
		return RenderPerformanceMetric{}, false, nil
	}
	return cloneRenderPerformanceMetric(metric), true, nil
}

const (
	renderPerformanceRecentLimit     = 20
	RenderPerformanceDefaultPageSize = 10
	RenderPerformanceMaxPageSize     = 100
)

type RenderPerformanceRange struct {
	Key  string
	From *time.Time
	To   time.Time
}

type RenderPerformanceSummary struct {
	Range          string                         `json:"range"`
	From           *time.Time                     `json:"from"`
	To             time.Time                      `json:"to"`
	Summary        RenderPerformanceSummaryStats  `json:"summary"`
	Trend          []RenderPerformanceTrendPoint  `json:"trend"`
	Stages         []RenderPerformanceStage       `json:"stages"`
	Recent         []RenderPerformanceRecentEntry `json:"recent"`
	RecentTotal    int64                          `json:"recent_total"`
	RecentPage     int                            `json:"recent_page"`
	RecentPageSize int                            `json:"recent_page_size"`
}

type RenderPerformanceSummaryStats struct {
	RenderCount        int64            `json:"render_count"`
	SuccessfulCount    int64            `json:"successful_count"`
	FailedCount        int64            `json:"failed_count"`
	SuccessRate        float64          `json:"success_rate"`
	AverageDurationMS  int64            `json:"average_duration_ms"`
	P95DurationMS      int64            `json:"p95_duration_ms"`
	TotalOutputBytes   int64            `json:"total_output_bytes"`
	AccelerationCounts map[string]int64 `json:"acceleration_counts"`
}

type RenderPerformanceTrendPoint struct {
	Date              string `json:"date"`
	RenderCount       int64  `json:"render_count"`
	FailedCount       int64  `json:"failed_count"`
	AverageDurationMS int64  `json:"average_duration_ms"`
	P95DurationMS     int64  `json:"p95_duration_ms"`
}

type RenderPerformanceStage struct {
	Name       string  `json:"name"`
	DurationMS int64   `json:"duration_ms"`
	Share      float64 `json:"share"`
}

type RenderPerformanceRecentEntry struct {
	RenderID         string    `json:"render_id"`
	JobID            string    `json:"job_id"`
	VersionID        string    `json:"version_id,omitempty"`
	ClipIndex        int       `json:"clip_index"`
	Status           string    `json:"status"`
	TotalDurationMS  int64     `json:"total_duration_ms"`
	AccelerationMode string    `json:"acceleration_mode"`
	OutputBytes      int64     `json:"output_bytes"`
	FinishedAt       time.Time `json:"finished_at"`
	Error            string    `json:"error,omitempty"`
}

type RenderPerformanceRecentQuery struct {
	Range            string
	Page             int
	PageSize         int
	Status           string
	AccelerationMode string
	Search           string
}

type RenderPerformanceRecentResult struct {
	Items    []RenderPerformanceRecentEntry
	Total    int64
	Page     int
	PageSize int
}

func ValidateRenderPerformanceRecentQuery(query RenderPerformanceRecentQuery) error {
	if query.Page < 1 {
		return errors.New("recent page must be at least 1")
	}
	if query.PageSize < 1 || query.PageSize > RenderPerformanceMaxPageSize {
		return fmt.Errorf("recent page size must be between 1 and %d", RenderPerformanceMaxPageSize)
	}
	if query.Status != "" && query.Status != "all" && query.Status != "done" && query.Status != "error" {
		return fmt.Errorf("unsupported render status %q", query.Status)
	}
	if query.AccelerationMode != "" && query.AccelerationMode != "all" && query.AccelerationMode != "cpu" && query.AccelerationMode != "gpu" {
		return fmt.Errorf("unsupported acceleration mode %q", query.AccelerationMode)
	}
	return nil
}

func ParseRenderPerformanceRange(value string, now time.Time) (RenderPerformanceRange, error) {
	to := now.UTC()
	if value == "" {
		value = "30d"
	}
	period := RenderPerformanceRange{Key: value, To: to}
	switch value {
	case "7d":
		from := to.Add(-7 * 24 * time.Hour)
		period.From = &from
	case "30d":
		from := to.Add(-30 * 24 * time.Hour)
		period.From = &from
	case "90d":
		from := to.Add(-90 * 24 * time.Hour)
		period.From = &from
	case "all":
	default:
		return RenderPerformanceRange{}, fmt.Errorf("unsupported render metrics range %q", value)
	}
	return period, nil
}

type renderPerformanceTrendAggregate struct {
	renderCount int64
	failedCount int64
	durationsMS []int64
}

func (s *MemoryStore) GetRenderPerformanceSummary(_ context.Context, rangeKey string, now time.Time) (RenderPerformanceSummary, error) {
	period, err := ParseRenderPerformanceRange(rangeKey, now)
	if err != nil {
		return RenderPerformanceSummary{}, err
	}

	s.mu.RLock()
	metrics := make([]RenderPerformanceMetric, 0, len(s.renderMetrics))
	for _, metric := range s.renderMetrics {
		metrics = append(metrics, cloneRenderPerformanceMetric(metric))
	}
	s.mu.RUnlock()

	filtered := make([]RenderPerformanceMetric, 0, len(metrics))
	for _, metric := range metrics {
		finishedAt := metric.FinishedAt.UTC()
		if period.From != nil && finishedAt.Before(*period.From) {
			continue
		}
		if finishedAt.After(period.To) {
			continue
		}
		filtered = append(filtered, metric)
	}
	sort.Slice(filtered, func(i, j int) bool {
		if filtered[i].FinishedAt.Equal(filtered[j].FinishedAt) {
			return filtered[i].RenderID > filtered[j].RenderID
		}
		return filtered[i].FinishedAt.After(filtered[j].FinishedAt)
	})

	result := RenderPerformanceSummary{
		Range:  period.Key,
		From:   period.From,
		To:     period.To,
		Trend:  make([]RenderPerformanceTrendPoint, 0),
		Stages: make([]RenderPerformanceStage, 0),
		Recent: make([]RenderPerformanceRecentEntry, 0),
	}
	result.Summary.AccelerationCounts = map[string]int64{"cpu": 0, "gpu": 0}
	trendByDate := make(map[string]*renderPerformanceTrendAggregate)
	stageTotals := make(map[string]int64)
	var successfulDurations []int64
	var totalSuccessfulStageDuration int64

	for _, metric := range filtered {
		result.Summary.RenderCount++
		result.Summary.TotalOutputBytes += metric.OutputBytes
		result.Summary.AccelerationCounts[metric.AccelerationMode]++
		if metric.Status == "done" {
			result.Summary.SuccessfulCount++
			successfulDurations = append(successfulDurations, metric.TotalDurationMS)
			for stage, duration := range metric.StageDurationsMS {
				stageTotals[stage] += duration
				totalSuccessfulStageDuration += duration
			}
		} else if metric.Status == "error" {
			result.Summary.FailedCount++
		}

		day := metric.FinishedAt.UTC().Format("2006-01-02")
		trend := trendByDate[day]
		if trend == nil {
			trend = &renderPerformanceTrendAggregate{}
			trendByDate[day] = trend
		}
		trend.renderCount++
		if metric.Status == "error" {
			trend.failedCount++
		} else if metric.Status == "done" {
			trend.durationsMS = append(trend.durationsMS, metric.TotalDurationMS)
		}

		if len(result.Recent) < renderPerformanceRecentLimit {
			result.Recent = append(result.Recent, RenderPerformanceRecentEntry{
				RenderID: metric.RenderID, JobID: metric.JobID, VersionID: metric.VersionID,
				ClipIndex: metric.ClipIndex, Status: metric.Status, TotalDurationMS: metric.TotalDurationMS,
				AccelerationMode: metric.AccelerationMode, OutputBytes: metric.OutputBytes,
				FinishedAt: metric.FinishedAt, Error: metric.Error,
			})
		}
	}

	if result.Summary.RenderCount > 0 {
		result.Summary.SuccessRate = roundToOneDecimal(float64(result.Summary.SuccessfulCount) / float64(result.Summary.RenderCount) * 100)
	}
	result.Summary.AverageDurationMS = averageDuration(successfulDurations)
	result.Summary.P95DurationMS = percentileDuration(successfulDurations, 0.95)

	trendDates := make([]string, 0, len(trendByDate))
	for day := range trendByDate {
		trendDates = append(trendDates, day)
	}
	sort.Strings(trendDates)
	for _, day := range trendDates {
		trend := trendByDate[day]
		result.Trend = append(result.Trend, RenderPerformanceTrendPoint{
			Date: day, RenderCount: trend.renderCount, FailedCount: trend.failedCount,
			AverageDurationMS: averageDuration(trend.durationsMS), P95DurationMS: percentileDuration(trend.durationsMS, 0.95),
		})
	}

	for stage, duration := range stageTotals {
		share := float64(0)
		if totalSuccessfulStageDuration > 0 {
			share = roundToOneDecimal(float64(duration) / float64(totalSuccessfulStageDuration) * 100)
		}
		result.Stages = append(result.Stages, RenderPerformanceStage{Name: stage, DurationMS: duration, Share: share})
	}
	sort.Slice(result.Stages, func(i, j int) bool {
		if result.Stages[i].DurationMS == result.Stages[j].DurationMS {
			return result.Stages[i].Name < result.Stages[j].Name
		}
		return result.Stages[i].DurationMS > result.Stages[j].DurationMS
	})
	return result, nil
}

func (s *MemoryStore) GetRenderPerformanceRecent(_ context.Context, query RenderPerformanceRecentQuery, now time.Time) (RenderPerformanceRecentResult, error) {
	if query.PageSize == 0 {
		query.PageSize = RenderPerformanceDefaultPageSize
	}
	if err := ValidateRenderPerformanceRecentQuery(query); err != nil {
		return RenderPerformanceRecentResult{}, err
	}
	period, err := ParseRenderPerformanceRange(query.Range, now)
	if err != nil {
		return RenderPerformanceRecentResult{}, err
	}

	s.mu.RLock()
	metrics := make([]RenderPerformanceMetric, 0, len(s.renderMetrics))
	for _, metric := range s.renderMetrics {
		metrics = append(metrics, cloneRenderPerformanceMetric(metric))
	}
	s.mu.RUnlock()

	search := strings.ToLower(strings.TrimSpace(query.Search))
	filtered := make([]RenderPerformanceMetric, 0, len(metrics))
	for _, metric := range metrics {
		finishedAt := metric.FinishedAt.UTC()
		if (period.From != nil && finishedAt.Before(*period.From)) || finishedAt.After(period.To) {
			continue
		}
		if query.Status != "" && query.Status != "all" && metric.Status != query.Status {
			continue
		}
		if query.AccelerationMode != "" && query.AccelerationMode != "all" && metric.AccelerationMode != query.AccelerationMode {
			continue
		}
		if search != "" {
			searchable := strings.ToLower(fmt.Sprintf("%s %s %s clip_%02d", metric.RenderID, metric.JobID, metric.VersionID, metric.ClipIndex+1))
			if !strings.Contains(searchable, search) {
				continue
			}
		}
		filtered = append(filtered, metric)
	}
	sort.Slice(filtered, func(i, j int) bool {
		if filtered[i].FinishedAt.Equal(filtered[j].FinishedAt) {
			return filtered[i].RenderID > filtered[j].RenderID
		}
		return filtered[i].FinishedAt.After(filtered[j].FinishedAt)
	})

	result := RenderPerformanceRecentResult{
		Items: make([]RenderPerformanceRecentEntry, 0, query.PageSize), Page: query.Page, PageSize: query.PageSize,
		Total: int64(len(filtered)),
	}
	start := (query.Page - 1) * query.PageSize
	if start >= len(filtered) {
		return result, nil
	}
	end := start + query.PageSize
	if end > len(filtered) {
		end = len(filtered)
	}
	for _, metric := range filtered[start:end] {
		result.Items = append(result.Items, RenderPerformanceRecentEntry{
			RenderID: metric.RenderID, JobID: metric.JobID, VersionID: metric.VersionID,
			ClipIndex: metric.ClipIndex, Status: metric.Status, TotalDurationMS: metric.TotalDurationMS,
			AccelerationMode: metric.AccelerationMode, OutputBytes: metric.OutputBytes,
			FinishedAt: metric.FinishedAt, Error: metric.Error,
		})
	}
	return result, nil
}

func averageDuration(durations []int64) int64 {
	if len(durations) == 0 {
		return 0
	}
	var total int64
	for _, duration := range durations {
		total += duration
	}
	return int64(math.Round(float64(total) / float64(len(durations))))
}

func percentileDuration(durations []int64, percentile float64) int64 {
	if len(durations) == 0 {
		return 0
	}
	sorted := append([]int64(nil), durations...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	position := percentile * float64(len(sorted)-1)
	lower := int(math.Floor(position))
	upper := int(math.Ceil(position))
	if lower == upper {
		return sorted[lower]
	}
	weight := position - float64(lower)
	return int64(math.Round(float64(sorted[lower]) + (float64(sorted[upper])-float64(sorted[lower]))*weight))
}

func roundToOneDecimal(value float64) float64 {
	return math.Round(value*10) / 10
}
