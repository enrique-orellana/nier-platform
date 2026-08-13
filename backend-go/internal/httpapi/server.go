package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/mutonby/openshorts/backend-go/internal/config"
	"github.com/mutonby/openshorts/backend-go/internal/domain"
	"github.com/mutonby/openshorts/backend-go/internal/jobs"
	"github.com/mutonby/openshorts/backend-go/internal/versions"
)

type OperationClient interface {
	Run(context.Context, string, string, map[string]any, map[string]string) (json.RawMessage, error)
}

type Server struct {
	config            config.Config
	mux               *http.ServeMux
	store             jobs.Store
	runner            *jobs.Runner
	translationRunner OperationClient
	versionMu         sync.Mutex
	versionStores     map[string]*versions.Store
}

func NewServer(cfg config.Config) *Server {
	return NewServerWithStore(cfg, jobs.NewMemoryStore())
}

func NewServerWithStore(cfg config.Config, store jobs.Store) *Server {
	return NewServerWithStoreAndRunner(cfg, store, nil)
}

func NewServerWithStoreAndRunner(cfg config.Config, store jobs.Store, runner *jobs.Runner) *Server {
	return NewServerWithDependencies(cfg, store, runner, nil)
}

func NewServerWithDependencies(cfg config.Config, store jobs.Store, runner *jobs.Runner, translationRunner OperationClient) *Server {
	mux := http.NewServeMux()
	server := &Server{config: cfg, mux: mux, store: store, runner: runner, translationRunner: translationRunner, versionStores: make(map[string]*versions.Store)}
	mux.HandleFunc("/health", server.health)
	mux.HandleFunc("/api/config", server.runtimeConfig)
	mux.HandleFunc("/api/process", server.process)
	mux.HandleFunc("/api/status/", server.status)
	mux.HandleFunc("/api/render", server.renderProxy)
	mux.HandleFunc("/api/render/", server.renderProxy)
	mux.HandleFunc("/api/video-proxy", server.videoProxy)
	mux.HandleFunc("/api/video-proxy/", server.videoProxy)
	mux.HandleFunc("/api/translate/languages", server.translationLanguages)
	mux.HandleFunc("/api/ai/lmstudio/discover", server.discoverLMStudio)
	mux.HandleFunc("/api/local-editor/translate", server.createTranslation)
	mux.HandleFunc("/api/translation/", server.translationStatus)
	mux.HandleFunc("/api/clip/", server.clipRoutes)
	return server
}

func (s *Server) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handler, pattern := s.mux.Handler(r)
		if pattern == "" {
			writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Not found"})
			return
		}
		handler.ServeHTTP(w, r)
	})
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) renderProxy(w http.ResponseWriter, r *http.Request) {
	var upstreamPath string
	switch {
	case r.Method == http.MethodPost && r.URL.Path == "/api/render":
		upstreamPath = "/render"
	case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/api/render/"):
		upstreamPath = "/render/" + strings.TrimPrefix(r.URL.Path, "/api/render/")
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
		return
	}
	upstreamURL := strings.TrimRight(s.config.RenderServiceURL, "/") + upstreamPath
	if r.URL.RawQuery != "" {
		upstreamURL += "?" + r.URL.RawQuery
	}
	var body io.Reader
	if r.Method == http.MethodPost {
		body = r.Body
	}
	request, err := http.NewRequestWithContext(r.Context(), r.Method, upstreamURL, body)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": "Render service unavailable"})
		return
	}
	if contentType := r.Header.Get("Content-Type"); contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	response, err := (&http.Client{Timeout: 30 * time.Second}).Do(request)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": fmt.Sprintf("Render service unavailable: %s", err)})
		return
	}
	defer response.Body.Close()
	w.Header().Set("Content-Type", response.Header.Get("Content-Type"))
	w.WriteHeader(response.StatusCode)
	_, _ = io.Copy(w, response.Body)
}

func (s *Server) videoProxy(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
		return
	}
	target := r.URL.Query().Get("url")
	parsedTarget, err := url.Parse(target)
	if err != nil || parsedTarget.Scheme == "" || parsedTarget.Host == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "A valid video URL is required"})
		return
	}
	publicEndpoint := os.Getenv("AWS_S3_PUBLIC_ENDPOINT_URL")
	if publicEndpoint == "" {
		publicEndpoint = os.Getenv("AWS_S3_PUBLIC_URL_BASE")
	}
	if publicEndpoint != "" {
		allowed, parseErr := url.Parse(publicEndpoint)
		if parseErr != nil || allowed.Host != parsedTarget.Host {
			writeJSON(w, http.StatusForbidden, map[string]string{"detail": "Proxy only allowed for configured MinIO endpoint"})
			return
		}
	}
	upstreamHeaders := make(http.Header)
	if value := r.Header.Get("Range"); value != "" {
		upstreamHeaders.Set("Range", value)
	}
	internalEndpoint := os.Getenv("AWS_S3_ENDPOINT_URL")
	if internalEndpoint != "" && publicEndpoint != "" {
		internal, parseErr := url.Parse(internalEndpoint)
		if parseErr == nil && internal.Host != "" {
			originalHost := parsedTarget.Host
			parsedTarget.Scheme = internal.Scheme
			parsedTarget.Host = internal.Host
			upstreamHeaders.Set("Host", originalHost)
		}
	}
	request, err := http.NewRequestWithContext(r.Context(), http.MethodGet, parsedTarget.String(), nil)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": "Video proxy error"})
		return
	}
	request.Header = upstreamHeaders
	response, err := (&http.Client{Timeout: 30 * time.Second}).Do(request)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": fmt.Sprintf("Video proxy error: %s", err)})
		return
	}
	defer response.Body.Close()
	for _, key := range []string{"Content-Type", "Content-Length", "Content-Range", "ETag"} {
		if value := response.Header.Get(key); value != "" {
			w.Header().Set(key, value)
		}
	}
	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Expose-Headers", "Accept-Ranges, Content-Length, Content-Range, Content-Type, ETag")
	filename := strings.TrimPrefix(r.URL.Path, "/api/video-proxy/")
	if filename != "" {
		w.Header().Set("Content-Disposition", inlineContentDisposition(filename))
	}
	w.WriteHeader(response.StatusCode)
	_, _ = io.Copy(w, response.Body)
}

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

func serviceOrigin(value string) (string, error) {
	parsed, err := url.Parse(strings.TrimRight(strings.TrimSpace(value), "/"))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", errors.New("invalid service URL")
	}
	parsed.Path, parsed.RawPath, parsed.RawQuery, parsed.Fragment = "", "", "", ""
	return strings.TrimRight(parsed.String(), "/"), nil
}

func lmStudioDiscoveryFailure(baseURL string) map[string]any {
	return map[string]any{
		"available":    false,
		"provider":     "lmstudio",
		"baseUrl":      baseURL,
		"textModels":   []any{},
		"visionModels": []any{},
		"error":        "Unable to discover LM Studio models",
	}
}

func firstString(value map[string]any, keys ...string) string {
	for _, key := range keys {
		if text, ok := value[key].(string); ok && strings.TrimSpace(text) != "" {
			return strings.TrimSpace(text)
		}
	}
	return ""
}

func boolValue(value any) bool {
	result, _ := value.(bool)
	return result
}

func inlineContentDisposition(filename string) string {
	ascii := "video.mp4"
	for _, char := range filename {
		if char >= 32 && char <= 126 {
			ascii = strings.ReplaceAll(strings.ReplaceAll(filename, `"`, "'"), `\`, "_")
			break
		}
	}
	return fmt.Sprintf(`inline; filename="%s"; filename*=UTF-8''%s`, ascii, url.QueryEscape(filename))
}

func (s *Server) runtimeConfig(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"port":                s.config.Port,
		"max_concurrent_jobs": s.config.MaxConcurrentJobs,
		"render_service_url":  s.config.RenderServiceURL,
		"youtubeUrlEnabled":   !s.config.DisableYouTubeURL,
		"lmStudioConfig":      lmStudioDiscoveryFailure(""),
	})
}

type processRequest struct {
	URL          string `json:"url"`
	Acknowledged bool   `json:"acknowledged"`
	ClipCount    int    `json:"clip_count"`
}

func (s *Server) process(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
		return
	}

	payload, err := decodeProcessRequest(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": err.Error()})
		return
	}
	if !payload.Acknowledged {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"detail": "You must confirm you own the content or have rights to process it.",
		})
		return
	}
	if err := validateVideoURL(payload.URL); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": err.Error()})
		return
	}
	if payload.ClipCount == 0 {
		payload.ClipCount = 6
	}
	if payload.ClipCount < 3 || payload.ClipCount > 15 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "clip_count must be between 3 and 15"})
		return
	}

	job, err := s.store.Create(r.Context(), domain.CreateJobInput{
		Kind:      "clip-generation",
		SourceURL: payload.URL,
		ClipCount: payload.ClipCount,
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Failed to create job"})
		return
	}
	if err := s.store.AppendLog(r.Context(), job.ID, fmt.Sprintf("Job %s queued.", job.ID)); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Failed to initialize job"})
		return
	}
	if s.runner != nil {
		go func() {
			if err := s.runner.RunOnce(context.Background(), job.ID); err != nil {
				// Runner persists the failure state and error in the job store.
			}
		}()
	}

	writeJSON(w, http.StatusAccepted, map[string]string{
		"job_id": job.ID,
		"status": string(job.Status),
	})
}

func (s *Server) status(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/api/status/")
	job, ok := s.store.Get(r.Context(), id)
	if !ok || id == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Job not found"})
		return
	}
	logs := make([]string, 0, len(job.Logs))
	for _, logEntry := range job.Logs {
		logs = append(logs, logEntry.Message)
	}
	var result json.RawMessage
	if len(job.Result) > 0 {
		result = json.RawMessage(job.Result)
	}
	writeJSON(w, http.StatusOK, struct {
		Status string          `json:"status"`
		Logs   []string        `json:"logs"`
		Result json.RawMessage `json:"result"`
	}{
		Status: string(job.Status),
		Logs:   logs,
		Result: result,
	})
}

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
	}
	result := make(map[string]string)
	for _, key := range allowed {
		if value := r.Header.Get(key); value != "" {
			result[key] = value
		}
	}
	return result
}

func (s *Server) clipRoutes(w http.ResponseWriter, r *http.Request) {
	jobID, clipIndex, segments, err := parseClipPath(r.URL.Path)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Not found"})
		return
	}
	if len(segments) < 1 || segments[0] != "versions" {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Not found"})
		return
	}
	store, err := s.versionStore(jobID, clipIndex)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Could not initialize version store"})
		return
	}

	switch {
	case r.Method == http.MethodGet && len(segments) == 1:
		s.listVersions(w, store)
	case r.Method == http.MethodPost && len(segments) == 1:
		s.createVersion(w, r, store)
	case r.Method == http.MethodPost && len(segments) == 2 && segments[1] == "branch":
		s.branchVersion(w, r, store)
	case r.Method == http.MethodGet && len(segments) == 2:
		s.getVersion(w, store, segments[1])
	case r.Method == http.MethodPost && len(segments) == 3 && segments[2] == "render":
		s.renderVersion(w, r, jobID, clipIndex, store, segments[1])
	case r.Method == http.MethodPost && len(segments) == 3 && segments[2] == "complete":
		s.completeVersion(w, r, store, segments[1])
	case r.Method == http.MethodPost && len(segments) == 3 && segments[2] == "activate":
		s.activateVersion(w, store, segments[1])
	default:
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Not found"})
	}
}

func parseClipPath(path string) (string, int, []string, error) {
	parts := strings.Split(strings.Trim(strings.TrimPrefix(path, "/api/clip/"), "/"), "/")
	if len(parts) < 3 || parts[0] == "" {
		return "", 0, nil, errors.New("invalid clip path")
	}
	clipIndex, err := strconv.Atoi(parts[1])
	if err != nil || clipIndex < 0 {
		return "", 0, nil, errors.New("invalid clip index")
	}
	return parts[0], clipIndex, parts[2:], nil
}

func (s *Server) versionStore(jobID string, clipIndex int) (*versions.Store, error) {
	key := fmt.Sprintf("%s/%d", jobID, clipIndex)
	s.versionMu.Lock()
	defer s.versionMu.Unlock()
	if store, ok := s.versionStores[key]; ok {
		return store, nil
	}
	root := s.config.OutputDir
	if root == "" {
		root = "output"
	}
	store, err := versions.NewStore(filepath.Join(root, jobID, fmt.Sprintf("clip_%d", clipIndex)))
	if err != nil {
		return nil, err
	}
	s.versionStores[key] = store
	return store, nil
}

func (s *Server) listVersions(w http.ResponseWriter, store *versions.Store) {
	writeJSON(w, http.StatusOK, map[string]any{
		"current_version_id": store.CurrentVersionID(),
		"versions":           store.ListVersions(),
	})
}

func (s *Server) createVersion(w http.ResponseWriter, r *http.Request, store *versions.Store) {
	var request struct {
		Manifest        map[string]any `json:"manifest"`
		ParentVersionID *string        `json:"parent_version_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid JSON request body"})
		return
	}
	version, err := store.CreateVersion(request.Manifest, request.ParentVersionID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": err.Error()})
		return
	}
	manifest, err := store.LoadManifest(version.VersionID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"version": version, "manifest": manifest})
}

func (s *Server) branchVersion(w http.ResponseWriter, r *http.Request, store *versions.Store) {
	var request struct {
		VersionID string `json:"version_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid JSON request body"})
		return
	}
	manifest, err := store.LoadManifest(request.VersionID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": err.Error()})
		return
	}
	version, err := store.CreateVersion(manifest, &request.VersionID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": err.Error()})
		return
	}
	branched, err := store.LoadManifest(version.VersionID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"version": version, "manifest": branched})
}

func (s *Server) getVersion(w http.ResponseWriter, store *versions.Store, versionID string) {
	version, err := store.LoadVersion(versionID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": err.Error()})
		return
	}
	manifest, err := store.LoadManifest(versionID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"version": version, "manifest": manifest})
}

func (s *Server) renderVersion(w http.ResponseWriter, r *http.Request, jobID string, clipIndex int, store *versions.Store, versionID string) {
	version, err := store.LoadVersion(versionID)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"detail": err.Error()})
		return
	}
	manifest, err := store.LoadManifest(versionID)
	if err != nil || manifest["manifest_revision"] != version.ManifestRevision {
		writeJSON(w, http.StatusConflict, map[string]string{"detail": "manifest revision mismatch"})
		return
	}
	var request struct {
		Props map[string]any `json:"props"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid JSON request body"})
		return
	}
	if request.Props == nil {
		request.Props = map[string]any{}
	}
	request.Props["versionId"] = versionID
	request.Props["manifestRevision"] = version.ManifestRevision
	body := map[string]any{"jobId": jobID, "clipIndex": clipIndex, "props": request.Props}
	encoded, err := json.Marshal(body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": err.Error()})
		return
	}
	if _, err := store.UpdateRender(versionID, versions.RenderStatusRendering, ""); err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"detail": err.Error()})
		return
	}
	upstream, err := http.NewRequestWithContext(r.Context(), http.MethodPost, strings.TrimRight(s.config.RenderServiceURL, "/")+"/render", strings.NewReader(string(encoded)))
	if err != nil {
		_, _ = store.UpdateRender(versionID, versions.RenderStatusFailed, err.Error())
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": err.Error()})
		return
	}
	upstream.Header.Set("Content-Type", "application/json")
	response, err := (&http.Client{Timeout: 30 * time.Second}).Do(upstream)
	if err != nil {
		_, _ = store.UpdateRender(versionID, versions.RenderStatusFailed, err.Error())
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": fmt.Sprintf("Render service unavailable: %s", err)})
		return
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		message, _ := io.ReadAll(response.Body)
		_, _ = store.UpdateRender(versionID, versions.RenderStatusFailed, string(message))
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": "Render service returned an error"})
		return
	}
	w.Header().Set("Content-Type", response.Header.Get("Content-Type"))
	w.WriteHeader(response.StatusCode)
	_, _ = io.Copy(w, response.Body)
}

func (s *Server) completeVersion(w http.ResponseWriter, r *http.Request, store *versions.Store, versionID string) {
	var request struct {
		OutputURL string `json:"output_url"`
		Error     string `json:"error"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid JSON request body"})
		return
	}
	if _, err := store.LoadVersion(versionID); err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"detail": err.Error()})
		return
	}
	if request.Error != "" {
		failed, err := store.UpdateRender(versionID, versions.RenderStatusFailed, request.Error)
		if err != nil {
			writeJSON(w, http.StatusConflict, map[string]string{"detail": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"version": failed, "current_version_id": store.CurrentVersionID()})
		return
	}
	if request.OutputURL == "" {
		writeJSON(w, http.StatusConflict, map[string]string{"detail": "output URL is required"})
		return
	}
	if _, err := store.UpdateRender(versionID, versions.RenderStatusDone, ""); err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"detail": err.Error()})
		return
	}
	promoted, err := store.PromoteVersion(versionID, request.OutputURL)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"detail": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"version": promoted, "current_version_id": promoted.VersionID})
}

func (s *Server) activateVersion(w http.ResponseWriter, store *versions.Store, versionID string) {
	version, err := store.LoadVersion(versionID)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"detail": err.Error()})
		return
	}
	if version.OutputURL == "" {
		writeJSON(w, http.StatusConflict, map[string]string{"detail": "version has no rendered output"})
		return
	}
	promoted, err := store.PromoteVersion(versionID, version.OutputURL)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"detail": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"version": promoted, "current_version_id": promoted.VersionID})
}

func decodeProcessRequest(r *http.Request) (processRequest, error) {
	contentType := strings.ToLower(r.Header.Get("Content-Type"))
	if strings.Contains(contentType, "application/json") {
		var payload processRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			return processRequest{}, errors.New("Invalid JSON request body")
		}
		return payload, nil
	}
	if err := r.ParseForm(); err != nil {
		return processRequest{}, errors.New("Invalid form request body")
	}
	acknowledged, err := parseBool(r.FormValue("acknowledged"))
	if err != nil {
		return processRequest{}, errors.New("acknowledged must be true")
	}
	clipCount := 0
	if value := r.FormValue("clip_count"); value != "" {
		clipCount, err = strconv.Atoi(value)
		if err != nil {
			return processRequest{}, errors.New("clip_count must be an integer")
		}
	}
	return processRequest{URL: r.FormValue("url"), Acknowledged: acknowledged, ClipCount: clipCount}, nil
}

func parseBool(value string) (bool, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes":
		return true, nil
	case "", "0", "false", "no":
		return false, nil
	default:
		return false, errors.New("invalid boolean")
	}
}

func validateVideoURL(value string) error {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return errors.New("Video URL must use http:// or https://")
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
