package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/mutonby/openshorts/backend-go/internal/config"
)

type Server struct {
	config config.Config
	mux    *http.ServeMux
}

func NewServer(cfg config.Config) *Server {
	mux := http.NewServeMux()
	server := &Server{config: cfg, mux: mux}
	mux.HandleFunc("/health", server.health)
	mux.HandleFunc("/api/config", server.runtimeConfig)
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

func (s *Server) runtimeConfig(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"port":                s.config.Port,
		"max_concurrent_jobs": s.config.MaxConcurrentJobs,
		"render_service_url":  s.config.RenderServiceURL,
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
