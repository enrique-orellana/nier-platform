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
	if len(segments) < 1 || (segments[0] != "versions" && segments[0] != "manifest" && segments[0] != "transcript" && segments[0] != "video-url" && segments[0] != "persist-subtitles") {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Not found"})
		return
	}
	switch {
	case r.Method == http.MethodPost && len(segments) == 1 && segments[0] == "video-url":
		s.legacyJSONRouteWithExtras("clip_video_url", map[string]any{"job_id": jobID, "clip_index": clipIndex})(w, r)
	case r.Method == http.MethodPost && len(segments) == 1 && segments[0] == "persist-subtitles":
		s.persistSubtitles(w, r, jobID, clipIndex)
	case r.Method == http.MethodPost && len(segments) == 4 && segments[0] == "versions" && segments[2] == "subtitle-tracks" && segments[3] == "translate":
		s.legacyJSONRouteWithExtras("subtitle_track_translate", map[string]any{"job_id": jobID, "clip_index": clipIndex, "version_id": segments[1]})(w, r)
	case r.Method == http.MethodGet && len(segments) == 1 && segments[0] == "versions":
		s.listVersions(w, r.Context(), jobID, clipIndex)
	case r.Method == http.MethodPost && len(segments) == 1 && segments[0] == "versions":
		s.createVersion(w, r, jobID, clipIndex)
	case r.Method == http.MethodPost && len(segments) == 2 && segments[1] == "branch":
		s.branchVersion(w, r, jobID, clipIndex)
	case r.Method == http.MethodPut && len(segments) == 2:
		s.updateVersion(w, r, jobID, clipIndex, segments[1])
	case r.Method == http.MethodDelete && len(segments) == 2:
		deleted, currentVersionID, err := s.versionRepository.Delete(r.Context(), jobID, clipIndex, segments[1])
		if err != nil {
			status := http.StatusNotFound
			if errors.Is(err, versions.ErrVersionHasChildren) {
				status = http.StatusConflict
			}
			writeJSON(w, status, map[string]string{"detail": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"deleted_version":    deleted,
			"current_version_id": currentVersionID,
		})
	case r.Method == http.MethodGet && len(segments) == 2:
		s.getVersion(w, r.Context(), jobID, clipIndex, segments[1])
	case r.Method == http.MethodGet && len(segments) == 3 && segments[0] == "versions" && segments[2] == "download":
		s.downloadVersion(w, r, jobID, clipIndex, segments[1])
	case r.Method == http.MethodGet && len(segments) == 3 && segments[0] == "versions" && segments[2] == "preview":
		s.previewVersion(w, r, jobID, clipIndex, segments[1])
	case r.Method == http.MethodPost && len(segments) == 3 && segments[2] == "render":
		s.renderVersion(w, r, jobID, clipIndex, segments[1])
	case r.Method == http.MethodPost && len(segments) == 3 && segments[2] == "complete":
		s.completeVersion(w, r, jobID, clipIndex, segments[1])
	case r.Method == http.MethodPost && len(segments) == 3 && segments[2] == "activate":
		s.activateVersion(w, r.Context(), jobID, clipIndex, segments[1])
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

func (s *Server) listVersions(w http.ResponseWriter, ctx context.Context, jobID string, clipIndex int) {
	currentVersionID, versionsList, err := s.versionRepository.List(ctx, jobID, clipIndex)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"current_version_id": currentVersionID,
		"versions":           versionsList,
	})
}

func (s *Server) createVersion(w http.ResponseWriter, r *http.Request, jobID string, clipIndex int) {
	var request struct {
		Manifest        map[string]any `json:"manifest"`
		ParentVersionID *string        `json:"parent_version_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid JSON request body"})
		return
	}
	version, manifest, err := s.versionRepository.Create(r.Context(), jobID, clipIndex, request.Manifest, request.ParentVersionID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"version": version, "manifest": manifest})
}

func (s *Server) branchVersion(w http.ResponseWriter, r *http.Request, jobID string, clipIndex int) {
	var request struct {
		VersionID string         `json:"version_id"`
		Manifest  map[string]any `json:"manifest"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid JSON request body"})
		return
	}
	manifest := request.Manifest
	var err error
	if manifest == nil {
		_, manifest, err = s.versionRepository.Load(r.Context(), jobID, clipIndex, request.VersionID)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"detail": err.Error()})
			return
		}
	}
	version, branched, err := s.versionRepository.Create(r.Context(), jobID, clipIndex, manifest, &request.VersionID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"version": version, "manifest": branched})
}

func (s *Server) getVersion(w http.ResponseWriter, ctx context.Context, jobID string, clipIndex int, versionID string) {
	version, manifest, err := s.versionRepository.Load(ctx, jobID, clipIndex, versionID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"version": version, "manifest": manifest})
}

func (s *Server) updateVersion(w http.ResponseWriter, r *http.Request, jobID string, clipIndex int, versionID string) {
	var request struct {
		Manifest map[string]any `json:"manifest"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid JSON request body"})
		return
	}
	version, manifest, err := s.versionRepository.UpdateManifest(r.Context(), jobID, clipIndex, versionID, request.Manifest)
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, versions.ErrVersionRendering) {
			status = http.StatusConflict
		}
		writeJSON(w, status, map[string]string{"detail": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"version": version, "manifest": manifest})
}

func (s *Server) renderVersion(w http.ResponseWriter, r *http.Request, jobID string, clipIndex int, versionID string) {
	version, manifest, err := s.versionRepository.Load(r.Context(), jobID, clipIndex, versionID)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"detail": err.Error()})
		return
	}
	if err != nil || manifest["manifest_revision"] != version.ManifestRevision {
		writeJSON(w, http.StatusConflict, map[string]string{"detail": "manifest revision mismatch"})
		return
	}
	transportManifest := cloneJSONMap(manifest)
	if timeline, ok := transportManifest["timeline"].(map[string]any); ok {
		if videoURL, ok := timeline["source_video_url"].(string); ok {
			timeline["source_video_url"] = s.localRenderVideoURL(jobID, videoURL)
		}
	}
	body := map[string]any{
		"jobId":            jobID,
		"clipIndex":        clipIndex,
		"versionId":        versionID,
		"manifestRevision": version.ManifestRevision,
		"manifest":         transportManifest,
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": err.Error()})
		return
	}
	if _, err := s.versionRepository.UpdateRender(r.Context(), jobID, clipIndex, versionID, versions.RenderStatusRendering, ""); err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"detail": err.Error()})
		return
	}
	upstream, err := http.NewRequestWithContext(r.Context(), http.MethodPost, strings.TrimRight(s.config.RenderServiceURL, "/")+"/render", strings.NewReader(string(encoded)))
	if err != nil {
		_, _ = s.versionRepository.UpdateRender(r.Context(), jobID, clipIndex, versionID, versions.RenderStatusFailed, err.Error())
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": err.Error()})
		return
	}
	upstream.Header.Set("Content-Type", "application/json")
	response, err := (&http.Client{Timeout: 30 * time.Second}).Do(upstream)
	if err != nil {
		_, _ = s.versionRepository.UpdateRender(r.Context(), jobID, clipIndex, versionID, versions.RenderStatusFailed, err.Error())
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": fmt.Sprintf("Render service unavailable: %s", err)})
		return
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		message, _ := io.ReadAll(response.Body)
		_, _ = s.versionRepository.UpdateRender(r.Context(), jobID, clipIndex, versionID, versions.RenderStatusFailed, string(message))
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
		if parts[index] != s.s3Store.Bucket || parts[index+1] != jobID {
			continue
		}
		switch parts[index+2] {
		case "master":
			filename := parts[len(parts)-1]
			if filename == "" || filename == "." || filename == ".." || strings.Contains(filename, "\\") {
				return videoURL
			}
			return "/videos/" + jobID + "/" + filename
		case "clips":
			if index+4 >= len(parts) || parts[index+3] == "" || parts[len(parts)-1] == "" {
				return videoURL
			}
			key := strings.Join(parts[index+1:], "/")
			if directURL, err := s.s3Store.DirectObjectURL(context.Background(), key, 2*time.Hour); err == nil {
				return directURL
			}
		}
	}
	return videoURL
}

func (s *Server) downloadVersion(w http.ResponseWriter, r *http.Request, jobID string, clipIndex int, versionID string) {
	s.redirectVersionOutput(w, r, jobID, clipIndex, versionID, true)
}

func (s *Server) previewVersion(w http.ResponseWriter, r *http.Request, jobID string, clipIndex int, versionID string) {
	s.redirectVersionOutput(w, r, jobID, clipIndex, versionID, false)
}

func (s *Server) redirectVersionOutput(w http.ResponseWriter, r *http.Request, jobID string, clipIndex int, versionID string, forceDownload bool) {
	version, _, err := s.versionRepository.Load(r.Context(), jobID, clipIndex, versionID)
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
		key, keyErr := versionOutputObjectKey(parsed, s.s3Store.Bucket, jobID)
		if keyErr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"detail": keyErr.Error()})
			return
		}
		var objectURL string
		var urlErr error
		if forceDownload {
			objectURL, urlErr = s.s3Store.DirectDownloadURL(r.Context(), key, filename, 2*time.Hour)
		} else {
			objectURL, urlErr = s.s3Store.DirectObjectURL(r.Context(), key, 2*time.Hour)
		}
		if urlErr != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"detail": fmt.Sprintf("Could not create version output URL: %s", urlErr)})
			return
		}
		http.Redirect(w, r, objectURL, http.StatusTemporaryRedirect)
		return
	}
	http.Redirect(w, r, version.OutputURL, http.StatusTemporaryRedirect)
}

func versionOutputObjectKey(parsed *url.URL, bucket, jobID string) (string, error) {
	marker := "/" + strings.Trim(bucket, "/") + "/"
	markerIndex := strings.Index(parsed.Path, marker)
	if markerIndex < 0 {
		return "", errors.New("version output URL is not a stored object URL")
	}
	key := strings.TrimPrefix(parsed.Path[markerIndex+len(marker):], "/")
	if key == "" || path.Clean(key) != key || strings.Contains(key, "\\") || !strings.HasPrefix(key, jobID+"/") {
		return "", errors.New("version output object key is invalid")
	}
	return key, nil
}

func (s *Server) completeVersion(w http.ResponseWriter, r *http.Request, jobID string, clipIndex int, versionID string) {
	var request struct {
		OutputURL string `json:"output_url"`
		Error     string `json:"error"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid JSON request body"})
		return
	}
	if _, _, err := s.versionRepository.Load(r.Context(), jobID, clipIndex, versionID); err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"detail": err.Error()})
		return
	}
	if request.Error != "" {
		failed, err := s.versionRepository.UpdateRender(r.Context(), jobID, clipIndex, versionID, versions.RenderStatusFailed, request.Error)
		if err != nil {
			writeJSON(w, http.StatusConflict, map[string]string{"detail": err.Error()})
			return
		}
		currentVersionID, _, _ := s.versionRepository.List(r.Context(), jobID, clipIndex)
		writeJSON(w, http.StatusOK, map[string]any{"version": failed, "current_version_id": currentVersionID})
		return
	}
	if request.OutputURL == "" {
		writeJSON(w, http.StatusConflict, map[string]string{"detail": "output URL is required"})
		return
	}
	publishedURL, err := s.publishRenderOutput(r.Context(), request.OutputURL, versionID)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": fmt.Sprintf("Could not publish rendered master: %s", err)})
		return
	}
	request.OutputURL = publishedURL
	promoted, err := s.versionRepository.Complete(r.Context(), jobID, clipIndex, versionID, request.OutputURL)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"detail": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"version": promoted, "current_version_id": promoted.VersionID})
}

func cloneJSONMap(value map[string]any) map[string]any {
	encoded, err := json.Marshal(value)
	if err != nil {
		return map[string]any{}
	}
	var clone map[string]any
	if err := json.Unmarshal(encoded, &clone); err != nil || clone == nil {
		return map[string]any{}
	}
	return clone
}

func (s *Server) activateVersion(w http.ResponseWriter, ctx context.Context, jobID string, clipIndex int, versionID string) {
	version, _, err := s.versionRepository.Load(ctx, jobID, clipIndex, versionID)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"detail": err.Error()})
		return
	}
	if version.OutputURL == "" {
		writeJSON(w, http.StatusConflict, map[string]string{"detail": "version has no rendered output"})
		return
	}
	promoted, err := s.versionRepository.Promote(ctx, jobID, clipIndex, versionID, version.OutputURL)
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

func (s *Server) persistSubtitles(w http.ResponseWriter, r *http.Request, jobID string, clipIndex int) {
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
		TrackID  string           `json:"trackId"`
		Language string           `json:"language"`
		Style    map[string]any   `json:"style"`
		Cues     []map[string]any `json:"cues"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid JSON request body"})
		return
	}
	if request.TrackID == "" {
		request.TrackID = "original"
	}
	if request.Language == "" {
		request.Language = "und"
	}

	existingTracks, _ := manifest["subtitle_tracks"].([]any)
	nextTracks := make([]any, 0, len(existingTracks)+1)
	for _, rawTrack := range existingTracks {
		track, ok := rawTrack.(map[string]any)
		if ok && track["id"] == request.TrackID {
			continue
		}
		nextTracks = append(nextTracks, rawTrack)
	}

	captions := make([]any, 0)
	for _, cue := range request.Cues {
		if wordCaptions, ok := cue["captions"].([]any); ok && len(wordCaptions) > 0 {
			captions = append(captions, wordCaptions...)
			continue
		}
		captions = append(captions, map[string]any{
			"text":    cue["text"],
			"startMs": cue["startMs"],
			"endMs":   cue["endMs"],
		})
	}

	if len(request.Cues) > 0 {
		track := map[string]any{
			"id":       request.TrackID,
			"language": request.Language,
			"label":    "Original",
			"origin":   "manual",
			"cues":     request.Cues,
			"captions": captions,
		}
		if request.Style != nil {
			track["style"] = request.Style
		}
		nextTracks = append(nextTracks, track)
	}
	manifest["subtitle_tracks"] = nextTracks
	manifest["subtitle_tracks_disabled"] = len(nextTracks) == 0
	if len(nextTracks) == 0 {
		manifest["active_subtitle_track_id"] = nil
	} else {
		manifest["active_subtitle_track_id"] = request.TrackID
	}
	layers, _ := manifest["layers"].(map[string]any)
	if layers == nil {
		layers = make(map[string]any)
	}
	if len(request.Cues) == 0 {
		layers["subtitles"] = nil
	} else {
		layers["subtitles"] = map[string]any{
			"captions": captions,
			"cues":     request.Cues,
			"language": request.Language,
			"style":    request.Style,
		}
	}
	manifest["layers"] = layers
	manifest["master"] = nil
	revision, err := manifests.SaveAtomic(path, manifest)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"success":        true,
		"manifest":       manifest,
		"revision":       revision,
		"master_current": false,
	})
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
