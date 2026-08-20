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
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/mutonby/openshorts/backend-go/internal/manifests"
	"github.com/mutonby/openshorts/backend-go/internal/media"
	"github.com/mutonby/openshorts/backend-go/internal/versions"
)

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
	case r.Method == http.MethodDelete && len(segments) == 2:
		deleted, currentVersionID, err := store.DeleteVersion(segments[1])
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"detail": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"deleted_version":    deleted,
			"current_version_id": currentVersionID,
		})
	case r.Method == http.MethodGet && len(segments) == 2:
		s.getVersion(w, store, segments[1])
	case r.Method == http.MethodGet && len(segments) == 3 && segments[0] == "versions" && segments[2] == "download":
		s.downloadVersion(w, r, jobID, store, segments[1])
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
		s.clipTranscript(w, r.Context(), jobID, clipIndex)
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
	if videoURL, ok := request.Props["videoUrl"].(string); ok {
		request.Props["videoUrl"] = s.localRenderVideoURL(jobID, videoURL)
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

func (s *Server) localRenderVideoURL(jobID, videoURL string) string {
	if s.s3Store == nil || s.s3Store.Bucket == "" || strings.TrimSpace(videoURL) == "" {
		return videoURL
	}
	parsed, err := url.Parse(videoURL)
	if err != nil || parsed.Path == "" {
		return videoURL
	}
	parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	for index := 0; index+3 < len(parts); index++ {
		if parts[index] != s.s3Store.Bucket || parts[index+1] != jobID || parts[index+2] != "master" {
			continue
		}
		filename := parts[len(parts)-1]
		if filename == "" || filename == "." || filename == ".." || strings.Contains(filename, "\\") {
			return videoURL
		}
		return "/videos/" + jobID + "/" + filename
	}
	return videoURL
}

func (s *Server) downloadVersion(w http.ResponseWriter, r *http.Request, jobID string, store *versions.Store, versionID string) {
	version, err := store.LoadVersion(versionID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": err.Error()})
		return
	}
	if version.Status != versions.RenderStatusDone || version.OutputURL == "" {
		writeJSON(w, http.StatusConflict, map[string]string{"detail": "version has no completed rendered output"})
		return
	}
	parsed, parseErr := url.Parse(version.OutputURL)
	if parseErr != nil || parsed.Path == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "version output URL is invalid"})
		return
	}
	filename := path.Base(parsed.Path)
	if filename == "" || filename == "." || filename == ".." || strings.Contains(filename, "\\") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "version output filename is invalid"})
		return
	}
	if s.s3Store != nil && s.s3Store.Bucket != "" {
		key := jobID + "/master/" + filename
		downloadURL, urlErr := s.s3Store.DirectDownloadURL(r.Context(), key, filename, 2*time.Hour)
		if urlErr != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"detail": fmt.Sprintf("Could not create download URL: %s", urlErr)})
			return
		}
		http.Redirect(w, r, downloadURL, http.StatusTemporaryRedirect)
		return
	}
	http.Redirect(w, r, version.OutputURL, http.StatusTemporaryRedirect)
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
	publishedURL, err := s.publishRenderOutput(r.Context(), request.OutputURL)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": fmt.Sprintf("Could not publish rendered master: %s", err)})
		return
	}
	request.OutputURL = publishedURL
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

func (s *Server) clipTranscript(w http.ResponseWriter, ctx context.Context, jobID string, clipIndex int) {
	root := s.config.OutputDir
	if root == "" {
		root = "output"
	}
	metadataFiles, err := filepath.Glob(filepath.Join(root, jobID, "*_metadata.json"))
	var contents []byte
	if err == nil && len(metadataFiles) > 0 {
		contents, err = os.ReadFile(metadataFiles[0])
	} else if s.s3Store != nil && s.s3Store.Client != nil && s.s3Store.Bucket != "" {
		contents, err = s.s3Store.ReadObject(ctx, jobID+"/master/source_metadata.json")
	}
	if err != nil || len(contents) == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Metadata not found"})
		return
	}
	var data struct {
		Transcript map[string]any `json:"transcript"`
		Shorts     []struct {
			Start float64 `json:"start"`
			End   float64 `json:"end"`
		} `json:"shorts"`
	}
	if err := json.Unmarshal(contents, &data); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid metadata"})
		return
	}
	segments, _ := data.Transcript["segments"].([]any)
	if len(segments) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Transcript not found in metadata"})
		return
	}
	if clipIndex < 0 || clipIndex >= len(data.Shorts) {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Clip not found"})
		return
	}
	clipStart, clipEnd := data.Shorts[clipIndex].Start, data.Shorts[clipIndex].End
	captions := media.BuildSubtitleCues(data.Transcript, clipStart, clipEnd)
	language, _ := data.Transcript["language"].(string)
	if language == "" {
		language = "und"
	}
	writeJSON(w, http.StatusOK, map[string]any{"captions": captions, "durationSec": clipEnd - clipStart, "language": language})
}
