package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/mutonby/openshorts/backend-go/internal/domain"
)

func (s *Server) projectRoutes(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/projects/"), "/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Not found"})
		return
	}
	jobID := parts[0]
	job, exists := s.store.Get(r.Context(), jobID)
	if !exists {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Project not found"})
		return
	}
	switch {
	case r.Method == http.MethodGet && len(parts) == 2 && parts[1] == "statuses":
		s.getProjectStatuses(w, r, jobID)
	case r.Method == http.MethodPost && len(parts) == 4 && parts[1] == "clips" && parts[3] == "transcribe":
		s.transcribeProjectClip(w, r, job, parts[2])
	case r.Method == http.MethodPatch && len(parts) == 4 && parts[1] == "clips" && parts[3] == "status":
		s.updateProjectStatus(w, r, job, parts[2])
	case r.Method == http.MethodDelete && len(parts) == 1:
		s.deleteProject(w, r, jobID)
	default:
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Not found"})
	}
}

func (s *Server) projectHistory(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
		return
	}
	limit := 48
	if value := r.URL.Query().Get("limit"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed < 1 || parsed > 100 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "limit must be between 1 and 100"})
			return
		}
		limit = parsed
	}
	root := s.config.OutputDir
	if root == "" {
		root = "output"
	}
	entries, err := os.ReadDir(root)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": err.Error()})
		return
	}
	type projectEntry struct {
		Project map[string]any
		ModTime time.Time
	}
	projects := make([]projectEntry, 0)
	seenProjects := make(map[string]bool)
	if jobs, listErr := s.store.ListByKind(r.Context(), "clip-generation"); listErr == nil {
		for _, job := range jobs {
			clips, createdAt, ok := s.readPersistedProjectClips(job)
			if !ok {
				continue
			}
			seenProjects[job.ID] = true
			title := ""
			if len(clips) > 0 {
				title = firstString(clips[0], "title", "video_title_for_youtube_short")
			}
			projects = append(projects, projectEntry{Project: map[string]any{"job_id": job.ID, "title": title, "description": "", "created_at": createdAt.Format(time.RFC3339Nano), "clips": clips}, ModTime: createdAt})
		}
	}
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		if seenProjects[entry.Name()] {
			continue
		}
		clips, createdAt, ok := s.readProjectClips(entry.Name())
		if !ok {
			continue
		}
		title := ""
		if len(clips) > 0 {
			title = firstString(clips[0], "title", "video_title_for_youtube_short")
		}
		projects = append(projects, projectEntry{Project: map[string]any{"job_id": entry.Name(), "title": title, "description": "", "created_at": createdAt.Format(time.RFC3339Nano), "clips": clips}, ModTime: createdAt})
	}
	sort.Slice(projects, func(i, j int) bool { return projects[i].ModTime.After(projects[j].ModTime) })
	if len(projects) > limit {
		projects = projects[:limit]
	}
	result := make([]map[string]any, 0, len(projects))
	for _, project := range projects {
		result = append(result, project.Project)
	}
	writeJSON(w, http.StatusOK, map[string]any{"projects": result, "total": len(result)})
}

func (s *Server) projectClips(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
		return
	}
	jobID := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/projects/clips/"), "/")
	if job, exists := s.store.Get(r.Context(), jobID); exists {
		if clips, _, ok := s.readPersistedProjectClips(job); ok {
			writeJSON(w, http.StatusOK, map[string]any{"clips": clips})
			return
		}
	}
	clips, _, ok := s.readProjectClips(jobID)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Project not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"clips": clips})
}

func (s *Server) readPersistedProjectClips(job domain.Job) ([]map[string]any, time.Time, bool) {
	resultBytes := s.decorateDeferredClipResult(context.Background(), job)
	if len(resultBytes) == 0 {
		return nil, time.Time{}, false
	}
	var payload map[string]any
	if json.Unmarshal(resultBytes, &payload) != nil {
		return nil, time.Time{}, false
	}
	var result struct {
		Clips []map[string]any `json:"clips"`
	}
	if json.Unmarshal(resultBytes, &result) != nil || len(result.Clips) == 0 {
		return nil, time.Time{}, false
	}
	masterDuration := sourceDurationFromMetadata(payload)
	for _, clip := range result.Clips {
		clipID := clipArtifactID(job.ID, clip)
		if filename, ok := clip["video_filename"].(string); ok && filename != "" {
			clip["video_url"] = s.directClipArtifactURL(job.ID, clipID, filename)
		}
		if sourceFilename, ok := clip["source_video_filename"].(string); ok && sourceFilename != "" {
			clip["source_video_url"] = s.directMasterArtifactURL(job.ID, sourceFilename)
		}
		clip["job_id"] = job.ID
		if masterDuration > 0 {
			clip["master_duration"] = masterDuration
		}
	}
	createdAt := job.CreatedAt
	if createdAt.IsZero() {
		createdAt = job.UpdatedAt
	}
	if createdAt.IsZero() {
		createdAt = time.Now().UTC()
	}
	return result.Clips, createdAt, true
}

func (s *Server) directArtifactURL(jobID, filename string) string {
	return s.directClipArtifactURL(jobID, jobID, filename)
}

func clipArtifactID(jobID string, clip map[string]any) string {
	if renderJobID, ok := clip["render_job_id"].(string); ok && strings.TrimSpace(renderJobID) != "" {
		return strings.TrimSpace(renderJobID)
	}
	return jobID
}

func (s *Server) directClipArtifactURL(jobID, clipID, filename string) string {
	if s.artifactURLOverride != nil {
		return s.artifactURLOverride(jobID, filename)
	}
	if s.s3Store != nil {
		key := jobID + "/clips/" + clipID + "/" + filename
		if directURL, err := s.s3Store.DirectObjectURL(context.Background(), key, 2*time.Hour); err == nil {
			return directURL
		}
	}
	return "/videos/" + jobID + "/" + filename
}

func (s *Server) directMasterArtifactURL(jobID, filename string) string {
	if s.artifactURLOverride != nil {
		return s.artifactURLOverride(jobID, filename)
	}
	if s.s3Store != nil {
		key := jobID + "/master/" + filename
		if directURL, err := s.s3Store.DirectObjectURL(context.Background(), key, 2*time.Hour); err == nil {
			return directURL
		}
	}
	return "/videos/" + jobID + "/" + filename
}

func (s *Server) readProjectClips(jobID string) ([]map[string]any, time.Time, bool) {
	root := s.config.OutputDir
	if root == "" {
		root = "output"
	}
	metadataFiles, err := filepath.Glob(filepath.Join(root, jobID, "*_metadata.json"))
	if err != nil || len(metadataFiles) == 0 {
		return nil, time.Time{}, false
	}
	contents, err := os.ReadFile(metadataFiles[0])
	if err != nil {
		return nil, time.Time{}, false
	}
	var data struct {
		Shorts                []map[string]any `json:"shorts"`
		SourceDurationSeconds float64          `json:"source_duration_seconds"`
		VideoDuration         float64          `json:"video_duration"`
		SourceAsset           struct {
			Probe struct {
				DurationSeconds float64 `json:"duration_seconds"`
			} `json:"probe"`
		} `json:"source_asset"`
	}
	if json.Unmarshal(contents, &data) != nil {
		return nil, time.Time{}, false
	}
	masterDuration := data.SourceDurationSeconds
	if masterDuration <= 0 {
		masterDuration = data.VideoDuration
	}
	if masterDuration <= 0 {
		masterDuration = data.SourceAsset.Probe.DurationSeconds
	}
	for _, clip := range data.Shorts {
		if filename, ok := clip["video_filename"].(string); ok && filename != "" {
			clip["video_url"] = s.directArtifactURL(jobID, filename)
		}
		if sourceFilename, ok := clip["source_video_filename"].(string); ok && sourceFilename != "" {
			clip["source_video_url"] = s.directMasterArtifactURL(jobID, sourceFilename)
		}
		clip["job_id"] = jobID
		if masterDuration > 0 {
			clip["master_duration"] = masterDuration
		}
	}
	info, err := os.Stat(metadataFiles[0])
	if err != nil {
		return data.Shorts, time.Now().UTC(), true
	}
	return data.Shorts, info.ModTime().UTC(), true
}

func (s *Server) getProjectStatuses(w http.ResponseWriter, r *http.Request, jobID string) {
	statuses, err := s.store.GetClipStatuses(r.Context(), jobID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": err.Error()})
		return
	}
	clips := make(map[string]any, len(statuses))
	for index, status := range statuses {
		clips[strconv.Itoa(index)] = map[string]any{
			"status":     status.Status,
			"updated_at": status.UpdatedAt.Format(time.RFC3339Nano),
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"clips": clips})
}

func (s *Server) updateProjectStatus(w http.ResponseWriter, r *http.Request, job domain.Job, rawIndex string) {
	clipIndex, err := strconv.Atoi(rawIndex)
	if err != nil || clipIndex < 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Clip not found"})
		return
	}
	var result struct {
		Clips []any `json:"clips"`
	}
	if json.Unmarshal(job.Result, &result) != nil || clipIndex >= len(result.Clips) {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Clip not found"})
		return
	}
	var request struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid JSON request body"})
		return
	}
	allowed := map[string]bool{"not_reviewed": true, "reviewing": true, "editing": true, "edited": true, "discarded": true, "published": true}
	if !allowed[request.Status] {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"detail": "Invalid clip status"})
		return
	}
	status, err := s.store.SetClipStatus(r.Context(), job.ID, clipIndex, request.Status)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"job_id": job.ID, "clip_index": clipIndex, "status": status.Status, "updated_at": status.UpdatedAt.Format(time.RFC3339Nano)})
}

func (s *Server) deleteProject(w http.ResponseWriter, r *http.Request, jobID string) {
	root := s.config.OutputDir
	if root == "" {
		root = "output"
	}
	if err := os.RemoveAll(filepath.Join(root, jobID)); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": err.Error()})
		return
	}
	s3Deleted := 0
	if s.s3Store != nil {
		deleted, err := s.s3Store.DeletePrefix(r.Context(), jobID+"/")
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"detail": err.Error()})
			return
		}
		s3Deleted = deleted
	}
	if err := s.store.DeleteJob(r.Context(), jobID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "job_id": jobID, "s3_deleted_count": s3Deleted})
}
