package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/mutonby/openshorts/backend-go/internal/config"
	"github.com/mutonby/openshorts/backend-go/internal/domain"
	"github.com/mutonby/openshorts/backend-go/internal/jobs"
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
	server := &Server{config: cfg, mux: mux, store: store, runner: runner, translationRunner: translationRunner}
	mux.HandleFunc("/health", server.health)
	mux.HandleFunc("/api/config", server.runtimeConfig)
	mux.HandleFunc("/api/process", server.process)
	mux.HandleFunc("/api/status/", server.status)
	mux.HandleFunc("/api/render", server.renderProxy)
	mux.HandleFunc("/api/render/", server.renderProxy)
	mux.HandleFunc("/api/local-editor/translate", server.createTranslation)
	mux.HandleFunc("/api/translation/", server.translationStatus)
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

func (s *Server) runtimeConfig(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"port":                s.config.Port,
		"max_concurrent_jobs": s.config.MaxConcurrentJobs,
		"render_service_url":  s.config.RenderServiceURL,
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
