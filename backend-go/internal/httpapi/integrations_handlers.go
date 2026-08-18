package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/mutonby/openshorts/backend-go/internal/integrations"
)

func (s *Server) translationLanguages(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"languages": map[string]string{
		"en": "English", "es": "Spanish", "fr": "French", "de": "German", "it": "Italian",
		"pt": "Portuguese", "pl": "Polish", "hi": "Hindi", "ja": "Japanese", "ko": "Korean",
		"zh": "Chinese", "ar": "Arabic", "ru": "Russian", "tr": "Turkish", "nl": "Dutch",
		"sv": "Swedish", "id": "Indonesian", "fil": "Filipino", "ms": "Malay", "vi": "Vietnamese",
		"th": "Thai", "uk": "Ukrainian", "el": "Greek", "cs": "Czech", "fi": "Finnish",
		"ro": "Romanian", "da": "Danish", "bg": "Bulgarian", "hr": "Croatian", "sk": "Slovak",
		"ta": "Tamil",
	}})
}

func (s *Server) discoverLMStudio(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
		return
	}
	var request struct {
		BaseURL string `json:"baseUrl"`
		APIKey  string `json:"apiKey"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid JSON request body"})
		return
	}
	origin, err := serviceOrigin(request.BaseURL)
	if err != nil {
		writeJSON(w, http.StatusOK, lmStudioDiscoveryFailure(strings.TrimSpace(request.BaseURL)))
		return
	}
	upstream, err := http.NewRequestWithContext(r.Context(), http.MethodGet, origin+"/api/v1/models", nil)
	if err != nil {
		writeJSON(w, http.StatusOK, lmStudioDiscoveryFailure(origin))
		return
	}
	if strings.TrimSpace(request.APIKey) != "" {
		upstream.Header.Set("Authorization", "Bearer "+strings.TrimSpace(request.APIKey))
	}
	response, err := (&http.Client{Timeout: 10 * time.Second}).Do(upstream)
	if err != nil {
		writeJSON(w, http.StatusOK, lmStudioDiscoveryFailure(origin))
		return
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		writeJSON(w, http.StatusOK, lmStudioDiscoveryFailure(origin))
		return
	}
	var payload struct {
		Models []map[string]any `json:"models"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		writeJSON(w, http.StatusOK, lmStudioDiscoveryFailure(origin))
		return
	}
	models := make([]map[string]any, 0, len(payload.Models))
	for _, raw := range payload.Models {
		modelID := firstString(raw, "key", "id", "name")
		if modelID == "" {
			continue
		}
		capabilities, _ := raw["capabilities"].(map[string]any)
		vision := boolValue(capabilities["vision"]) || boolValue(raw["supportsVision"])
		loaded := false
		if instances, ok := raw["loaded_instances"].([]any); ok {
			loaded = len(instances) > 0
		}
		models = append(models, map[string]any{
			"id":             modelID,
			"label":          firstString(raw, "display_name", "displayName", "key", "id"),
			"supportsText":   true,
			"supportsVision": vision,
			"isLoaded":       loaded,
			"contextLength":  raw["max_context_length"],
		})
	}
	if len(models) == 0 {
		writeJSON(w, http.StatusOK, lmStudioDiscoveryFailure(origin))
		return
	}
	visionModels := make([]map[string]any, 0)
	for _, model := range models {
		if model["supportsVision"] == true {
			visionModels = append(visionModels, model)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"available":    true,
		"provider":     "lmstudio",
		"baseUrl":      origin,
		"textModels":   models,
		"visionModels": visionModels,
	})
}

func (s *Server) codexRoute(w http.ResponseWriter, r *http.Request) {
	operation := ""
	switch r.URL.Path {
	case "/api/ai/openai-codex/status":
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
			return
		}
		operation = "codex_status"
	case "/api/ai/openai-codex/disconnect":
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
			return
		}
		operation = "codex_disconnect"
	case "/api/ai/openai-codex/models":
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
			return
		}
		operation = "codex_models"
	case "/api/ai/openai-codex/connect":
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
			return
		}
		operation = "codex_connect"
	case "/api/ai/openai-codex/poll":
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
			return
		}
		operation = "codex_poll"
	default:
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Not found"})
		return
	}
	if s.codexAuth != nil && operation != "codex_models" {
		var payload map[string]any
		var err error
		switch operation {
		case "codex_status":
			status := s.codexAuth.Status()
			payload = map[string]any{"connected": status.Connected, "pending": status.Pending}
		case "codex_connect":
			payload, err = s.codexAuth.Connect(r.Context())
		case "codex_poll":
			payload, err = s.codexAuth.Poll(r.Context())
		case "codex_disconnect":
			err = s.codexAuth.Disconnect()
			payload = map[string]any{"connected": false, "pending": false}
		}
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"detail": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, payload)
		return
	}
	if s.translationRunner == nil {
		writeJSON(w, http.StatusNotImplemented, map[string]string{"detail": "Python worker is not configured"})
		return
	}
	result, err := s.translationRunner.Run(r.Context(), "codex-"+operation, operation, map[string]any{"output_dir": s.config.OutputDir}, nil)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": err.Error()})
		return
	}
	var payload any
	if err := json.Unmarshal(result, &payload); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": "Invalid Codex worker result"})
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

func (s *Server) socialUser(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
		return
	}
	apiKey := strings.TrimSpace(r.Header.Get("X-Upload-Post-Key"))
	if apiKey == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Missing X-Upload-Post-Key header"})
		return
	}
	endpoint := s.config.UploadPostUserURL
	if endpoint == "" {
		endpoint = "https://api.upload-post.com/api/uploadposts/users"
	}
	profiles, err := (integrations.SocialClient{HTTP: &http.Client{Timeout: 30 * time.Second}}).FetchProfiles(r.Context(), endpoint, apiKey)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": fmt.Sprintf("Failed to fetch user: %s", err)})
		return
	}
	if len(profiles) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{"profiles": []any{}, "error": "No profiles found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"profiles": profiles})
}

func (s *Server) minioObjects(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
		return
	}
	if s.s3Store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"detail": "MinIO credentials are not configured"})
		return
	}
	limit := 50
	if value := r.URL.Query().Get("limit"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "limit must be an integer"})
			return
		}
		limit = parsed
	}
	page, err := s.s3Store.ListSourceObjects(r.Context(), r.URL.Query().Get("search"), limit, r.URL.Query().Get("continuation_token"))
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) socialPost(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
		return
	}
	var request struct {
		JobID         string   `json:"job_id"`
		ClipIndex     int      `json:"clip_index"`
		APIKey        string   `json:"api_key"`
		UserID        string   `json:"user_id"`
		Platforms     []string `json:"platforms"`
		Title         string   `json:"title"`
		Description   string   `json:"description"`
		ScheduledDate string   `json:"scheduled_date"`
		Timezone      string   `json:"timezone"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid JSON request body"})
		return
	}
	job, ok := s.store.Get(r.Context(), request.JobID)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Job not found"})
		return
	}
	var result struct {
		Clips []map[string]any `json:"clips"`
	}
	if err := json.Unmarshal(job.Result, &result); err != nil || request.ClipIndex < 0 || request.ClipIndex >= len(result.Clips) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Job result not available"})
		return
	}
	clip := result.Clips[request.ClipIndex]
	videoURL := firstString(clip, "video_url", "url")
	filename := filepath.Base(strings.Split(strings.TrimPrefix(videoURL, "/videos/"), "?")[0])
	if filename == "." || filename == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Video file not found"})
		return
	}
	root := filepath.Join(s.config.OutputDir, request.JobID)
	videoPath := filepath.Join(root, filename)
	if !safePath(root, videoPath) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid video path"})
		return
	}
	video, err := os.Open(videoPath)
	if errors.Is(err, os.ErrNotExist) {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Video file not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": err.Error()})
		return
	}
	defer video.Close()
	if request.Title == "" {
		request.Title = firstString(clip, "title", "video_title_for_youtube_short")
		if request.Title == "" {
			request.Title = "Viral Short"
		}
	}
	if request.Description == "" {
		request.Description = firstString(clip, "video_description_for_instagram", "video_description_for_tiktok")
		if request.Description == "" {
			request.Description = "Check this out!"
		}
	}
	client := integrations.SocialClient{HTTP: &http.Client{Timeout: 120 * time.Second}, UploadURL: s.config.UploadPostURL}
	payload, err := client.Publish(r.Context(), request.APIKey, filename, video, integrations.PublishRequest{UserID: request.UserID, Title: request.Title, Description: request.Description, Platforms: request.Platforms, ScheduledDate: request.ScheduledDate, Timezone: request.Timezone})
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, payload)
}
