package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"os"
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

type webcamRegionInput struct {
	X      *float64 `json:"x"`
	Y      *float64 `json:"y"`
	Width  *float64 `json:"width"`
	Height *float64 `json:"height"`
}

type webcamRegion struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

func normalizeWebcamRegion(input *webcamRegionInput) (webcamRegion, error) {
	if input == nil || input.X == nil || input.Y == nil || input.Width == nil || input.Height == nil {
		return webcamRegion{}, fmt.Errorf("webcam_region must contain x, y, width, and height")
	}
	region := webcamRegion{X: *input.X, Y: *input.Y, Width: *input.Width, Height: *input.Height}
	values := []float64{region.X, region.Y, region.Width, region.Height}
	for _, value := range values {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return webcamRegion{}, fmt.Errorf("webcam_region values must be finite")
		}
	}
	if region.X < 0 || region.Y < 0 || region.X > 1 || region.Y > 1 {
		return webcamRegion{}, fmt.Errorf("webcam_region x and y must be between 0 and 1")
	}
	if region.Width <= 0 || region.Height <= 0 {
		return webcamRegion{}, fmt.Errorf("webcam_region width and height must be positive")
	}
	if region.Width > 1 || region.Height > 1 || region.X+region.Width > 1 || region.Y+region.Height > 1 {
		return webcamRegion{}, fmt.Errorf("webcam_region must fit inside the source frame")
	}
	return region, nil
}

func parseStoredWebcamRegion(value any) (webcamRegion, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return webcamRegion{}, fmt.Errorf("invalid webcam_region: %w", err)
	}
	var input webcamRegionInput
	if err := json.Unmarshal(encoded, &input); err != nil {
		return webcamRegion{}, fmt.Errorf("invalid webcam_region: %w", err)
	}
	return normalizeWebcamRegion(&input)
}

func (region webcamRegion) asMap() map[string]any {
	return map[string]any{
		"x":      region.X,
		"y":      region.Y,
		"width":  region.Width,
		"height": region.Height,
	}
}

func writeJSONFileAtomic(path string, contents []byte) error {
	temporary, err := os.CreateTemp(filepath.Dir(path), ".webcam-region-*.tmp")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if _, err := temporary.Write(contents); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, path)
}

func (s *Server) clipRenderRoute(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/jobs/"), "/"), "/")
	if len(parts) != 4 || parts[1] != "clips" || (parts[3] != "render" && parts[3] != "webcam-region") || parts[0] == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Clip render route not found"})
		return
	}
	clipIndex, err := strconv.Atoi(parts[2])
	if err != nil || clipIndex < 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "clip index must be a non-negative integer"})
		return
	}
	parentID := parts[0]
	if parts[3] == "webcam-region" {
		if r.Method != http.MethodPatch {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
			return
		}
		s.updateWebcamRegion(w, r, parentID, clipIndex)
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
		return
	}
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
	layoutFormat, _ := metadata["layout_format"].(string)
	if value, ok := clip["layout_format"].(string); ok && value != "" {
		layoutFormat = value
	}
	if value, exists := clip["webcam_region"]; exists && value != nil {
		region, regionErr := parseStoredWebcamRegion(value)
		if regionErr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"detail": regionErr.Error()})
			return
		}
		metadata["webcam_region"] = region.asMap()
	} else if strings.EqualFold(strings.TrimSpace(layoutFormat), "streamer_stack") {
		writeJSON(w, http.StatusConflict, map[string]string{"detail": "Select and save a webcam area before rendering this Streamer Stack clip"})
		return
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

func (s *Server) updateWebcamRegion(w http.ResponseWriter, r *http.Request, parentID string, clipIndex int) {
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

	var request struct {
		WebcamRegion *webcamRegionInput `json:"webcam_region"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid JSON request body"})
		return
	}
	region, err := normalizeWebcamRegion(request.WebcamRegion)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": err.Error()})
		return
	}

	var result deferredClipResult
	if len(parent.Result) == 0 || json.Unmarshal(parent.Result, &result) != nil || clipIndex < 0 || clipIndex >= len(result.Clips) {
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
	metadataPath, err := firstMetadataPath(outputDir)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"detail": "Deferred job metadata is not available"})
		return
	}
	metadataContents, err := os.ReadFile(metadataPath)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Could not read deferred job metadata"})
		return
	}
	metadata := map[string]any{}
	if err := json.Unmarshal(metadataContents, &metadata); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Deferred job metadata is invalid"})
		return
	}
	shorts, ok := metadata["shorts"].([]any)
	if !ok || clipIndex >= len(shorts) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Deferred job metadata has no matching clip"})
		return
	}
	metadataClip, ok := shorts[clipIndex].(map[string]any)
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Deferred job metadata clip is invalid"})
		return
	}
	regionMap := region.asMap()
	metadataClip["webcam_region"] = regionMap
	updatedMetadata, err := json.MarshalIndent(metadata, "", "  ")
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Could not encode deferred job metadata"})
		return
	}
	if err := writeJSONFileAtomic(metadataPath, updatedMetadata); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Could not persist webcam region"})
		return
	}
	result.Clips[clipIndex]["webcam_region"] = regionMap
	updatedResult, err := json.Marshal(result)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Could not encode clip result"})
		return
	}
	if err := s.store.SetResult(r.Context(), parent.ID, updatedResult); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Could not persist clip result"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"clip_index":    clipIndex,
		"webcam_region": regionMap,
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
