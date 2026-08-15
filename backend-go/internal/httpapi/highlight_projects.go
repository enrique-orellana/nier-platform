package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/mutonby/openshorts/backend-go/internal/domain"
	"github.com/mutonby/openshorts/backend-go/internal/jobs"
)

type highlightProjectCreateRequest struct {
	Name         string         `json:"name"`
	SourceObject map[string]any `json:"source_object"`
	Acknowledged bool           `json:"acknowledged"`
	MinMinutes   float64        `json:"min_minutes"`
	IdealMinutes float64        `json:"ideal_minutes"`
}

type highlightProjectUpdateRequest struct {
	Name         string  `json:"name"`
	MinMinutes   float64 `json:"min_minutes"`
	IdealMinutes float64 `json:"ideal_minutes"`
}

func (s *Server) highlightProjects(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/highlights/projects")
	if path == "" || path == "/" {
		s.highlightProjectCollection(w, r)
		return
	}
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) == 1 && parts[0] != "" {
		s.highlightProjectItem(w, r, parts[0])
		return
	}
	if len(parts) == 2 && parts[0] != "" && parts[1] != "" {
		s.highlightProjectAction(w, r, parts[0], parts[1])
		return
	}
	writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Highlight project not found"})
}

func (s *Server) highlightProjectCollection(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		projects, err := s.store.ListHighlightProjects(r.Context())
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": err.Error()})
			return
		}
		items := make([]map[string]any, 0, len(projects))
		for _, project := range projects {
			item, err := s.highlightProjectPayload(r.Context(), project)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": err.Error()})
				return
			}
			items = append(items, item)
		}
		writeJSON(w, http.StatusOK, map[string]any{"projects": items})
	case http.MethodPost:
		s.createHighlightProject(w, r)
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
	}
}

func (s *Server) highlightProjectItem(w http.ResponseWriter, r *http.Request, id string) {
	project, job, err := s.store.GetHighlightProject(r.Context(), id)
	if errors.Is(err, jobs.ErrProjectNotFound) || errors.Is(err, jobs.ErrJobNotFound) {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Highlight project not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": err.Error()})
		return
	}
	switch r.Method {
	case http.MethodGet:
		payload, err := s.highlightProjectPayloadWithJob(project, job)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, payload)
	case http.MethodPatch:
		var request highlightProjectUpdateRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid JSON request body"})
			return
		}
		minSeconds, idealSeconds, err := highlightDurations(request.MinMinutes, request.IdealMinutes)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"detail": err.Error()})
			return
		}
		updated, err := s.store.UpdateHighlightProject(r.Context(), id, domain.UpdateHighlightProjectInput{Name: strings.TrimSpace(request.Name), MinDurationSeconds: minSeconds, IdealDurationSeconds: idealSeconds})
		if errors.Is(err, jobs.ErrProjectActive) {
			writeJSON(w, http.StatusConflict, map[string]string{"detail": err.Error()})
			return
		}
		if errors.Is(err, jobs.ErrProjectNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Highlight project not found"})
			return
		}
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"detail": err.Error()})
			return
		}
		payload, err := s.highlightProjectPayload(r.Context(), updated)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, payload)
	case http.MethodDelete:
		s.deleteHighlightProject(w, r, project, job)
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
	}
}

func (s *Server) highlightProjectAction(w http.ResponseWriter, r *http.Request, id, action string) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
		return
	}
	project, job, err := s.store.GetHighlightProject(r.Context(), id)
	if errors.Is(err, jobs.ErrProjectNotFound) || errors.Is(err, jobs.ErrJobNotFound) {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Highlight project not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": err.Error()})
		return
	}
	switch action {
	case "retry":
		newJob, err := s.store.RetryHighlightProject(r.Context(), id)
		if errors.Is(err, jobs.ErrActiveJob) || errors.Is(err, jobs.ErrProjectActive) {
			writeJSON(w, http.StatusConflict, map[string]string{"detail": err.Error()})
			return
		}
		if errors.Is(err, jobs.ErrProjectNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Highlight project not found"})
			return
		}
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Failed to retry highlight project"})
			return
		}
		if err := s.queueHighlightProjectJob(r, newJob); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"detail": err.Error()})
			return
		}
		project, job, err = s.store.GetHighlightProject(r.Context(), id)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": err.Error()})
			return
		}
		payload, _ := s.highlightProjectPayloadWithJob(project, job)
		writeJSON(w, http.StatusAccepted, payload)
	case "cancel":
		if !highlightJobActive(job.Status) {
			writeJSON(w, http.StatusConflict, map[string]string{"detail": "Highlight project is not running"})
			return
		}
		cancelled, err := s.cancelHighlightJob(r.Context(), job)
		if err != nil {
			writeJSON(w, http.StatusConflict, map[string]string{"detail": err.Error()})
			return
		}
		project, _, err = s.store.GetHighlightProject(r.Context(), id)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": err.Error()})
			return
		}
		payload, _ := s.highlightProjectPayloadWithJob(project, cancelled)
		writeJSON(w, http.StatusAccepted, payload)
	default:
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Highlight action not found"})
	}
}

func (s *Server) createHighlightProject(w http.ResponseWriter, r *http.Request) {
	var request highlightProjectCreateRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid JSON request body"})
		return
	}
	if !request.Acknowledged {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "You must confirm you own the content or have rights to process it."})
		return
	}
	bucket := strings.TrimSpace(fmt.Sprint(request.SourceObject["bucket"]))
	key := strings.TrimSpace(fmt.Sprint(request.SourceObject["key"]))
	if bucket == "" || key == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "MinIO source object requires bucket and key"})
		return
	}
	minSeconds, idealSeconds, err := highlightDurations(request.MinMinutes, request.IdealMinutes)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": err.Error()})
		return
	}
	name := strings.TrimSpace(request.Name)
	if name == "" {
		name = filepath.Base(key)
	}
	project, job, err := s.store.CreateHighlightProject(r.Context(), domain.CreateHighlightProjectInput{
		Name: name, SourceBucket: bucket, SourceKey: key,
		MinDurationSeconds: minSeconds, IdealDurationSeconds: idealSeconds,
	})
	if errors.Is(err, jobs.ErrActiveJob) {
		writeJSON(w, http.StatusConflict, map[string]string{"detail": "Only one highlight job can run at a time"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Failed to create highlight project"})
		return
	}
	if err := s.queueHighlightProjectJob(r, job); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"detail": err.Error()})
		return
	}
	project, job, err = s.store.GetHighlightProject(r.Context(), project.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": err.Error()})
		return
	}
	payload, _ := s.highlightProjectPayloadWithJob(project, job)
	writeJSON(w, http.StatusAccepted, payload)
}

func (s *Server) queueHighlightProjectJob(r *http.Request, job domain.Job) error {
	outputRoot := s.config.OutputDir
	if strings.TrimSpace(outputRoot) == "" {
		outputRoot = "output"
	}
	outputDir := filepath.Join(outputRoot, job.ID)
	if err := s.store.SetOutputDir(r.Context(), job.ID, outputDir); err != nil {
		return fmt.Errorf("failed to initialize highlight output: %w", err)
	}
	if err := s.store.AppendLog(r.Context(), job.ID, fmt.Sprintf("Highlight project job %s queued.", job.ID)); err != nil {
		return fmt.Errorf("failed to initialize highlight job: %w", err)
	}
	s.setHighlightRuntimeMetadata(job.ID, map[string]any{"headers": translationHeaders(r)})
	if s.scheduler != nil {
		if err := s.scheduler.Submit(r.Context(), job.ID); err != nil {
			s.releaseHighlightRuntimeMetadata(job.ID)
			_, _ = s.store.Transition(r.Context(), job.ID, domain.JobStatusFailed, err.Error())
			return fmt.Errorf("job scheduler unavailable: %w", err)
		}
		return nil
	}
	if s.runner != nil {
		go func() { _ = s.runner.RunOnce(context.Background(), job.ID) }()
		return nil
	}
	s.releaseHighlightRuntimeMetadata(job.ID)
	return errors.New("job runner is not configured")
}

func (s *Server) cancelHighlightJob(ctx context.Context, job domain.Job) (domain.Job, error) {
	if s.scheduler == nil {
		if job.Status == domain.JobStatusQueued {
			cancelled, err := s.store.Transition(ctx, job.ID, domain.JobStatusCancelled, "Cancelled by user.")
			if err == nil {
				s.releaseHighlightRuntimeMetadata(job.ID)
			}
			return cancelled, err
		}
		return domain.Job{}, errors.New("job scheduler is not configured")
	}
	cancelled, err := s.scheduler.Cancel(ctx, job.ID)
	if err == nil && cancelled.Status == domain.JobStatusCancelled {
		s.releaseHighlightRuntimeMetadata(job.ID)
	}
	return cancelled, err
}

func (s *Server) deleteHighlightProject(w http.ResponseWriter, r *http.Request, project domain.HighlightProject, job domain.Job) {
	if highlightJobActive(job.Status) {
		cancelled, err := s.cancelHighlightJob(r.Context(), job)
		if err != nil {
			writeJSON(w, http.StatusConflict, map[string]string{"detail": err.Error()})
			return
		}
		if highlightJobActive(cancelled.Status) {
			writeJSON(w, http.StatusConflict, map[string]string{"detail": "Cancellation requested; retry deletion after the job stops"})
			return
		}
	}
	if err := validateHighlightOutputPath(s.config.OutputDir, job.OutputDir); err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"detail": err.Error()})
		return
	}
	if err := s.store.DeleteHighlightProject(r.Context(), project.ID); err != nil {
		if errors.Is(err, jobs.ErrProjectNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Highlight project not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": err.Error()})
		return
	}
	if job.OutputDir != "" {
		if err := os.RemoveAll(job.OutputDir); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Project deleted but generated output cleanup failed"})
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) highlightProjectPayload(ctx context.Context, project domain.HighlightProject) (map[string]any, error) {
	if project.LatestJobID == "" {
		return map[string]any{"id": project.ID, "name": project.Name}, nil
	}
	job, ok := s.store.Get(ctx, project.LatestJobID)
	if !ok {
		return nil, jobs.ErrJobNotFound
	}
	return s.highlightProjectPayloadWithJob(project, job)
}

func (s *Server) highlightProjectPayloadWithJob(project domain.HighlightProject, job domain.Job) (map[string]any, error) {
	return map[string]any{
		"id":            project.ID,
		"name":          project.Name,
		"source_object": map[string]string{"bucket": project.SourceBucket, "key": project.SourceKey},
		"min_minutes":   float64(project.MinDurationSeconds) / 60,
		"ideal_minutes": float64(project.IdealDurationSeconds) / 60,
		"latest_job_id": project.LatestJobID,
		"status":        string(job.Status),
		"job":           highlightJobPayload(job),
		"created_at":    project.CreatedAt,
		"updated_at":    project.UpdatedAt,
	}, nil
}

func highlightDurations(minMinutes, idealMinutes float64) (int, int, error) {
	if minMinutes == 0 {
		minMinutes = 12
	}
	if idealMinutes == 0 {
		idealMinutes = 20
	}
	if minMinutes <= 0 || minMinutes > 180 || idealMinutes < minMinutes || idealMinutes > 180 || math.IsNaN(minMinutes) || math.IsNaN(idealMinutes) {
		return 0, 0, errors.New("durations must be positive, ideal must be at least minimum, and both must be at most 180 minutes")
	}
	return int(math.Round(minMinutes * 60)), int(math.Round(idealMinutes * 60)), nil
}

func highlightJobActive(status domain.JobStatus) bool {
	return status == domain.JobStatusQueued || status == domain.JobStatusProcessing
}

func validateHighlightOutputPath(root, output string) error {
	if strings.TrimSpace(output) == "" {
		return nil
	}
	if strings.TrimSpace(root) == "" {
		root = "output"
	}
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	outputAbs, err := filepath.Abs(output)
	if err != nil {
		return err
	}
	rel, err := filepath.Rel(rootAbs, outputAbs)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return errors.New("generated output is outside the configured output directory")
	}
	return nil
}
