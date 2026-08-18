package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
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
