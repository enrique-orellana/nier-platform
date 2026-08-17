package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/mutonby/openshorts/backend-go/internal/config"
	"github.com/mutonby/openshorts/backend-go/internal/domain"
	"github.com/mutonby/openshorts/backend-go/internal/integrations"
	"github.com/mutonby/openshorts/backend-go/internal/jobs"
	"github.com/mutonby/openshorts/backend-go/internal/manifests"
	"github.com/mutonby/openshorts/backend-go/internal/media"
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
	scheduler         *jobs.Scheduler
	translationRunner OperationClient
	codexAuth         *integrations.CodexAuth
	mediaRunner       media.CommandRunner
	s3Store           *integrations.S3Store
	versionMu         sync.Mutex
	versionStores     map[string]*versions.Store
	highlightMu       sync.Mutex
	highlightRuntime  map[string]map[string]any
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
	return NewServerWithDependenciesAndScheduler(cfg, store, runner, translationRunner, nil)
}

func NewServerWithDependenciesAndScheduler(cfg config.Config, store jobs.Store, runner *jobs.Runner, translationRunner OperationClient, scheduler *jobs.Scheduler) *Server {
	mux := http.NewServeMux()
	server := &Server{config: cfg, mux: mux, store: store, runner: runner, scheduler: scheduler, translationRunner: translationRunner, versionStores: make(map[string]*versions.Store), highlightRuntime: make(map[string]map[string]any)}
	if runner != nil {
		runner.RuntimeMetadata = server.highlightRuntimeMetadata
		runner.ReleaseRuntimeMetadata = server.releaseHighlightRuntimeMetadata
	}
	server.mediaRunner = media.ExecCommandRunner{}
	if cfg.S3Bucket != "" || cfg.S3Endpoint != "" {
		server.s3Store, _ = integrations.NewS3Store(context.Background(), integrations.S3Config{Endpoint: cfg.S3Endpoint, Region: cfg.S3Region, AccessKey: cfg.S3AccessKey, SecretKey: cfg.S3SecretKey, ForcePathStyle: cfg.S3ForcePathStyle, Bucket: cfg.S3Bucket, SourceBucket: cfg.S3SourceBucket})
	}
	if cfg.CodexAuthFile != "" {
		server.codexAuth = integrations.NewCodexAuth(integrations.CodexConfig{StorePath: cfg.CodexAuthFile}, nil)
	}
	mux.HandleFunc("/health", server.health)
	mux.HandleFunc("/ready", server.readiness)
	mux.HandleFunc("/videos/", server.staticOutput)
	mux.HandleFunc("/thumbnails/", server.staticThumbnail)
	mux.HandleFunc("/gallery", server.galleryPage)
	mux.HandleFunc("/video/", server.videoPage)
	mux.HandleFunc("/api/config", server.runtimeConfig)
	mux.HandleFunc("/api/process", server.process)
	mux.HandleFunc("/api/status/", server.status)
	mux.HandleFunc("/api/jobs/", server.clipRenderRoute)
	mux.HandleFunc("/api/highlights", server.highlights)
	mux.HandleFunc("/api/highlights/", server.highlightRoute)
	mux.HandleFunc("/api/render", server.renderProxy)
	mux.HandleFunc("/api/render/", server.renderProxy)
	mux.HandleFunc("/api/video-proxy", server.videoProxy)
	mux.HandleFunc("/api/video-proxy/", server.videoProxy)
	mux.HandleFunc("/api/translate/languages", server.translationLanguages)
	mux.HandleFunc("/api/ai/lmstudio/discover", server.discoverLMStudio)
	mux.HandleFunc("/api/ai/openai-codex/status", server.codexRoute)
	mux.HandleFunc("/api/ai/openai-codex/connect", server.codexRoute)
	mux.HandleFunc("/api/ai/openai-codex/poll", server.codexRoute)
	mux.HandleFunc("/api/ai/openai-codex/disconnect", server.codexRoute)
	mux.HandleFunc("/api/ai/openai-codex/models", server.codexRoute)
	mux.HandleFunc("/api/social/user", server.socialUser)
	mux.HandleFunc("/api/local-editor/translate", server.createTranslation)
	mux.HandleFunc("/api/local-editor/transcribe", server.transcribeLocalEditor)
	mux.HandleFunc("/api/local-editor/hashtags", server.generateHashtags)
	mux.HandleFunc("/api/local-editor/render", server.renderLocalEditor)
	mux.HandleFunc("/api/local-editor/burn-subtitles", server.burnLocalEditorSubtitles)
	mux.HandleFunc("/api/translation/", server.translationStatus)
	mux.HandleFunc("/api/minio/objects", server.minioObjects)
	mux.HandleFunc("/api/effects/generate", server.legacyJSONRoute("effects"))
	mux.HandleFunc("/api/subtitle", server.subtitle)
	mux.HandleFunc("/api/edit", server.legacyJSONRoute("edit"))
	mux.HandleFunc("/api/hook", server.legacyJSONRoute("hook"))
	mux.HandleFunc("/api/translate", server.translateClip)
	mux.HandleFunc("/api/social/post", server.socialPost)
	mux.HandleFunc("/api/thumbnail/", server.thumbnailRoute)
	mux.HandleFunc("/api/saasshorts/", server.saasRoute)
	mux.HandleFunc("/api/clip/", server.clipRoutes)
	mux.HandleFunc("/api/projects/", server.projectRoutes)
	mux.HandleFunc("/api/projects/history", server.projectHistory)
	mux.HandleFunc("/api/projects/clips/", server.projectClips)
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

func (s *Server) readiness(w http.ResponseWriter, _ *http.Request) {
	if s.store == nil || s.translationRunner == nil || (s.scheduler != nil && !s.scheduler.Started()) {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "not_ready"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

func (s *Server) staticOutput(w http.ResponseWriter, r *http.Request) {
	s.serveStatic(w, r, strings.TrimPrefix(r.URL.Path, "/videos/"), s.config.OutputDir)
}

func (s *Server) staticThumbnail(w http.ResponseWriter, r *http.Request) {
	root := filepath.Join(s.config.OutputDir, "thumbnails")
	s.serveStatic(w, r, strings.TrimPrefix(r.URL.Path, "/thumbnails/"), root)
}

func (s *Server) galleryVideos(ctx context.Context, limit int) ([]map[string]any, error) {
	if s.translationRunner == nil {
		return nil, errors.New("Python worker is not configured")
	}
	result, err := s.translationRunner.Run(ctx, "gallery", "legacy_api", map[string]any{"action": "saas_gallery", "limit": limit, "output_dir": s.config.OutputDir}, nil)
	if err != nil {
		return nil, err
	}
	var payload struct {
		Videos []map[string]any `json:"videos"`
	}
	if err := json.Unmarshal(result, &payload); err != nil {
		return nil, err
	}
	return payload.Videos, nil
}

func (s *Server) galleryPage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
		return
	}
	videos, err := s.galleryVideos(r.Context(), 100)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": err.Error()})
		return
	}
	items := make([]map[string]any, 0, len(videos))
	var body strings.Builder
	body.WriteString(`<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI UGC Video Gallery | OpenShorts</title><meta name="description" content="Browse AI-generated UGC marketing videos for SaaS products."><meta name="robots" content="index, follow"><meta property="og:title" content="AI UGC Video Gallery | OpenShorts"><meta property="og:type" content="website"><meta property="og:description" content="Browse AI-generated UGC marketing videos for SaaS products.">`)
	for _, video := range videos {
		id := firstString(video, "video_id")
		if id == "" {
			continue
		}
		title := firstString(video, "title")
		product := firstString(video, "product_name")
		caption := firstString(video, "caption")
		mode := firstString(video, "video_mode")
		modeLabel := "PREMIUM"
		if mode == "lowcost" {
			modeLabel = "LOW COST"
		}
		items = append(items, map[string]any{"@type": "ListItem", "position": len(items) + 1, "url": "/video/" + id, "name": title})
		body.WriteString(`<article class="card"><a href="/video/` + html.EscapeString(url.PathEscape(id)) + `"><div class="preview"><video src="` + html.EscapeString(firstString(video, "video_url")) + `" poster="` + html.EscapeString(firstString(video, "actor_url")) + `" muted playsinline preload="metadata"></video><span class="mode">` + modeLabel + `</span></div><h2>` + html.EscapeString(title) + `</h2><p>` + html.EscapeString(fmt.Sprintf("%.0fs · %s", metadataFloat(video["duration"]), product)) + `</p><small>` + html.EscapeString(caption) + `</small></a></article>`)
	}
	ldJSON := map[string]any{"@context": "https://schema.org", "@type": "CollectionPage", "name": "AI UGC Video Gallery", "mainEntity": map[string]any{"@type": "ItemList", "numberOfItems": len(items), "itemListElement": items}}
	body.WriteString(`<style>*{box-sizing:border-box}body{background:#0a0a0c;color:#e4e4e7;font-family:system-ui,sans-serif;margin:0}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:20px;padding:20px;max-width:1400px;margin:auto}.card{background:#18181b;border:1px solid #27272a;border-radius:16px;overflow:hidden}.card a{color:inherit;text-decoration:none}.preview{position:relative;aspect-ratio:9/16;background:#000}.preview video{width:100%;height:100%;object-fit:cover}.mode{position:absolute;top:8px;right:8px;background:#8b5cf6;color:white;padding:2px 8px;border-radius:9999px;font-size:10px;font-weight:700}.card h2{font-size:14px;margin:12px 12px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.card p,.card small{display:block;color:#71717a;margin:0 12px 8px;font-size:11px}.card small{height:30px;overflow:hidden}nav{padding:20px 40px;border-bottom:1px solid #27272a;display:flex;justify-content:space-between}h1{text-align:center;padding:30px 20px 0}.cta{background:#8b5cf6;color:#fff;padding:10px 24px;border-radius:12px;text-decoration:none}</style></head><body><nav><strong>OpenShorts</strong><a class="cta" href="/">Create Your Video</a></nav><h1>AI-Generated UGC Videos</h1><p style="text-align:center;color:#71717a">` + fmt.Sprintf("%d videos generated · Low Cost & Premium modes", len(videos)) + `</p><main class="grid">`)
	body.WriteString(`</main><div style="text-align:center;padding:40px"><a class="cta" href="/">Create Your Own UGC Video</a></div><script type="application/ld+json">` + safeJSON(ldJSON) + `</script></body></html>`)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(body.String()))
}

func (s *Server) videoPage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
		return
	}
	id := strings.Trim(strings.TrimPrefix(r.URL.Path, "/video/"), "/")
	if id == "" || strings.Contains(id, "/") {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Video not found"})
		return
	}
	videos, err := s.galleryVideos(r.Context(), 200)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": err.Error()})
		return
	}
	var selected map[string]any
	for _, video := range videos {
		if firstString(video, "video_id") == id {
			selected = video
			break
		}
	}
	if selected == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Video not found"})
		return
	}
	title := firstString(selected, "title")
	hashtags := strings.Join(metadataStrings(selected["hashtags"]), " ")
	cost := metadataNestedFloat(selected, "cost_estimate", "total")
	language := firstString(selected, "language")
	if language == "" {
		language = "en"
	}
	ldJSON := map[string]any{"@context": "https://schema.org", "@type": "VideoObject", "name": title, "description": firstString(selected, "caption"), "thumbnailUrl": firstString(selected, "actor_url"), "contentUrl": firstString(selected, "video_url"), "uploadDate": firstString(selected, "created_at"), "duration": fmt.Sprintf("PT%dS", int(metadataFloat(selected["duration"]))), "width": 1080, "height": 1920, "inLanguage": language}
	body := `<!doctype html><html lang="` + html.EscapeString(language) + `"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>` + html.EscapeString(title) + ` - AI UGC Video | OpenShorts</title><meta name="description" content="` + html.EscapeString(firstString(selected, "caption")+" "+hashtags) + `"><meta property="og:type" content="video.other"><meta property="og:title" content="` + html.EscapeString(title) + `"><meta property="og:description" content="` + html.EscapeString(firstString(selected, "caption")) + `"><meta property="og:video" content="` + html.EscapeString(firstString(selected, "video_url")) + `"><meta property="og:video:type" content="video/mp4"><meta property="og:video:width" content="1080"><meta property="og:video:height" content="1920"><meta property="og:image" content="` + html.EscapeString(firstString(selected, "actor_url")) + `"><meta name="twitter:card" content="player"><meta name="twitter:title" content="` + html.EscapeString(title) + `"><meta name="twitter:image" content="` + html.EscapeString(firstString(selected, "actor_url")) + `"><script type="application/ld+json">` + safeJSON(ldJSON) + `</script><style>*{box-sizing:border-box}body{background:#0a0a0c;color:#e4e4e7;font-family:system-ui,sans-serif;margin:0}nav{padding:20px 40px;border-bottom:1px solid #27272a}nav a{color:#a1a1aa}.container{max-width:1000px;margin:auto;padding:40px 20px;display:grid;grid-template-columns:1fr 1fr;gap:40px}@media(max-width:768px){.container{grid-template-columns:1fr}}video{width:100%;border-radius:16px;background:#000}.section{margin:20px 0}.section h2{font-size:13px;color:#71717a;text-transform:uppercase}.section p{font-size:14px;line-height:1.6}.cta{display:inline-block;background:#8b5cf6;color:#fff;padding:10px 24px;border-radius:12px;text-decoration:none}</style></head><body><nav><a href="/gallery">Gallery</a></nav><main class="container"><div><video src="` + html.EscapeString(firstString(selected, "video_url")) + `" poster="` + html.EscapeString(firstString(selected, "actor_url")) + `" controls autoplay playsinline style="aspect-ratio:9/16;object-fit:cover"></video></div><div><h1>` + html.EscapeString(title) + `</h1><p>` + html.EscapeString(fmt.Sprintf("%.0fs · %s · $%.2f · %s", metadataFloat(selected["duration"]), map[bool]string{true: "Low Cost", false: "Premium"}[firstString(selected, "video_mode") == "lowcost"], cost, firstString(selected, "product_name"))) + `</p><div class="section"><h2>Caption</h2><p>` + html.EscapeString(firstString(selected, "caption")) + `</p><p>` + html.EscapeString(hashtags) + `</p></div><div class="section"><h2>Script</h2><p>` + html.EscapeString(firstString(selected, "full_narration")) + `</p></div><div class="section"><h2>Actor</h2><p>` + html.EscapeString(firstString(selected, "actor_description")) + `</p></div>`
	if productURL := firstString(selected, "product_url"); productURL != "" {
		body += `<div class="section"><h2>Product</h2><p><a href="` + html.EscapeString(productURL) + `" target="_blank">` + html.EscapeString(firstString(selected, "product_name")) + `</a></p></div>`
	}
	body += `<a href="/gallery">← Back to Gallery</a><br><a class="cta" href="/">Create Your Own</a></div></main></body></html>`
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(body))
}

func safeJSON(value any) string {
	encoded, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return strings.NewReplacer("<", "\\u003c", ">", "\\u003e", "&", "\\u0026").Replace(string(encoded))
}

func metadataFloat(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case json.Number:
		parsed, _ := typed.Float64()
		return parsed
	default:
		return 0
	}
}

func metadataNestedFloat(value map[string]any, key, nested string) float64 {
	child, _ := value[key].(map[string]any)
	return metadataFloat(child[nested])
}

func metadataStrings(value any) []string {
	result := []string{}
	switch typed := value.(type) {
	case []string:
		return typed
	case []any:
		for _, item := range typed {
			if text, ok := item.(string); ok {
				result = append(result, text)
			}
		}
	}
	return result
}

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

func (s *Server) subtitle(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
		return
	}
	var request struct {
		JobID           string  `json:"job_id"`
		ClipIndex       int     `json:"clip_index"`
		Position        string  `json:"position"`
		FontSize        int     `json:"font_size"`
		FontName        string  `json:"font_name"`
		FontColor       string  `json:"font_color"`
		BorderColor     string  `json:"border_color"`
		BorderWidth     int     `json:"border_width"`
		Background      string  `json:"bg_color"`
		BackgroundAlpha float64 `json:"bg_opacity"`
		InputFilename   string  `json:"input_filename"`
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
	filename := request.InputFilename
	if filename == "" {
		filename = filepath.Base(strings.Split(strings.TrimPrefix(firstString(clip, "video_url", "url"), "/videos/"), "?")[0])
	}
	root := filepath.Join(s.config.OutputDir, request.JobID)
	inputPath := filepath.Join(root, filename)
	if filename == "" || !safePath(root, inputPath) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid input filename"})
		return
	}
	if _, err := os.Stat(inputPath); errors.Is(err, os.ErrNotExist) {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Video file not found"})
		return
	}
	metadataPath, err := firstMetadataPath(root)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Metadata not found"})
		return
	}
	var metadata struct {
		Transcript map[string]any `json:"transcript"`
		Shorts     []struct {
			Start float64 `json:"start"`
			End   float64 `json:"end"`
		} `json:"shorts"`
	}
	contents, err := os.ReadFile(metadataPath)
	if err != nil || json.Unmarshal(contents, &metadata) != nil || request.ClipIndex >= len(metadata.Shorts) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid metadata"})
		return
	}
	srt, err := media.BuildWordSRT(metadata.Transcript, metadata.Shorts[request.ClipIndex].Start, metadata.Shorts[request.ClipIndex].End)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": err.Error()})
		return
	}
	srtFile, err := os.CreateTemp(root, ".subtitle-*.srt")
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": err.Error()})
		return
	}
	srtPath := srtFile.Name()
	defer os.Remove(srtPath)
	if _, err := srtFile.WriteString(srt); err != nil {
		_ = srtFile.Close()
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": err.Error()})
		return
	}
	if err := srtFile.Close(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": err.Error()})
		return
	}
	outputFilename := "subtitled_" + filename
	outputPath := filepath.Join(root, outputFilename)
	if err := media.BurnSubtitles(r.Context(), s.mediaRunner, inputPath, srtPath, outputPath, media.SubtitleStyle{Alignment: request.Position, FontSize: request.FontSize, FontName: request.FontName, FontColor: request.FontColor, BorderColor: request.BorderColor, BorderWidth: request.BorderWidth, BackgroundColor: request.Background, BackgroundAlpha: request.BackgroundAlpha}); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": err.Error()})
		return
	}
	if _, err := os.Stat(outputPath); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": "FFmpeg did not produce an output video"})
		return
	}
	videoURL := "/videos/" + request.JobID + "/" + outputFilename
	result.Clips[request.ClipIndex]["video_url"] = videoURL
	if encoded, marshalErr := json.Marshal(result); marshalErr == nil {
		_ = s.store.SetResult(r.Context(), request.JobID, encoded)
	}
	metadataData := map[string]any{}
	if json.Unmarshal(contents, &metadataData) == nil {
		if shorts, ok := metadataData["shorts"].([]any); ok && request.ClipIndex < len(shorts) {
			if item, ok := shorts[request.ClipIndex].(map[string]any); ok {
				item["video_url"] = videoURL
			}
		}
		if encoded, marshalErr := json.MarshalIndent(metadataData, "", "  "); marshalErr == nil {
			_ = os.WriteFile(metadataPath, encoded, 0o644)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "new_video_url": videoURL})
}

func (s *Server) translateClip(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
		return
	}
	apiKey := strings.TrimSpace(r.Header.Get("X-ElevenLabs-Key"))
	if apiKey == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Missing X-ElevenLabs-Key header"})
		return
	}
	var request struct {
		JobID          string `json:"job_id"`
		ClipIndex      int    `json:"clip_index"`
		TargetLanguage string `json:"target_language"`
		SourceLanguage string `json:"source_language"`
		InputFilename  string `json:"input_filename"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid JSON request body"})
		return
	}
	if request.TargetLanguage == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "target_language is required"})
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
	if json.Unmarshal(job.Result, &result) != nil || request.ClipIndex < 0 || request.ClipIndex >= len(result.Clips) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Job result not available"})
		return
	}
	clip := result.Clips[request.ClipIndex]
	filename := request.InputFilename
	if filename == "" {
		filename = filepath.Base(strings.Split(strings.TrimPrefix(firstString(clip, "video_url", "url"), "/videos/"), "?")[0])
	}
	root := filepath.Join(s.config.OutputDir, request.JobID)
	inputPath := filepath.Join(root, filename)
	if filename == "" || !safePath(root, inputPath) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid input filename"})
		return
	}
	video, err := os.ReadFile(inputPath)
	if errors.Is(err, os.ErrNotExist) {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Video file not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": err.Error()})
		return
	}
	outputFilename := "translated_" + request.TargetLanguage + "_" + filename
	outputPath := filepath.Join(root, outputFilename)
	client := integrations.ElevenLabsClient{BaseURL: s.config.ElevenLabsURL, HTTP: &http.Client{Timeout: 120 * time.Second}}
	if err := client.TranslateFile(r.Context(), filename, video, request.TargetLanguage, request.SourceLanguage, apiKey, outputPath); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": err.Error()})
		return
	}
	videoURL := "/videos/" + request.JobID + "/" + outputFilename
	result.Clips[request.ClipIndex]["video_url"] = videoURL
	if encoded, marshalErr := json.Marshal(result); marshalErr == nil {
		_ = s.store.SetResult(r.Context(), request.JobID, encoded)
	}
	if metadataPath, metadataErr := firstMetadataPath(root); metadataErr == nil {
		if content, readErr := os.ReadFile(metadataPath); readErr == nil {
			document := map[string]any{}
			if json.Unmarshal(content, &document) == nil {
				if shorts, ok := document["shorts"].([]any); ok && request.ClipIndex < len(shorts) {
					if item, ok := shorts[request.ClipIndex].(map[string]any); ok {
						item["video_url"] = videoURL
					}
				}
				if encoded, marshalErr := json.MarshalIndent(document, "", "  "); marshalErr == nil {
					_ = os.WriteFile(metadataPath, encoded, 0o644)
				}
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "new_video_url": videoURL})
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
	if strings.EqualFold(strings.TrimSpace(r.Header.Get("X-AI-Transcription-Provider")), "openrouter") &&
		strings.TrimSpace(r.Header.Get("X-AI-Api-Key")) == "" && strings.TrimSpace(r.Header.Get("X-Gemini-Key")) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"detail": "OpenRouter API key is required when OpenRouter transcription is selected.",
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
		"X-AI-Transcription-Provider", "X-AI-Transcription-Model",
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
	if len(segments) < 1 || (segments[0] != "versions" && segments[0] != "manifest" && segments[0] != "transcript" && segments[0] != "video-url") {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Not found"})
		return
	}
	store, err := s.versionStore(jobID, clipIndex)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Could not initialize version store"})
		return
	}

	switch {
	case r.Method == http.MethodPost && len(segments) == 1 && segments[0] == "video-url":
		s.legacyJSONRouteWithExtras("clip_video_url", map[string]any{"job_id": jobID, "clip_index": clipIndex})(w, r)
	case r.Method == http.MethodPost && len(segments) == 4 && segments[0] == "versions" && segments[2] == "subtitle-tracks" && segments[3] == "translate":
		s.legacyJSONRouteWithExtras("subtitle_track_translate", map[string]any{"job_id": jobID, "clip_index": clipIndex, "version_id": segments[1]})(w, r)
	case r.Method == http.MethodGet && len(segments) == 1 && segments[0] == "versions":
		s.listVersions(w, store)
	case r.Method == http.MethodPost && len(segments) == 1 && segments[0] == "versions":
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
	case r.Method == http.MethodGet && len(segments) == 1 && segments[0] == "manifest":
		s.getManifest(w, jobID, clipIndex)
	case r.Method == http.MethodPatch && len(segments) == 1 && segments[0] == "manifest":
		s.patchManifest(w, r, jobID, clipIndex)
	case r.Method == http.MethodGet && len(segments) == 1 && segments[0] == "transcript":
		s.clipTranscript(w, jobID, clipIndex)
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

func (s *Server) manifestPath(jobID string, clipIndex int) (string, error) {
	root := s.config.OutputDir
	if root == "" {
		root = "output"
	}
	root, err := filepath.Abs(filepath.Join(root, jobID))
	if err != nil {
		return "", err
	}
	if job, ok := s.store.Get(context.Background(), jobID); ok && len(job.Result) > 0 {
		var result struct {
			Clips []map[string]any `json:"clips"`
		}
		if json.Unmarshal(job.Result, &result) == nil && clipIndex < len(result.Clips) {
			if relative, ok := result.Clips[clipIndex]["manifest_path"].(string); ok && relative != "" {
				candidate := filepath.Join(root, filepath.FromSlash(relative))
				if safePath(root, candidate) {
					return candidate, nil
				}
				return "", errors.New("invalid clip manifest path")
			}
		}
	}
	for _, candidate := range []string{
		filepath.Join(root, fmt.Sprintf("clip_%d", clipIndex), "manifest.json"),
		filepath.Join(root, fmt.Sprintf("manifest_%d.json", clipIndex)),
		filepath.Join(root, "manifests", fmt.Sprintf("clip_%d.json", clipIndex)),
		filepath.Join(root, "manifests", fmt.Sprintf("clip_%d.json", clipIndex+1)),
	} {
		if _, err := os.Stat(candidate); err == nil {
			return candidate, nil
		}
	}
	return "", os.ErrNotExist
}

func safePath(root, candidate string) bool {
	rootAbs, rootErr := filepath.Abs(root)
	candidateAbs, candidateErr := filepath.Abs(candidate)
	if rootErr != nil || candidateErr != nil {
		return false
	}
	relative, err := filepath.Rel(rootAbs, candidateAbs)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

func (s *Server) getManifest(w http.ResponseWriter, jobID string, clipIndex int) {
	path, err := s.manifestPath(jobID, clipIndex)
	if errors.Is(err, os.ErrNotExist) {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Clip has no render manifest"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": err.Error()})
		return
	}
	manifest, err := manifests.Load(path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": err.Error()})
		return
	}
	revision, err := manifests.CalculateRevision(manifest)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": err.Error()})
		return
	}
	masterCurrent := false
	if master, ok := manifest["master"]; ok && master != nil {
		masterCurrent = true
	}
	writeJSON(w, http.StatusOK, map[string]any{"manifest": manifest, "revision": revision, "master_current": masterCurrent})
}

func (s *Server) patchManifest(w http.ResponseWriter, r *http.Request, jobID string, clipIndex int) {
	path, err := s.manifestPath(jobID, clipIndex)
	if errors.Is(err, os.ErrNotExist) {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Clip has no render manifest"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": err.Error()})
		return
	}
	manifest, err := manifests.Load(path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": err.Error()})
		return
	}
	var request struct {
		Layers map[string]any `json:"layers"`
		Audio  map[string]any `json:"audio"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid JSON request body"})
		return
	}
	if request.Layers != nil {
		manifest["layers"] = request.Layers
	}
	if request.Audio != nil {
		layers, _ := manifest["layers"].(map[string]any)
		if layers == nil {
			layers = make(map[string]any)
		}
		layers["audio"] = request.Audio
		manifest["layers"] = layers
	}
	manifest["master"] = nil
	revision, err := manifests.SaveAtomic(path, manifest)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "manifest": manifest, "revision": revision, "master_current": false})
}

func (s *Server) clipTranscript(w http.ResponseWriter, jobID string, clipIndex int) {
	root := s.config.OutputDir
	if root == "" {
		root = "output"
	}
	metadataFiles, err := filepath.Glob(filepath.Join(root, jobID, "*_metadata.json"))
	if err != nil || len(metadataFiles) == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Metadata not found"})
		return
	}
	contents, err := os.ReadFile(metadataFiles[0])
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Metadata not found"})
		return
	}
	var data struct {
		Transcript struct {
			Language string `json:"language"`
			Segments []struct {
				Words []struct {
					Word  string  `json:"word"`
					Start float64 `json:"start"`
					End   float64 `json:"end"`
				} `json:"words"`
			} `json:"segments"`
		} `json:"transcript"`
		Shorts []struct {
			Start float64 `json:"start"`
			End   float64 `json:"end"`
		} `json:"shorts"`
	}
	if err := json.Unmarshal(contents, &data); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid metadata"})
		return
	}
	if data.Transcript.Language == "" || len(data.Transcript.Segments) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Transcript not found in metadata"})
		return
	}
	if clipIndex < 0 || clipIndex >= len(data.Shorts) {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Clip not found"})
		return
	}
	clipStart, clipEnd := data.Shorts[clipIndex].Start, data.Shorts[clipIndex].End
	captions := make([]map[string]any, 0)
	for _, segment := range data.Transcript.Segments {
		for _, word := range segment.Words {
			if word.End <= clipStart || word.Start >= clipEnd {
				continue
			}
			captions = append(captions, map[string]any{
				"text":    strings.TrimSpace(word.Word),
				"startMs": int(maxFloat(0, word.Start-clipStart) * 1000),
				"endMs":   int(maxFloat(0, word.End-clipStart) * 1000),
			})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"captions": captions, "durationSec": clipEnd - clipStart, "language": data.Transcript.Language})
}

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
		s.getProjectStatuses(w, jobID)
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
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
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
	clips, _, ok := s.readProjectClips(jobID)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Project not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"clips": clips})
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
			if _, exists := clip["video_url"]; !exists {
				clip["video_url"] = "/videos/" + jobID + "/" + filename
			}
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

func (s *Server) projectStatusPath(jobID string) string {
	root := s.config.OutputDir
	if root == "" {
		root = "output"
	}
	return filepath.Join(root, jobID, "clip_statuses.json")
}

func (s *Server) getProjectStatuses(w http.ResponseWriter, jobID string) {
	path := s.projectStatusPath(jobID)
	contents, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		writeJSON(w, http.StatusOK, map[string]any{"clips": map[string]any{}})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": err.Error()})
		return
	}
	var document map[string]any
	if err := json.Unmarshal(contents, &document); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Invalid project status document"})
		return
	}
	writeJSON(w, http.StatusOK, document)
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
	updatedAt := time.Now().UTC().Format(time.RFC3339Nano)
	document := map[string]any{"clips": map[string]any{}}
	if contents, err := os.ReadFile(s.projectStatusPath(job.ID)); err == nil {
		_ = json.Unmarshal(contents, &document)
	}
	clips, _ := document["clips"].(map[string]any)
	if clips == nil {
		clips = make(map[string]any)
	}
	clips[strconv.Itoa(clipIndex)] = map[string]any{"status": request.Status, "updated_at": updatedAt}
	document["clips"] = clips
	if err := s.writeProjectStatus(job.ID, document); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"job_id": job.ID, "clip_index": clipIndex, "status": request.Status, "updated_at": updatedAt})
}

func (s *Server) writeProjectStatus(jobID string, document map[string]any) error {
	path := s.projectStatusPath(jobID)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".clip-status-*.tmp")
	if err != nil {
		return err
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	encoded, err := json.MarshalIndent(document, "", "  ")
	if err != nil {
		_ = temporary.Close()
		return err
	}
	if _, err := temporary.Write(encoded); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryName, path)
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
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "job_id": jobID, "s3_deleted_count": s3Deleted})
}

func firstMetadataPath(root string) (string, error) {
	files, err := filepath.Glob(filepath.Join(root, "*_metadata.json"))
	if err != nil || len(files) == 0 {
		return "", os.ErrNotExist
	}
	return files[0], nil
}

func (s *Server) legacyJSONRoute(action string) http.HandlerFunc {
	return s.legacyJSONRouteWithExtras(action, nil)
}

func (s *Server) legacyJSONRouteWithExtras(action string, extras map[string]any) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost && r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
			return
		}
		if s.translationRunner == nil {
			writeJSON(w, http.StatusNotImplemented, map[string]string{"detail": "Python worker is not configured"})
			return
		}
		payload := make(map[string]any)
		if r.Method == http.MethodPost && r.Body != nil {
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil && err != io.EOF {
				writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid JSON request body"})
				return
			}
		}
		for key, value := range extras {
			payload[key] = value
		}
		if action == "minio_objects" {
			payload["search"] = r.URL.Query().Get("search")
			payload["limit"] = r.URL.Query().Get("limit")
			payload["continuation_token"] = r.URL.Query().Get("continuation_token")
		}
		payload["action"] = action
		payload["output_dir"] = s.config.OutputDir
		result, err := s.translationRunner.Run(r.Context(), action+"-"+fmt.Sprint(payload["job_id"]), "legacy_api", payload, translationHeaders(r))
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"detail": err.Error()})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(result)
	}
}

func (s *Server) thumbnailRoute(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/thumbnail/"), "/"), "/")
	action := parts[0]
	extras := map[string]any{}
	if action == "projects" && len(parts) > 1 {
		switch {
		case parts[1] == "migrate-legacy":
			action = "projects_migrate_legacy"
		case len(parts) >= 4 && parts[3] == "files":
			if r.Method == http.MethodPatch {
				action = "project_file_update"
			} else {
				action = "project_file_delete"
			}
			extras["session_id"], extras["project_slug"], extras["file_path"] = parts[1], parts[2], strings.Join(parts[4:], "/")
		case len(parts) >= 3:
			if r.Method == http.MethodPatch {
				action = "project_update"
			} else {
				action = "project_delete"
			}
			extras["session_id"], extras["project_slug"] = parts[1], parts[2]
		}
	}
	if action == "save" {
		action = "project_save"
	}
	if action == "publish" && len(parts) == 3 && parts[1] == "status" {
		action = "publish_status"
		extras["publish_id"] = parts[2]
	}
	if action == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Not found"})
		return
	}
	if r.Method == http.MethodGet {
		payload := map[string]any{"action": "thumbnail_" + action, "output_dir": s.config.OutputDir, "limit": r.URL.Query().Get("limit")}
		for key, value := range extras {
			payload[key] = value
		}
		s.legacyWorkerPayload(w, r, "thumbnail_"+action, payload)
		return
	}
	if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/") {
		if err := r.ParseMultipartForm(64 << 20); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid multipart request"})
			return
		}
		payload := map[string]any{"action": "thumbnail_" + action, "output_dir": s.config.OutputDir}
		for key, value := range extras {
			payload[key] = value
		}
		if err := os.MkdirAll(filepath.Join(s.config.OutputDir, ".uploads"), 0o755); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Could not create upload directory"})
			return
		}
		for key, values := range r.MultipartForm.Value {
			if len(values) > 0 {
				payload[key] = values[0]
			}
		}
		for field, headers := range r.MultipartForm.File {
			if len(headers) == 0 {
				continue
			}
			file, err := headers[0].Open()
			if err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Could not read uploaded file"})
				return
			}
			temporary, err := os.CreateTemp(filepath.Join(s.config.OutputDir, ".uploads"), "thumbnail-")
			if err != nil {
				_ = file.Close()
				writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Could not save uploaded file"})
				return
			}
			_, copyErr := io.Copy(temporary, file)
			_ = file.Close()
			_ = temporary.Close()
			if copyErr != nil {
				_ = os.Remove(temporary.Name())
				writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Could not save uploaded file"})
				return
			}
			payload[field+"_path"] = temporary.Name()
			if action == "upload" && field == "file" {
				payload["file_path"] = temporary.Name()
			}
			if action == "analyze" && field == "file" {
				payload["video_path"] = temporary.Name()
			}
		}
		if action == "publish" {
			if s.translationRunner == nil {
				writeJSON(w, http.StatusNotImplemented, map[string]string{"detail": "Python worker is not configured"})
				return
			}
			publishID, err := newPublishID()
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Could not create publish job"})
				return
			}
			payload["publish_id"] = publishID
			headers := translationHeaders(r)
			go s.runThumbnailPublish(payload, headers, publishID)
			writeJSON(w, http.StatusAccepted, map[string]string{"publish_id": publishID, "status": "uploading"})
			return
		}
		s.legacyWorkerPayload(w, r, "thumbnail_"+action, payload)
		return
	}
	s.legacyJSONRouteWithExtras("thumbnail_"+action, extras)(w, r)
}

func newPublishID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	hex := fmt.Sprintf("%x", value)
	return hex[:8] + "-" + hex[8:12] + "-" + hex[12:16] + "-" + hex[16:20] + "-" + hex[20:], nil
}

func (s *Server) runThumbnailPublish(payload map[string]any, headers map[string]string, publishID string) {
	_, err := s.translationRunner.Run(context.Background(), "thumbnail-"+publishID, "legacy_api", payload, headers)
	if err != nil {
		root := s.config.OutputDir
		if root == "" {
			root = "output"
		}
		_ = os.MkdirAll(root, 0o755)
		state := map[string]any{"publish_id": publishID, "status": "failed", "result": nil, "error": err.Error()}
		if encoded, marshalErr := json.Marshal(state); marshalErr == nil {
			_ = os.WriteFile(filepath.Join(root, ".thumbnail_publish_"+publishID+".json"), encoded, 0o644)
		}
	}
}

func (s *Server) saasRoute(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/saasshorts/"), "/"), "/")
	action := strings.ReplaceAll(parts[0], "-", "_")
	extras := map[string]any{}
	if action == "status" && len(parts) == 2 {
		action = "status"
		extras["job_id"] = parts[1]
	}
	if action == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Not found"})
		return
	}
	if r.Method == http.MethodGet {
		payload := map[string]any{"action": "saas_" + action, "output_dir": s.config.OutputDir}
		for key, value := range extras {
			payload[key] = value
		}
		if value := r.URL.Query().Get("limit"); value != "" {
			payload["limit"] = value
		}
		s.legacyWorkerPayload(w, r, "saas_"+action, payload)
		return
	}
	if action == "actor_upload" && strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/") {
		if err := r.ParseMultipartForm(64 << 20); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid multipart request"})
			return
		}
		files := r.MultipartForm.File["file"]
		if len(files) == 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "File is required"})
			return
		}
		if err := os.MkdirAll(filepath.Join(s.config.OutputDir, ".uploads"), 0o755); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": err.Error()})
			return
		}
		file, err := files[0].Open()
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Could not read uploaded file"})
			return
		}
		temporary, err := os.CreateTemp(filepath.Join(s.config.OutputDir, ".uploads"), "actor-")
		if err != nil {
			_ = file.Close()
			writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": err.Error()})
			return
		}
		_, copyErr := io.Copy(temporary, file)
		_ = file.Close()
		_ = temporary.Close()
		if copyErr != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": copyErr.Error()})
			return
		}
		s.legacyWorkerPayload(w, r, "saas_actor_upload", map[string]any{"action": "saas_actor_upload", "output_dir": s.config.OutputDir, "file_path": temporary.Name()})
		return
	}
	s.legacyJSONRouteWithExtras("saas_"+action, extras)(w, r)
}

func (s *Server) legacyWorkerPayload(w http.ResponseWriter, r *http.Request, id string, payload map[string]any) {
	if s.translationRunner == nil {
		writeJSON(w, http.StatusNotImplemented, map[string]string{"detail": "Python worker is not configured"})
		return
	}
	result, err := s.translationRunner.Run(r.Context(), id, "legacy_api", payload, translationHeaders(r))
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": err.Error()})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(result)
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
