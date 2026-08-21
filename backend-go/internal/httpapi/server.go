package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"path/filepath"
	"strings"
	"sync"

	"github.com/mutonby/openshorts/backend-go/internal/config"
	"github.com/mutonby/openshorts/backend-go/internal/integrations"
	"github.com/mutonby/openshorts/backend-go/internal/jobs"
	"github.com/mutonby/openshorts/backend-go/internal/media"
	"github.com/mutonby/openshorts/backend-go/internal/versions"
)

type OperationClient interface {
	Run(context.Context, string, string, map[string]any, map[string]string) (json.RawMessage, error)
}

type Server struct {
	config              config.Config
	mux                 *http.ServeMux
	store               jobs.Store
	runner              *jobs.Runner
	scheduler           *jobs.Scheduler
	translationRunner   OperationClient
	codexAuth           *integrations.CodexAuth
	mediaRunner         media.CommandRunner
	s3Store             *integrations.S3Store
	artifactURLOverride func(string, string) string
	publicationMu       sync.Mutex
	publishedOutputs    map[string]string
	versionMu           sync.Mutex
	versionStores       map[string]*versions.Store
	highlightMu         sync.Mutex
	highlightRuntime    map[string]map[string]any
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
	server := &Server{config: cfg, mux: mux, store: store, runner: runner, scheduler: scheduler, translationRunner: translationRunner, publishedOutputs: make(map[string]string), versionStores: make(map[string]*versions.Store), highlightRuntime: make(map[string]map[string]any)}
	if runner != nil {
		runner.RuntimeMetadata = server.highlightRuntimeMetadata
		runner.ReleaseRuntimeMetadata = server.releaseHighlightRuntimeMetadata
	}
	server.mediaRunner = media.ExecCommandRunner{}
	if cfg.S3Bucket != "" || cfg.S3Endpoint != "" {
		server.s3Store, _ = integrations.NewS3Store(context.Background(), integrations.S3Config{Endpoint: cfg.S3Endpoint, Region: cfg.S3Region, AccessKey: cfg.S3AccessKey, SecretKey: cfg.S3SecretKey, ForcePathStyle: cfg.S3ForcePathStyle, Bucket: cfg.S3Bucket, SourceBucket: cfg.S3SourceBucket, PublicEndpoint: cfg.S3PublicEndpoint, PublicURLBase: cfg.S3PublicURLBase})
	}
	if cfg.CodexAuthFile != "" {
		server.codexAuth = integrations.NewCodexAuth(integrations.CodexConfig{StorePath: cfg.CodexAuthFile}, nil)
	}
	mux.HandleFunc("/health", server.health)
	mux.HandleFunc("/ready", server.readiness)
	mux.HandleFunc("/videos/", server.legacyVideoRedirect)
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

func (s *Server) staticThumbnail(w http.ResponseWriter, r *http.Request) {
	root := filepath.Join(s.config.OutputDir, "thumbnails")
	s.serveStatic(w, r, strings.TrimPrefix(r.URL.Path, "/thumbnails/"), root)
}
