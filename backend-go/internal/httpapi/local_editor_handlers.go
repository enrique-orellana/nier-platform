package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/mutonby/openshorts/backend-go/internal/domain"
)

func (s *Server) createTranslation(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
		return
	}
	var payload map[string]any
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid JSON request body"})
		return
	}
	if strings.TrimSpace(fmt.Sprint(payload["target_language"])) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "target_language is required"})
		return
	}
	job, err := s.store.Create(r.Context(), domain.CreateJobInput{
		Kind: "translation",
		Metadata: map[string]any{
			"payload": payload,
			"headers": translationHeaders(r),
		},
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Failed to create translation"})
		return
	}
	if err := s.store.AppendLog(r.Context(), job.ID, fmt.Sprintf("Translation %s queued.", job.ID)); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Failed to initialize translation"})
		return
	}
	if s.translationRunner != nil {
		go s.runTranslation(job.ID)
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"translationId": job.ID, "status": "queued"})
}

func (s *Server) transcribeLocalEditor(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
		return
	}
	if s.translationRunner == nil {
		writeJSON(w, http.StatusNotImplemented, map[string]string{"detail": "Python worker is not configured"})
		return
	}
	sourcePath, err := s.saveUploadedFile(r, "file")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": err.Error()})
		return
	}
	defer os.Remove(sourcePath)
	result, err := s.translationRunner.Run(r.Context(), "local-editor-transcription", "transcribe", map[string]any{"source_path": sourcePath}, translationHeaders(r))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": fmt.Sprintf("Subtitle generation failed: %s", err)})
		return
	}
	var payload map[string]any
	if err := json.Unmarshal(result, &payload); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Invalid transcription worker result"})
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

func (s *Server) transcribeProjectClip(w http.ResponseWriter, r *http.Request, job domain.Job, rawIndex string) {
	if s.translationRunner == nil {
		writeJSON(w, http.StatusNotImplemented, map[string]string{"detail": "Python worker is not configured"})
		return
	}
	clipIndex, err := strconv.Atoi(rawIndex)
	if err != nil || clipIndex < 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Clip not found"})
		return
	}
	var result struct {
		Clips []struct {
			Start               float64 `json:"start"`
			End                 float64 `json:"end"`
			SourceVideoFilename string  `json:"source_video_filename"`
		} `json:"clips"`
	}
	if json.Unmarshal(job.Result, &result) != nil || clipIndex >= len(result.Clips) {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Clip not found"})
		return
	}
	clip := result.Clips[clipIndex]
	if clip.Start < 0 || clip.End <= clip.Start {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"detail": "Clip has no valid source range"})
		return
	}
	root := job.OutputDir
	if strings.TrimSpace(root) == "" {
		root = filepath.Join(s.config.OutputDir, job.ID)
	}
	jobRoot, err := filepath.Abs(root)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Could not resolve project cache"})
		return
	}
	sourceFilename := clip.SourceVideoFilename
	if strings.TrimSpace(sourceFilename) == "" {
		sourceFilename = "source.mp4"
	}
	if filepath.Base(sourceFilename) != sourceFilename || !hasVideoExtension(sourceFilename) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid cached master filename"})
		return
	}
	sourcePath, err := filepath.Abs(filepath.Join(jobRoot, sourceFilename))
	if err != nil || !safePath(jobRoot, sourcePath) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid cached master path"})
		return
	}
	if _, err := os.Stat(sourcePath); errors.Is(err, os.ErrNotExist) {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Project master is not cached"})
		return
	} else if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Could not access project master"})
		return
	}
	workerResult, err := s.translationRunner.Run(r.Context(), fmt.Sprintf("project-%s-clip-%d-transcription", job.ID, clipIndex), "transcribe", map[string]any{
		"source_path":   sourcePath,
		"start_seconds": clip.Start,
		"end_seconds":   clip.End,
	}, translationHeaders(r))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": fmt.Sprintf("Subtitle generation failed: %s", err)})
		return
	}
	var payload map[string]any
	if err := json.Unmarshal(workerResult, &payload); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Invalid transcription worker result"})
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

func (s *Server) generateHashtags(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
		return
	}
	if s.translationRunner == nil {
		writeJSON(w, http.StatusNotImplemented, map[string]string{"detail": "Python worker is not configured"})
		return
	}
	var payload map[string]any
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid JSON request body"})
		return
	}
	if strings.TrimSpace(fmt.Sprint(payload["title"])) == "" && strings.TrimSpace(fmt.Sprint(payload["caption"])) == "" && strings.TrimSpace(fmt.Sprint(payload["subtitle_text"])) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Clip context is required to generate hashtags."})
		return
	}
	result, err := s.translationRunner.Run(r.Context(), "hashtags", "hashtags", payload, translationHeaders(r))
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": fmt.Sprintf("Hashtag generation failed: %s", err)})
		return
	}
	var response map[string]any
	if err := json.Unmarshal(result, &response); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": "Invalid hashtag worker result"})
		return
	}
	if hashtags, ok := response["hashtags"].([]any); ok {
		for index, value := range hashtags {
			if hashtag, ok := value.(string); ok {
				hashtags[index] = normalizeHashtag(hashtag)
			}
		}
	}
	writeJSON(w, http.StatusOK, response)
}

func normalizeHashtag(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func (s *Server) generateClipInfo(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
		return
	}
	if s.translationRunner == nil {
		writeJSON(w, http.StatusNotImplemented, map[string]string{"detail": "Python worker is not configured"})
		return
	}
	var payload map[string]any
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid JSON request body"})
		return
	}
	if strings.TrimSpace(fmt.Sprint(payload["title"])) == "" && strings.TrimSpace(fmt.Sprint(payload["caption"])) == "" && strings.TrimSpace(fmt.Sprint(payload["subtitle_text"])) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Clip context is required to regenerate clip information."})
		return
	}
	result, err := s.translationRunner.Run(r.Context(), "clip-info", "clip_info", payload, translationHeaders(r))
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": fmt.Sprintf("Clip information generation failed: %s", err)})
		return
	}
	var response map[string]any
	if err := json.Unmarshal(result, &response); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": "Invalid clip information worker result"})
		return
	}
	for _, key := range []string{"video_title_for_youtube_short", "video_description_for_tiktok", "video_description_for_instagram", "viral_hook_text"} {
		value, ok := response[key].(string)
		if !ok || strings.TrimSpace(value) == "" {
			writeJSON(w, http.StatusBadGateway, map[string]string{"detail": "Clip information worker returned incomplete metadata"})
			return
		}
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) renderLocalEditor(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
		return
	}
	propsJSON := r.FormValue("props")
	var props map[string]any
	if err := json.Unmarshal([]byte(propsJSON), &props); err != nil || props == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid render properties."})
		return
	}
	for _, key := range []string{"durationInFrames", "fps", "width", "height"} {
		if _, ok := props[key]; !ok {
			writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Render properties are missing video metadata."})
			return
		}
	}
	temporaryPath, err := s.saveUploadedFile(r, "file")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": err.Error()})
		return
	}
	root := s.config.OutputDir
	if root == "" {
		root = "output"
	}
	jobID := fmt.Sprintf("local-editor-%d", time.Now().UnixNano())
	jobOutputDir := filepath.Join(root, jobID)
	if err := os.MkdirAll(jobOutputDir, 0o755); err != nil {
		_ = os.Remove(temporaryPath)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": err.Error()})
		return
	}
	sourceName := "source" + filepath.Ext(temporaryPath)
	sourcePath := filepath.Join(jobOutputDir, sourceName)
	if err := os.Rename(temporaryPath, sourcePath); err != nil {
		_ = os.Remove(temporaryPath)
		_ = os.RemoveAll(jobOutputDir)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": err.Error()})
		return
	}
	props["videoUrl"] = "/videos/" + jobID + "/" + sourceName
	body, _ := json.Marshal(map[string]any{"jobId": jobID, "clipIndex": 0, "props": props})
	request, err := http.NewRequestWithContext(r.Context(), http.MethodPost, strings.TrimRight(s.config.RenderServiceURL, "/")+"/render", strings.NewReader(string(body)))
	if err != nil {
		_ = os.RemoveAll(jobOutputDir)
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": err.Error()})
		return
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := (&http.Client{Timeout: 30 * time.Second}).Do(request)
	if err != nil {
		_ = os.RemoveAll(jobOutputDir)
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": fmt.Sprintf("Could not start local video render: %s", err)})
		return
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		_ = os.RemoveAll(jobOutputDir)
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": "Could not start local video render"})
		return
	}
	var payload map[string]any
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil || payload["renderId"] == nil {
		_ = os.RemoveAll(jobOutputDir)
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": "Render service did not return a render ID."})
		return
	}
	payload["jobId"] = jobID
	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(payload)
}

func (s *Server) burnLocalEditorSubtitles(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
		return
	}
	if s.translationRunner == nil {
		writeJSON(w, http.StatusNotImplemented, map[string]string{"detail": "Python worker is not configured"})
		return
	}
	var request struct {
		JobID         string           `json:"job_id"`
		InputFilename string           `json:"input_filename"`
		SubtitleCues  []map[string]any `json:"subtitle_cues"`
		SubtitleStyle map[string]any   `json:"subtitle_style"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid JSON request body"})
		return
	}
	if !strings.HasPrefix(request.JobID, "local-editor-") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid local editor render job."})
		return
	}
	if filepath.Base(request.InputFilename) != request.InputFilename || !hasVideoExtension(request.InputFilename) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid local editor render filename."})
		return
	}
	if len(request.SubtitleCues) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "At least one subtitle cue is required."})
		return
	}
	root := s.config.OutputDir
	if root == "" {
		root = "output"
	}
	jobRoot, _ := filepath.Abs(filepath.Join(root, request.JobID))
	inputPath, _ := filepath.Abs(filepath.Join(jobRoot, request.InputFilename))
	if !safePath(jobRoot, inputPath) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid local editor render filename."})
		return
	}
	if _, err := os.Stat(inputPath); errors.Is(err, os.ErrNotExist) {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Local editor render was not found."})
		return
	}
	result, err := s.translationRunner.Run(r.Context(), "burn-"+request.JobID, "burn_subtitles", map[string]any{
		"job_id": request.JobID, "source_path": inputPath, "input_filename": request.InputFilename,
		"subtitle_cues": request.SubtitleCues, "subtitle_style": request.SubtitleStyle,
	}, nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": fmt.Sprintf("Could not burn local subtitles: %s", err)})
		return
	}
	var payload map[string]any
	if err := json.Unmarshal(result, &payload); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Invalid subtitle worker result"})
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

func hasVideoExtension(filename string) bool {
	ext := strings.ToLower(filepath.Ext(filename))
	for _, allowed := range []string{".mp4", ".m4v", ".mov", ".webm", ".mkv"} {
		if ext == allowed {
			return true
		}
	}
	return false
}

func (s *Server) runTranslation(id string) {
	ctx := context.Background()
	job, ok := s.store.Get(ctx, id)
	if !ok {
		return
	}
	if _, err := s.store.Transition(ctx, id, domain.JobStatusProcessing, ""); err != nil {
		return
	}
	_ = s.store.AppendLog(ctx, id, "Translation started by worker.")
	payload, _ := job.Metadata["payload"].(map[string]any)
	headerValues := make(map[string]string)
	switch headers := job.Metadata["headers"].(type) {
	case map[string]string:
		for key, value := range headers {
			headerValues[key] = value
		}
	case map[string]any:
		for key, value := range headers {
			headerValues[key] = fmt.Sprint(value)
		}
	}
	result, err := s.translationRunner.Run(ctx, id, "translation", payload, headerValues)
	if err != nil {
		_ = s.store.AppendLog(ctx, id, fmt.Sprintf("Execution error: %s", err))
		_, _ = s.store.Transition(ctx, id, domain.JobStatusFailed, err.Error())
		return
	}
	if err := s.store.SetResult(ctx, id, result); err != nil {
		_, _ = s.store.Transition(ctx, id, domain.JobStatusFailed, err.Error())
		return
	}
	_, _ = s.store.Transition(ctx, id, domain.JobStatusCompleted, "")
}

func (s *Server) saveUploadedFile(r *http.Request, field string) (string, error) {
	file, header, err := r.FormFile(field)
	if err != nil {
		return "", errors.New("Please upload a video file.")
	}
	defer file.Close()
	root := s.config.OutputDir
	if root == "" {
		root = "output"
	}
	uploadDir := filepath.Join(root, ".uploads")
	if err := os.MkdirAll(uploadDir, 0o755); err != nil {
		return "", errors.New("could not create upload directory")
	}
	temporary, err := os.CreateTemp(uploadDir, "local-editor-*"+filepath.Ext(filepath.Base(header.Filename)))
	if err != nil {
		return "", errors.New("could not create upload file")
	}
	path := temporary.Name()
	if _, err := io.Copy(temporary, file); err != nil {
		_ = temporary.Close()
		_ = os.Remove(path)
		return "", errors.New("could not save uploaded file")
	}
	if err := temporary.Close(); err != nil {
		_ = os.Remove(path)
		return "", errors.New("could not close uploaded file")
	}
	return path, nil
}

func (s *Server) translationStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/api/translation/")
	job, ok := s.store.Get(r.Context(), id)
	if !ok || id == "" || job.Kind != "translation" {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Translation job not found"})
		return
	}
	status := map[domain.JobStatus]string{
		domain.JobStatusQueued:     "queued",
		domain.JobStatusProcessing: "running",
		domain.JobStatusCompleted:  "done",
		domain.JobStatusFailed:     "error",
	}[job.Status]
	response := map[string]any{"translationId": id, "status": status}
	if len(job.Result) > 0 {
		var result map[string]any
		if json.Unmarshal(job.Result, &result) == nil {
			for key, value := range result {
				response[key] = value
			}
		}
	}
	if job.Error != "" {
		response["error"] = job.Error
	}
	writeJSON(w, http.StatusOK, response)
}

func translationHeaders(r *http.Request) map[string]string {
	allowed := []string{
		"X-AI-Provider", "X-AI-Api-Key", "X-Gemini-Key", "X-AI-Base-Url",
		"X-AI-Model", "X-AI-Analyze-Model", "X-AI-Vision-Model", "X-AI-Image-Model",
		"X-AI-Reasoning-Effort", "X-AI-Analyze-Reasoning-Effort", "X-AI-Vision-Reasoning-Effort",
		"X-AI-Transcription-Model", "X-AI-Transcription-Language", "X-AI-Transcription-OpenRouter-Provider",
	}
	result := make(map[string]string)
	for _, key := range allowed {
		if value := r.Header.Get(key); value != "" {
			result[key] = value
		}
	}
	return result
}
