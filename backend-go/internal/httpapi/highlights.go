package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/mutonby/openshorts/backend-go/internal/domain"
	"github.com/mutonby/openshorts/backend-go/internal/jobs"
)

const highlightJobKind = "highlight-generation"

type highlightCreateRequest struct {
	SourceObject map[string]any `json:"source_object"`
	Acknowledged bool           `json:"acknowledged"`
	MinMinutes   float64        `json:"min_minutes"`
	IdealMinutes float64        `json:"ideal_minutes"`
}

func (s *Server) highlights(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.listHighlights(w, r)
	case http.MethodPost:
		s.createHighlight(w, r)
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
	}
}

func (s *Server) highlightRoute(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/highlights/")
	if id == "" || strings.Contains(id, "/") {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Highlight job not found"})
		return
	}
	if r.Method != http.MethodDelete {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
		return
	}
	job, ok := s.store.Get(r.Context(), id)
	if !ok || job.Kind != highlightJobKind {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Highlight job not found"})
		return
	}
	if job.Status == domain.JobStatusCompleted || job.Status == domain.JobStatusFailed || job.Status == domain.JobStatusCancelled {
		writeJSON(w, http.StatusConflict, map[string]string{"detail": "Highlight job is no longer running"})
		return
	}
	if s.scheduler == nil {
		if job.Status == domain.JobStatusQueued {
			job, _ = s.store.Transition(r.Context(), id, domain.JobStatusCancelled, "Cancelled by user.")
		} else {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"detail": "Job scheduler is not configured"})
			return
		}
	} else if cancelled, err := s.scheduler.Cancel(r.Context(), id); err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"detail": err.Error()})
		return
	} else {
		job = cancelled
	}
	s.releaseHighlightRuntimeMetadata(id)
	writeJSON(w, http.StatusAccepted, highlightJobPayload(job))
}

func (s *Server) listHighlights(w http.ResponseWriter, r *http.Request) {
	jobs, err := s.store.ListByKind(r.Context(), highlightJobKind)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": err.Error()})
		return
	}
	items := make([]map[string]any, 0, len(jobs))
	for _, job := range jobs {
		items = append(items, highlightJobPayload(job))
	}
	writeJSON(w, http.StatusOK, map[string]any{"jobs": items})
}

func (s *Server) createHighlight(w http.ResponseWriter, r *http.Request) {
	var payload highlightCreateRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid JSON request body"})
		return
	}
	if !payload.Acknowledged {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "You must confirm you own the content or have rights to process it."})
		return
	}
	bucket := strings.TrimSpace(fmt.Sprint(payload.SourceObject["bucket"]))
	key := strings.TrimSpace(fmt.Sprint(payload.SourceObject["key"]))
	if bucket == "" || key == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "MinIO source object requires bucket and key"})
		return
	}
	if payload.MinMinutes == 0 {
		payload.MinMinutes = 12
	}
	if payload.IdealMinutes == 0 {
		payload.IdealMinutes = 20
	}
	if payload.MinMinutes <= 0 || payload.MinMinutes > 180 || payload.IdealMinutes < payload.MinMinutes || payload.IdealMinutes > 180 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Durations must be positive, ideal must be at least minimum, and both must be at most 180 minutes"})
		return
	}
	job, err := s.store.CreateIfNoActive(r.Context(), highlightJobKind, domain.CreateJobInput{
		Kind:     highlightJobKind,
		Metadata: map[string]any{"source_object": map[string]any{"bucket": bucket, "key": key}, "min_minutes": payload.MinMinutes, "ideal_minutes": payload.IdealMinutes},
	})
	if err != nil {
		if errors.Is(err, jobs.ErrActiveJob) {
			writeJSON(w, http.StatusConflict, map[string]string{"detail": "Only one highlight job can run at a time"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Failed to create highlight job"})
		return
	}
	s.setHighlightRuntimeMetadata(job.ID, map[string]any{"headers": translationHeaders(r)})
	outputRoot := s.config.OutputDir
	if strings.TrimSpace(outputRoot) == "" {
		outputRoot = "output"
	}
	if err := s.store.SetOutputDir(r.Context(), job.ID, filepath.Join(outputRoot, job.ID)); err != nil {
		s.releaseHighlightRuntimeMetadata(job.ID)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Failed to initialize highlight output"})
		return
	}
	job.OutputDir = filepath.Join(outputRoot, job.ID)
	if err := s.store.AppendLog(r.Context(), job.ID, fmt.Sprintf("Highlight job %s queued.", job.ID)); err != nil {
		s.releaseHighlightRuntimeMetadata(job.ID)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Failed to initialize highlight job"})
		return
	}
	if s.scheduler != nil {
		if err := s.scheduler.Submit(r.Context(), job.ID); err != nil {
			s.releaseHighlightRuntimeMetadata(job.ID)
			_, _ = s.store.Transition(r.Context(), job.ID, domain.JobStatusFailed, err.Error())
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"detail": "Job scheduler unavailable"})
			return
		}
	} else if s.runner != nil {
		go func() { _ = s.runner.RunOnce(context.Background(), job.ID) }()
	} else {
		s.releaseHighlightRuntimeMetadata(job.ID)
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"detail": "Job runner is not configured"})
		return
	}
	writeJSON(w, http.StatusAccepted, highlightJobPayload(job))
}

func highlightJobPayload(job domain.Job) map[string]any {
	logs := make([]string, 0, len(job.Logs))
	for _, entry := range job.Logs {
		logs = append(logs, entry.Message)
	}
	var result any
	if len(job.Result) > 0 {
		_ = json.Unmarshal(job.Result, &result)
	}
	return map[string]any{
		"id": job.ID, "status": string(job.Status), "logs": logs, "result": result,
		"error": job.Error, "created_at": job.CreatedAt, "updated_at": job.UpdatedAt,
	}
}

func (s *Server) setHighlightRuntimeMetadata(jobID string, metadata map[string]any) {
	s.highlightMu.Lock()
	defer s.highlightMu.Unlock()
	s.highlightRuntime[jobID] = cloneHighlightRuntimeMetadata(metadata)
}

func (s *Server) highlightRuntimeMetadata(jobID string) map[string]any {
	s.highlightMu.Lock()
	defer s.highlightMu.Unlock()
	return cloneHighlightRuntimeMetadata(s.highlightRuntime[jobID])
}

func (s *Server) releaseHighlightRuntimeMetadata(jobID string) {
	s.highlightMu.Lock()
	delete(s.highlightRuntime, jobID)
	s.highlightMu.Unlock()
}

func cloneHighlightRuntimeMetadata(metadata map[string]any) map[string]any {
	if metadata == nil {
		return nil
	}
	clone := make(map[string]any, len(metadata))
	for key, value := range metadata {
		if headers, ok := value.(map[string]string); ok {
			copyHeaders := make(map[string]string, len(headers))
			for header, headerValue := range headers {
				copyHeaders[header] = headerValue
			}
			clone[key] = copyHeaders
			continue
		}
		clone[key] = value
	}
	return clone
}
