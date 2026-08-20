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

	"github.com/mutonby/openshorts/backend-go/internal/domain"
)

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
	URL          string         `json:"url"`
	SourceURL    string         `json:"source_url"`
	SourceObject map[string]any `json:"source_object"`
	SourcePath   string         `json:"-"`
	Acknowledged bool           `json:"acknowledged"`
	ClipCount    int            `json:"clip_count"`
	LayoutFormat string         `json:"layout_format"`
	FacecamSize  string         `json:"facecam_size"`
	DeferRender  bool           `json:"defer_render"`
}

func (s *Server) process(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
		return
	}

	payload, err := s.decodeProcessRequest(r)
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
	providedSources := 0
	if payload.URL != "" {
		providedSources++
	}
	if payload.SourceObject != nil {
		providedSources++
	}
	if payload.SourcePath != "" {
		providedSources++
	}
	if providedSources != 1 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Must provide exactly one URL, MinIO object, or File"})
		return
	}
	if payload.URL != "" {
		if err := validateVideoURL(payload.URL); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"detail": err.Error()})
			return
		}
	}
	if payload.SourceObject != nil {
		if strings.TrimSpace(fmt.Sprint(payload.SourceObject["bucket"])) == "" || strings.TrimSpace(fmt.Sprint(payload.SourceObject["key"])) == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "MinIO source object requires bucket and key"})
			return
		}
	}
	if payload.ClipCount == 0 {
		if queryCount := r.URL.Query().Get("clip_count"); queryCount != "" {
			payload.ClipCount, err = strconv.Atoi(queryCount)
			if err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "clip_count must be an integer"})
				return
			}
		} else {
			payload.ClipCount = 6
		}
	}
	if payload.ClipCount < 3 || payload.ClipCount > 15 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "clip_count must be between 3 and 15"})
		return
	}
	layoutFormat, facecamSize, err := normalizeProcessLayoutOptions(payload.LayoutFormat, payload.FacecamSize)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": err.Error()})
		return
	}
	if strings.TrimSpace(r.Header.Get("X-AI-Api-Key")) == "" && strings.TrimSpace(r.Header.Get("X-Gemini-Key")) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"detail": "OpenRouter API key is required for remote transcription.",
		})
		return
	}

	metadata := map[string]any{}
	if payload.SourceURL != "" {
		metadata["source_url"] = payload.SourceURL
	}
	if payload.SourceObject != nil {
		metadata["source_object"] = payload.SourceObject
	}
	if payload.SourcePath != "" {
		metadata["source_path"] = payload.SourcePath
	}
	metadata["layout_format"] = layoutFormat
	metadata["facecam_size"] = facecamSize
	// Clip-generation jobs discover candidates first. Expensive scene/face/layout
	// analysis and rendering start only when the user explicitly renders a clip.
	metadata["defer_render"] = true
	outputRoot := s.config.OutputDir
	if outputRoot == "" {
		outputRoot = "output"
	}
	job, err := s.store.Create(r.Context(), domain.CreateJobInput{
		Kind:      "clip-generation",
		SourceURL: payload.URL,
		ClipCount: payload.ClipCount,
		OutputDir: filepath.Join(outputRoot, "pending"),
		Metadata:  metadata,
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Failed to create job"})
		return
	}
	if err := s.store.SetOutputDir(r.Context(), job.ID, filepath.Join(outputRoot, job.ID)); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Failed to initialize job output"})
		return
	}
	if err := s.store.AppendLog(r.Context(), job.ID, fmt.Sprintf("Job %s queued.", job.ID)); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Failed to initialize job"})
		return
	}
	s.setHighlightRuntimeMetadata(job.ID, map[string]any{"headers": translationHeaders(r)})
	if s.scheduler != nil {
		if err := s.scheduler.Submit(r.Context(), job.ID); err != nil {
			s.releaseHighlightRuntimeMetadata(job.ID)
			_, _ = s.store.Transition(r.Context(), job.ID, domain.JobStatusFailed, err.Error())
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"detail": "Job scheduler unavailable"})
			return
		}
	} else if s.runner != nil {
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
	writeJSON(w, http.StatusOK, struct {
		Status      string           `json:"status"`
		Logs        []string         `json:"logs"`
		Result      json.RawMessage  `json:"result"`
		Error       string           `json:"error"`
		ClipRenders []map[string]any `json:"clip_renders,omitempty"`
	}{
		Status:      string(job.Status),
		Logs:        logs,
		Result:      s.decorateDeferredClipResult(r.Context(), job),
		Error:       job.Error,
		ClipRenders: s.deferredClipRenders(r.Context(), job.ID),
	})
}

func maxFloat(left, right float64) float64 {
	if left > right {
		return left
	}
	return right
}

func (s *Server) decodeProcessRequest(r *http.Request) (processRequest, error) {
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
	var sourcePath string
	if strings.Contains(contentType, "multipart/form-data") {
		file, header, err := r.FormFile("file")
		if err == nil {
			defer file.Close()
			root := s.config.OutputDir
			if root == "" {
				root = "output"
			}
			uploadDir := filepath.Join(root, ".uploads")
			if err := os.MkdirAll(uploadDir, 0o755); err != nil {
				return processRequest{}, errors.New("could not create upload directory")
			}
			temporary, err := os.CreateTemp(uploadDir, "source-*"+filepath.Ext(filepath.Base(header.Filename)))
			if err != nil {
				return processRequest{}, errors.New("could not create upload file")
			}
			sourcePath = temporary.Name()
			if _, err := io.Copy(temporary, file); err != nil {
				_ = temporary.Close()
				_ = os.Remove(sourcePath)
				return processRequest{}, errors.New("could not save uploaded file")
			}
			if err := temporary.Close(); err != nil {
				_ = os.Remove(sourcePath)
				return processRequest{}, errors.New("could not close uploaded file")
			}
		} else if !errors.Is(err, http.ErrMissingFile) {
			return processRequest{}, errors.New("invalid uploaded file")
		}
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
	deferRender, err := parseBool(r.FormValue("defer_render"))
	if err != nil {
		return processRequest{}, errors.New("defer_render must be boolean")
	}
	return processRequest{
		URL:          r.FormValue("url"),
		SourceURL:    r.FormValue("source_url"),
		SourcePath:   sourcePath,
		Acknowledged: acknowledged,
		ClipCount:    clipCount,
		LayoutFormat: r.FormValue("layout_format"),
		FacecamSize:  r.FormValue("facecam_size"),
		DeferRender:  deferRender,
	}, nil
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

func normalizeProcessLayoutOptions(layoutFormat, facecamSize string) (string, string, error) {
	layoutFormat = strings.ToLower(strings.TrimSpace(layoutFormat))
	if layoutFormat == "" {
		layoutFormat = "standard"
	}
	if layoutFormat != "standard" && layoutFormat != "streamer_stack" {
		return "", "", fmt.Errorf("invalid layout_format: %s", layoutFormat)
	}

	facecamSize = strings.ToLower(strings.TrimSpace(facecamSize))
	if facecamSize == "" {
		facecamSize = "medium"
	}
	if facecamSize != "small" && facecamSize != "medium" && facecamSize != "large" {
		return "", "", fmt.Errorf("invalid facecam_size: %s", facecamSize)
	}
	return layoutFormat, facecamSize, nil
}
