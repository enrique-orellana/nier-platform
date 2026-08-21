package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"
)

func (s *Server) serveStatic(w http.ResponseWriter, r *http.Request, relative, root string) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
		return
	}
	if relative == "" || strings.Contains(relative, "\\") {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Not found"})
		return
	}
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Not found"})
		return
	}
	candidate := filepath.Join(rootAbs, filepath.FromSlash(relative))
	if !safePath(rootAbs, candidate) {
		writeJSON(w, http.StatusForbidden, map[string]string{"detail": "Invalid path"})
		return
	}
	http.ServeFile(w, r, candidate)
}

func (s *Server) legacyVideoRedirect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
		return
	}
	relative := strings.TrimPrefix(r.URL.Path, "/videos/")
	if relative == "" || strings.Contains(relative, "\\") || path.Clean(relative) != relative || strings.HasPrefix(relative, "../") {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Not found"})
		return
	}
	parts := strings.Split(relative, "/")
	if len(parts) >= 2 && s.s3Store != nil && s.s3Store.Bucket != "" {
		jobID := parts[0]
		filename := path.Base(relative)
		var publishedURL string
		if filename == "source.mp4" || strings.HasPrefix(filename, "master_") || strings.HasSuffix(filename, "_metadata.json") {
			publishedURL = s.directMasterArtifactURL(jobID, filename)
		} else {
			publishedURL = s.directClipArtifactURL(jobID, jobID, filename)
		}
		if strings.HasPrefix(publishedURL, "http://") || strings.HasPrefix(publishedURL, "https://") {
			http.Redirect(w, r, publishedURL, http.StatusTemporaryRedirect)
			return
		}
	}
	target := "/output/" + relative
	if r.URL.RawQuery != "" {
		target += "?" + r.URL.RawQuery
	}
	http.Redirect(w, r, target, http.StatusTemporaryRedirect)
}

func (s *Server) renderProxy(w http.ResponseWriter, r *http.Request) {
	var upstreamPath string
	renderID := ""
	switch {
	case r.Method == http.MethodPost && r.URL.Path == "/api/render":
		upstreamPath = "/render"
	case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/api/render/"):
		upstreamPath = "/render/" + strings.TrimPrefix(r.URL.Path, "/api/render/")
		renderID = strings.TrimPrefix(r.URL.Path, "/api/render/")
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
		contents, err := io.ReadAll(r.Body)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Could not read render request"})
			return
		}
		var payload map[string]any
		if json.Unmarshal(contents, &payload) == nil {
			jobID, _ := payload["jobId"].(string)
			props, _ := payload["props"].(map[string]any)
			videoURL, _ := props["videoUrl"].(string)
			if jobID != "" && videoURL != "" {
				props["videoUrl"] = s.localRenderVideoURL(jobID, videoURL)
				payload["props"] = props
				if renewed, marshalErr := json.Marshal(payload); marshalErr == nil {
					contents = renewed
				}
			}
		}
		body = bytes.NewReader(contents)
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
	contents, err := io.ReadAll(response.Body)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": "Could not read render status"})
		return
	}
	if response.StatusCode >= http.StatusOK && response.StatusCode < http.StatusMultipleChoices {
		var payload map[string]any
		if json.Unmarshal(contents, &payload) == nil {
			status, _ := payload["status"].(string)
			outputURL, _ := payload["outputUrl"].(string)
			if (status == "done" || status == "completed") && outputURL != "" {
				publishedURL, publishErr := s.publishRenderOutput(r.Context(), outputURL, renderID)
				if publishErr != nil {
					writeJSON(w, http.StatusBadGateway, map[string]string{"detail": fmt.Sprintf("Could not publish rendered artifact: %s", publishErr)})
					return
				}
				payload["outputUrl"] = publishedURL
				contents, _ = json.Marshal(payload)
			}
		}
	}
	w.Header().Set("Content-Type", response.Header.Get("Content-Type"))
	w.WriteHeader(response.StatusCode)
	_, _ = w.Write(contents)
}

func (s *Server) publishRenderOutput(ctx context.Context, outputURL, clipID string) (string, error) {
	if s.s3Store == nil || s.s3Store.Client == nil || s.s3Store.Bucket == "" {
		return outputURL, nil
	}
	normalized := strings.ReplaceAll(strings.TrimSpace(outputURL), "\\", "/")
	parsed, err := url.Parse(normalized)
	if err == nil && parsed.Path != "" {
		normalized = parsed.Path
	}
	marker := "/output/"
	markerIndex := strings.Index(normalized, marker)
	if markerIndex < 0 {
		return outputURL, nil
	}
	relative := strings.TrimPrefix(normalized[markerIndex+len(marker):], "/")
	if relative == "" || path.Clean(relative) != relative || strings.Contains(relative, "..") {
		return "", fmt.Errorf("invalid rendered output path")
	}
	parts := strings.Split(relative, "/")
	if len(parts) < 2 || parts[0] == "" || path.Base(relative) == "." {
		return "", fmt.Errorf("invalid rendered output path")
	}
	root := s.config.OutputDir
	if root == "" {
		root = "output"
	}
	localPath := filepath.Join(root, filepath.FromSlash(relative))
	if !safePath(root, localPath) {
		return "", fmt.Errorf("rendered output is outside the output directory")
	}
	if _, err := os.Stat(localPath); err != nil {
		return "", err
	}
	jobID := parts[0]
	filename := path.Base(relative)
	key := jobID + "/master/" + filename
	if filename != "source.mp4" && !strings.HasPrefix(filename, "master_") && !strings.HasSuffix(filename, "_metadata.json") {
		clipID = strings.TrimSpace(clipID)
		if clipID == "" || path.Base(clipID) != clipID {
			return "", fmt.Errorf("missing clip render ID for rendered clip")
		}
		key = jobID + "/clips/" + clipID + "/" + filename
	}
	if err := s.s3Store.UploadFile(ctx, key, localPath, "video/mp4"); err != nil {
		return "", err
	}
	return s.s3Store.DirectObjectURL(ctx, key, 2*time.Hour)
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
