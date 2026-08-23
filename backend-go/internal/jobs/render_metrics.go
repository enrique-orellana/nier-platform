package jobs

import (
	"context"
	"errors"
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
