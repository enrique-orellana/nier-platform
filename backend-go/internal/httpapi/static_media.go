package httpapi

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
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
