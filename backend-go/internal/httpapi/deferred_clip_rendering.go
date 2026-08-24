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
	"github.com/mutonby/openshorts/backend-go/internal/media"
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

type clipSourceRangeInput struct {
	Start *float64 `json:"start"`
	End   *float64 `json:"end"`
}

type webcamRegion struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

const (
	gameplayZoomMin    = 0.6
	gameplayZoomMax    = 2.0
	defaultFacecamSize = "medium"
)

func normalizeFacecamSize(value string) (string, error) {
	value = strings.ToLower(strings.TrimSpace(value))
	switch value {
	case "small", "medium", "large":
		return value, nil
	default:
		return "", fmt.Errorf("invalid facecam_size: %s", value)
	}
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

func normalizeGameplayRegion(input *webcamRegionInput) (webcamRegion, error) {
	if input == nil || input.X == nil || input.Y == nil || input.Width == nil || input.Height == nil {
		return webcamRegion{}, fmt.Errorf("gameplay_region must contain x, y, width, and height")
	}
	region := webcamRegion{X: *input.X, Y: *input.Y, Width: *input.Width, Height: *input.Height}
	values := []float64{region.X, region.Y, region.Width, region.Height}
	for _, value := range values {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return webcamRegion{}, fmt.Errorf("gameplay_region values must be finite")
		}
	}
	if region.X < 0 || region.Y < 0 || region.X > 1 || region.Y > 1 {
		return webcamRegion{}, fmt.Errorf("gameplay_region x and y must be between 0 and 1")
	}
	if region.Width <= 0 || region.Height <= 0 {
		return webcamRegion{}, fmt.Errorf("gameplay_region width and height must be positive")
	}
	if region.Width > 1 || region.Height > 1 || region.X+region.Width > 1 || region.Y+region.Height > 1 {
		return webcamRegion{}, fmt.Errorf("gameplay_region must fit inside the source frame")
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

func parseStoredGameplayRegion(value any) (webcamRegion, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return webcamRegion{}, fmt.Errorf("invalid gameplay_region: %w", err)
	}
	var input webcamRegionInput
	if err := json.Unmarshal(encoded, &input); err != nil {
		return webcamRegion{}, fmt.Errorf("invalid gameplay_region: %w", err)
	}
	return normalizeGameplayRegion(&input)
}

func normalizeGameplayZoom(value *float64) (float64, error) {
	if value == nil || math.IsNaN(*value) || math.IsInf(*value, 0) {
		return 0, fmt.Errorf("gameplay_zoom must be a finite number")
	}
	if *value < gameplayZoomMin || *value > gameplayZoomMax {
		return 0, fmt.Errorf("gameplay_zoom must be between %.1f and %.1f", gameplayZoomMin, gameplayZoomMax)
	}
	return *value, nil
}

func parseStoredGameplayZoom(value any) (float64, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return 0, fmt.Errorf("invalid gameplay_zoom: %w", err)
	}
	var zoom float64
	if err := json.Unmarshal(encoded, &zoom); err != nil {
		return 0, fmt.Errorf("invalid gameplay_zoom: %w", err)
	}
	return normalizeGameplayZoom(&zoom)
}

func normalizeClipSourceRange(input *clipSourceRangeInput, masterDuration float64) (float64, float64, error) {
	if input == nil || input.Start == nil || input.End == nil {
		return 0, 0, fmt.Errorf("clip range must contain start and end")
	}
	start, end := *input.Start, *input.End
	if math.IsNaN(start) || math.IsInf(start, 0) || math.IsNaN(end) || math.IsInf(end, 0) {
		return 0, 0, fmt.Errorf("clip range values must be finite")
	}
	if start < 0 || end <= start || end-start < 1 {
		return 0, 0, fmt.Errorf("clip range must be at least one second and start at zero or later")
	}
	if masterDuration > 0 && end > masterDuration {
		return 0, 0, fmt.Errorf("clip range must fit inside the master video")
	}
	return start, end, nil
}

func sourceDurationFromMetadata(metadata map[string]any) float64 {
	if value, ok := metadata["source_duration_seconds"].(float64); ok && value > 0 {
		return value
	}
	asset, _ := metadata["source_asset"].(map[string]any)
	probe, _ := asset["probe"].(map[string]any)
	if value, ok := probe["duration_seconds"].(float64); ok && value > 0 {
		return value
	}
	return 0
}

func isGeneratedSubtitleTrack(track map[string]any) bool {
	id, _ := track["id"].(string)
	origin, _ := track["origin"].(string)
	return strings.EqualFold(strings.TrimSpace(id), "original") || strings.EqualFold(strings.TrimSpace(origin), "generated")
}

func refreshGeneratedClipSubtitles(clip map[string]any, transcript map[string]any, start, end float64) bool {
	if len(transcript) == 0 {
		return false
	}
	captions := media.BuildSubtitleCues(transcript, start, end)
	updated := false
	if tracks, ok := clip["subtitle_tracks"].([]any); ok {
		for _, rawTrack := range tracks {
			track, ok := rawTrack.(map[string]any)
			if !ok || !isGeneratedSubtitleTrack(track) {
				continue
			}
			track["cues"] = captions
			track["captions"] = captions
			updated = true
		}
	}
	if track, ok := clip["subtitles"].(map[string]any); ok && isGeneratedSubtitleTrack(track) {
		track["cues"] = captions
		track["captions"] = captions
		updated = true
	}
	if updated {
		if layers, ok := clip["layers"].(map[string]any); ok {
			if subtitleLayer, ok := layers["subtitles"].(map[string]any); ok {
				subtitleLayer["cues"] = captions
				subtitleLayer["captions"] = captions
			}
		}
	}
	return updated
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

func (s *Server) deferredMetadataPath(ctx context.Context, outputDir, jobID string) (string, error) {
	metadataPath, err := firstMetadataPath(outputDir)
	if err == nil {
		return metadataPath, nil
	}
	if s.s3Store == nil || s.s3Store.Client == nil || s.s3Store.Bucket == "" {
		return "", err
	}
	contents, err := s.s3Store.ReadObject(ctx, jobID+"/master/source_metadata.json")
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		return "", err
	}
	metadataPath = filepath.Join(outputDir, "source_metadata.json")
	if err := os.WriteFile(metadataPath, contents, 0o644); err != nil {
		return "", err
	}
	return metadataPath, nil
}

func (s *Server) persistDeferredMetadata(ctx context.Context, jobID string, contents []byte) error {
	if s.s3Store == nil || s.s3Store.Client == nil || s.s3Store.Bucket == "" {
		return nil
	}
	return s.s3Store.WriteObject(ctx, jobID+"/master/source_metadata.json", contents, "application/json")
}

func (s *Server) clipRenderRoute(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/jobs/"), "/"), "/")
	if len(parts) != 4 || parts[1] != "clips" || (parts[3] != "render" && parts[3] != "source-range" && parts[3] != "webcam-region" && parts[3] != "gameplay-region" && parts[3] != "gameplay-zoom" && parts[3] != "streamer-tracking") || parts[0] == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Clip render route not found"})
		return
	}
	clipIndex, err := strconv.Atoi(parts[2])
	if err != nil || clipIndex < 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "clip index must be a non-negative integer"})
		return
	}
	parentID := parts[0]
	if parts[3] == "source-range" {
		if r.Method != http.MethodPatch {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
			return
		}
		s.updateClipSourceRange(w, r, parentID, clipIndex)
		return
	}
	if parts[3] == "webcam-region" {
		if r.Method != http.MethodPatch {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
			return
		}
		s.updateWebcamRegion(w, r, parentID, clipIndex)
		return
	}
	if parts[3] == "gameplay-region" {
		if r.Method != http.MethodPatch {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
			return
		}
		s.updateGameplayRegion(w, r, parentID, clipIndex)
		return
	}
	if parts[3] == "streamer-tracking" {
		if r.Method != http.MethodPatch {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
			return
		}
		s.updateStreamerTracking(w, r, parentID, clipIndex)
		return
	}
	if parts[3] == "gameplay-zoom" {
		if r.Method != http.MethodPatch {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
			return
		}
		s.updateGameplayZoom(w, r, parentID, clipIndex)
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
	if value, exists := clip["gameplay_region"]; exists && value != nil {
		region, regionErr := parseStoredGameplayRegion(value)
		if regionErr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"detail": regionErr.Error()})
			return
		}
		metadata["gameplay_region"] = region.asMap()
	} else if strings.EqualFold(strings.TrimSpace(layoutFormat), "streamer_stack") {
		writeJSON(w, http.StatusConflict, map[string]string{"detail": "Select and save a gameplay area before rendering this Streamer Stack clip"})
		return
	}
	trackingEnabled, ok := clip["streamer_tracking_enabled"].(bool)
	if !ok {
		trackingEnabled = false
	}
	metadata["streamer_tracking_enabled"] = trackingEnabled
	gameplayZoom := 1.0
	if value, exists := clip["gameplay_zoom"]; exists && value != nil {
		parsedZoom, zoomErr := parseStoredGameplayZoom(value)
		if zoomErr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"detail": zoomErr.Error()})
			return
		}
		gameplayZoom = parsedZoom
	}
	metadata["gameplay_zoom"] = gameplayZoom
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

func (s *Server) updateClipSourceRange(w http.ResponseWriter, r *http.Request, parentID string, clipIndex int) {
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

	var request clipSourceRangeInput
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid JSON request body"})
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
	metadataPath, err := s.deferredMetadataPath(r.Context(), outputDir, parentID)
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
	start, end, err := normalizeClipSourceRange(&request, sourceDurationFromMetadata(metadata))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": err.Error()})
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
	metadataClip["start"] = start
	metadataClip["end"] = end
	transcript, _ := metadata["transcript"].(map[string]any)
	refreshGeneratedClipSubtitles(metadataClip, transcript, start, end)
	updatedMetadata, err := json.MarshalIndent(metadata, "", "  ")
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Could not encode deferred job metadata"})
		return
	}
	if err := writeJSONFileAtomic(metadataPath, updatedMetadata); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Could not persist clip range"})
		return
	}
	if err := s.persistDeferredMetadata(r.Context(), parentID, updatedMetadata); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": "Could not persist clip range metadata"})
		return
	}

	var result deferredClipResult
	if len(parent.Result) == 0 || json.Unmarshal(parent.Result, &result) != nil || clipIndex < 0 || clipIndex >= len(result.Clips) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Clip candidate not found"})
		return
	}
	result.Clips[clipIndex]["start"] = start
	result.Clips[clipIndex]["end"] = end
	refreshGeneratedClipSubtitles(result.Clips[clipIndex], transcript, start, end)
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
		"clip_index":      clipIndex,
		"start":           start,
		"end":             end,
		"subtitles":       result.Clips[clipIndex]["subtitles"],
		"subtitle_tracks": result.Clips[clipIndex]["subtitle_tracks"],
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
		FacecamSize  *string            `json:"facecam_size"`
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
	facecamSize := defaultFacecamSize
	if existingSize, ok := result.Clips[clipIndex]["facecam_size"].(string); ok {
		if normalizedExistingSize, normalizeErr := normalizeFacecamSize(existingSize); normalizeErr == nil {
			facecamSize = normalizedExistingSize
		}
	}
	if request.FacecamSize != nil {
		normalizedFacecamSize, normalizeErr := normalizeFacecamSize(*request.FacecamSize)
		if normalizeErr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"detail": normalizeErr.Error()})
			return
		}
		facecamSize = normalizedFacecamSize
	}
	outputDir := parent.OutputDir
	if strings.TrimSpace(outputDir) == "" {
		root := s.config.OutputDir
		if root == "" {
			root = "output"
		}
		outputDir = filepath.Join(root, parent.ID)
	}
	metadataPath, err := s.deferredMetadataPath(r.Context(), outputDir, parentID)
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
	metadataClip["facecam_size"] = facecamSize
	updatedMetadata, err := json.MarshalIndent(metadata, "", "  ")
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Could not encode deferred job metadata"})
		return
	}
	if err := writeJSONFileAtomic(metadataPath, updatedMetadata); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Could not persist webcam region"})
		return
	}
	if err := s.persistDeferredMetadata(r.Context(), parentID, updatedMetadata); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": "Could not persist webcam region metadata"})
		return
	}
	result.Clips[clipIndex]["webcam_region"] = regionMap
	result.Clips[clipIndex]["facecam_size"] = facecamSize
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
		"facecam_size":  facecamSize,
	})
}

func (s *Server) updateGameplayRegion(w http.ResponseWriter, r *http.Request, parentID string, clipIndex int) {
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
		GameplayRegion *webcamRegionInput `json:"gameplay_region"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid JSON request body"})
		return
	}
	region, err := normalizeGameplayRegion(request.GameplayRegion)
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
	metadataPath, err := s.deferredMetadataPath(r.Context(), outputDir, parentID)
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
	metadataClip["gameplay_region"] = regionMap
	updatedMetadata, err := json.MarshalIndent(metadata, "", "  ")
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Could not encode deferred job metadata"})
		return
	}
	if err := writeJSONFileAtomic(metadataPath, updatedMetadata); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Could not persist gameplay region"})
		return
	}
	if err := s.persistDeferredMetadata(r.Context(), parentID, updatedMetadata); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": "Could not persist gameplay region metadata"})
		return
	}
	result.Clips[clipIndex]["gameplay_region"] = regionMap
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
		"clip_index":      clipIndex,
		"gameplay_region": regionMap,
	})
}

func (s *Server) updateGameplayZoom(w http.ResponseWriter, r *http.Request, parentID string, clipIndex int) {
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
		GameplayZoom *float64 `json:"gameplay_zoom"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid JSON request body"})
		return
	}
	gameplayZoom, err := normalizeGameplayZoom(request.GameplayZoom)
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
	metadataPath, err := s.deferredMetadataPath(r.Context(), outputDir, parentID)
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
	metadataClip["gameplay_zoom"] = gameplayZoom
	updatedMetadata, err := json.MarshalIndent(metadata, "", "  ")
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Could not encode deferred job metadata"})
		return
	}
	if err := writeJSONFileAtomic(metadataPath, updatedMetadata); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Could not persist gameplay zoom"})
		return
	}
	if err := s.persistDeferredMetadata(r.Context(), parentID, updatedMetadata); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": "Could not persist gameplay zoom metadata"})
		return
	}
	result.Clips[clipIndex]["gameplay_zoom"] = gameplayZoom
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
		"gameplay_zoom": gameplayZoom,
	})
}

func (s *Server) updateStreamerTracking(w http.ResponseWriter, r *http.Request, parentID string, clipIndex int) {
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
		StreamerTrackingEnabled *bool `json:"streamer_tracking_enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil || request.StreamerTrackingEnabled == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "streamer_tracking_enabled must be a boolean"})
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
	metadataPath, err := s.deferredMetadataPath(r.Context(), outputDir, parentID)
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
	trackingEnabled := *request.StreamerTrackingEnabled
	metadataClip["streamer_tracking_enabled"] = trackingEnabled
	updatedMetadata, err := json.MarshalIndent(metadata, "", "  ")
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Could not encode deferred job metadata"})
		return
	}
	if err := writeJSONFileAtomic(metadataPath, updatedMetadata); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Could not persist tracking setting"})
		return
	}
	if err := s.persistDeferredMetadata(r.Context(), parentID, updatedMetadata); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": "Could not persist tracking metadata"})
		return
	}
	result.Clips[clipIndex]["streamer_tracking_enabled"] = trackingEnabled
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
		"clip_index":                clipIndex,
		"streamer_tracking_enabled": trackingEnabled,
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
				persistedMetadata := make(map[string]any)
				for _, key := range []string{
					"hashtags",
					"video_title_for_youtube_short",
					"video_description_for_tiktok",
					"video_description_for_instagram",
					"viral_hook_text",
				} {
					if value, exists := clip[key]; exists {
						persistedMetadata[key] = value
					}
				}
				for key, value := range childResult.Clips[child.ClipIndex] {
					clip[key] = value
				}
				for key, value := range persistedMetadata {
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
