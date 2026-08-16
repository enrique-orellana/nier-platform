package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/mutonby/openshorts/backend-go/internal/domain"
)

type deferredClipResult struct {
	Clips      []map[string]any `json:"clips"`
	SourcePath string           `json:"source_path"`
}

func (s *Server) clipRenderRoute(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
		return
	}
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/jobs/"), "/"), "/")
	if len(parts) != 4 || parts[1] != "clips" || parts[3] != "render" || parts[0] == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Clip render route not found"})
		return
	}
	clipIndex, err := strconv.Atoi(parts[2])
	if err != nil || clipIndex < 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "clip index must be a non-negative integer"})
		return
	}
	parentID := parts[0]
	parent, ok := s.store.Get(r.Context(), parentID)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Parent job not found"})
		return
	}
	if parent.Kind != "clip-generation" || !isDeferredClipJob(parent) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Parent job is not a deferred clip-generation job"})
		return
	}
	if parent.Status != domain.JobStatusClipsReady && parent.Status != domain.JobStatusCompleted {
		writeJSON(w, http.StatusConflict, map[string]string{"detail": "Clip candidates are not ready"})
		return
	}

	var result deferredClipResult
	if len(parent.Result) == 0 || json.Unmarshal(parent.Result, &result) != nil || clipIndex >= len(result.Clips) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Clip candidate not found"})
		return
	}
	outputDir := parent.OutputDir
	if strings.TrimSpace(outputDir) == "" {
		root := s.config.OutputDir
		if root == "" {
			root = "output"
		}
		outputDir = filepath.Join(root, parent.ID)
	}
	sourceValue := strings.TrimSpace(result.SourcePath)
	if sourceValue == "" {
		if value, ok := parent.Metadata["source_path"].(string); ok {
			sourceValue = strings.TrimSpace(value)
		}
	}
	if sourceValue == "" {
		writeJSON(w, http.StatusConflict, map[string]string{"detail": "Deferred job has no persisted source path"})
		return
	}
	sourcePath := sourceValue
	if !filepath.IsAbs(sourcePath) {
		sourcePath = filepath.Join(outputDir, filepath.FromSlash(sourcePath))
	}
	if !safePath(outputDir, sourcePath) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid persisted source path"})
		return
	}

	metadata := make(map[string]any, len(parent.Metadata)+4)
	for key, value := range parent.Metadata {
		metadata[key] = value
	}
	metadata["source_path"] = sourcePath
	metadata["parent_job_id"] = parent.ID
	clip := result.Clips[clipIndex]
	if value, ok := clip["layout_format"].(string); ok && value != "" {
		metadata["layout_format"] = value
	}
	if value, ok := clip["facecam_size"].(string); ok && value != "" {
		metadata["facecam_size"] = value
	}
	child, err := s.store.CreateClipRenderIfAbsent(r.Context(), domain.CreateJobInput{
		Kind:        "clip-render",
		SourceURL:   parent.SourceURL,
		ClipCount:   parent.ClipCount,
		OutputDir:   outputDir,
		ParentJobID: parent.ID,
		ClipIndex:   clipIndex,
		Metadata:    metadata,
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": fmt.Sprintf("Failed to create clip render: %v", err)})
		return
	}
	if child.Status == domain.JobStatusQueued {
		if err := s.submitClipRenderJob(r.Context(), child.ID); err != nil {
			_, _ = s.store.Transition(context.Background(), child.ID, domain.JobStatusFailed, err.Error())
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"detail": "Clip render scheduler unavailable"})
			return
		}
	}
	writeJSON(w, http.StatusAccepted, map[string]any{
		"job_id":        child.ID,
		"parent_job_id": parent.ID,
		"clip_index":    clipIndex,
		"status":        string(child.Status),
	})
}

func (s *Server) submitClipRenderJob(ctx context.Context, jobID string) error {
	if s.scheduler != nil {
		return s.scheduler.Submit(ctx, jobID)
	}
	if s.runner != nil {
		go func() { _ = s.runner.RunOnce(context.Background(), jobID) }()
	}
	return nil
}

func isDeferredClipJob(job domain.Job) bool {
	deferred, ok := job.Metadata["defer_render"].(bool)
	return ok && deferred
}

func clipRenderStatus(status domain.JobStatus) string {
	switch status {
	case domain.JobStatusQueued:
		return "queued"
	case domain.JobStatusProcessing:
		return "rendering"
	case domain.JobStatusCompleted:
		return "ready"
	case domain.JobStatusFailed:
		return "failed"
	default:
		return string(status)
	}
}

func (s *Server) deferredClipRenders(ctx context.Context, parentID string) []map[string]any {
	jobs, err := s.store.ListByKind(ctx, "clip-render")
	if err != nil {
		return nil
	}
	states := make([]map[string]any, 0)
	for _, child := range jobs {
		if child.ParentJobID != parentID {
			continue
		}
		state := map[string]any{
			"job_id":     child.ID,
			"clip_index": child.ClipIndex,
			"status":     clipRenderStatus(child.Status),
		}
		if child.Error != "" {
			state["error"] = child.Error
		}
		states = append(states, state)
	}
	sort.Slice(states, func(i, j int) bool {
		return states[i]["clip_index"].(int) < states[j]["clip_index"].(int)
	})
	return states
}

func (s *Server) decorateDeferredClipResult(ctx context.Context, parent domain.Job) json.RawMessage {
	if len(parent.Result) == 0 || !isDeferredClipJob(parent) {
		return json.RawMessage(parent.Result)
	}
	var payload map[string]any
	if err := json.Unmarshal(parent.Result, &payload); err != nil {
		return json.RawMessage(parent.Result)
	}
	clips, ok := payload["clips"].([]any)
	if !ok {
		return json.RawMessage(parent.Result)
	}
	children, err := s.store.ListByKind(ctx, "clip-render")
	if err != nil {
		return json.RawMessage(parent.Result)
	}
	for _, child := range children {
		if child.ParentJobID != parent.ID || child.ClipIndex < 0 || child.ClipIndex >= len(clips) {
			continue
		}
		clip, ok := clips[child.ClipIndex].(map[string]any)
		if !ok {
			continue
		}
		if child.Status == domain.JobStatusCompleted && len(child.Result) > 0 {
			var childResult struct {
				Clips []map[string]any `json:"clips"`
			}
			if json.Unmarshal(child.Result, &childResult) == nil && child.ClipIndex < len(childResult.Clips) {
				for key, value := range childResult.Clips[child.ClipIndex] {
					clip[key] = value
				}
			}
		}
		clip["render_job_id"] = child.ID
		clip["render_status"] = clipRenderStatus(child.Status)
		if child.Error != "" {
			clip["render_error"] = child.Error
		}
	}
	payload["clips"] = clips
	encoded, err := json.Marshal(payload)
	if err != nil {
		return json.RawMessage(parent.Result)
	}
	return encoded
}
