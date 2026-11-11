package httpapi

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

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
		if action == "clip_video_url" {
			if renderJobID, ok := payload["render_job_id"].(string); ok {
				if clipIndex, ok := payload["clip_index"].(int); ok {
					if err := s.persistClipRenderJobID(r.Context(), fmt.Sprint(payload["job_id"]), clipIndex, renderJobID); err != nil {
						writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Could not persist clip render ID"})
						return
					}
				}
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(result)
	}
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
