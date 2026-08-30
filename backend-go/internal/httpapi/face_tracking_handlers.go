package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const faceTrackingAlgorithmVersion = "yolo-standard-v1"

type faceTrackingRequest struct {
	StartSeconds     float64 `json:"start_seconds"`
	EndSeconds       float64 `json:"end_seconds"`
	SourceWidth      int     `json:"source_width"`
	SourceHeight     int     `json:"source_height"`
	AlgorithmVersion string  `json:"algorithm_version"`
}

type faceTrackingCall struct {
	done     chan struct{}
	response faceTrackingCacheRecord
	err      error
}

type faceTrackingCacheRecord struct {
	CacheKey           string          `json:"cache_key"`
	AlgorithmVersion   string          `json:"algorithm_version"`
	SourceFingerprint  string          `json:"source_fingerprint"`
	SourceStartSeconds float64         `json:"source_start_seconds"`
	SourceEndSeconds   float64         `json:"source_end_seconds"`
	SourceWidth        int             `json:"source_width"`
	SourceHeight       int             `json:"source_height"`
	Track              json.RawMessage `json:"track"`
}

type faceTrackingTrack struct {
	Scenes []faceTrackingScene `json:"scenes"`
}

type faceTrackingScene struct {
	StartSec  float64                `json:"start_sec"`
	EndSec    float64                `json:"end_sec"`
	Strategy  string                 `json:"strategy"`
	Keyframes []faceTrackingKeyframe `json:"keyframes"`
}

type faceTrackingKeyframe struct {
	TimeSec float64          `json:"time_sec"`
	Rect    faceTrackingRect `json:"rect"`
}

type faceTrackingRect struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

func (s *Server) analyzeFaceTracking(w http.ResponseWriter, r *http.Request, jobID string, clipIndex int) {
	if s.translationRunner == nil {
		writeJSON(w, http.StatusNotImplemented, map[string]string{"detail": "Python worker is not configured"})
		return
	}
	var request faceTrackingRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid JSON request body"})
		return
	}
	if request.AlgorithmVersion != faceTrackingAlgorithmVersion {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Unsupported face tracking algorithm version"})
		return
	}
	if request.SourceWidth < 1 || request.SourceHeight < 1 || request.StartSeconds < 0 || request.EndSeconds <= request.StartSeconds {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Face tracking range and source dimensions are invalid"})
		return
	}

	sourcePath, jobRoot, clipStart, clipEnd, err := s.resolveFaceTrackingSource(r.Context(), jobID, clipIndex)
	if err != nil {
		status := http.StatusNotFound
		if errors.Is(err, errFaceTrackingInvalidRequest) {
			status = http.StatusBadRequest
		}
		writeJSON(w, status, map[string]string{"detail": err.Error()})
		return
	}
	if request.StartSeconds < clipStart-0.01 || request.EndSeconds > clipEnd+0.01 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Face tracking range is outside the project clip"})
		return
	}
	fileInfo, err := os.Stat(sourcePath)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Project master is not cached"})
		return
	}
	sourceFingerprint := fmt.Sprintf("%s:%d:%d", sourcePath, fileInfo.Size(), fileInfo.ModTime().UnixNano())
	cacheKey := faceTrackingCacheKey(sourceFingerprint, request)
	cachePath := filepath.Join(jobRoot, "render-cache", "face-tracking", cacheKey+".json")
	if cached, ok := readFaceTrackingCache(cachePath, cacheKey, sourceFingerprint, request); ok {
		writeFaceTrackingResponse(w, cached, true)
		return
	}

	call, owner := s.beginFaceTrackingCall(cacheKey)
	if !owner {
		select {
		case <-call.done:
			if call.err != nil {
				writeJSON(w, http.StatusBadGateway, map[string]string{"detail": call.err.Error()})
				return
			}
			writeFaceTrackingResponse(w, call.response, false)
		case <-r.Context().Done():
			writeJSON(w, http.StatusRequestTimeout, map[string]string{"detail": "Face tracking analysis was cancelled"})
		}
		return
	}

	response := faceTrackingCacheRecord{}
	response, err = s.runFaceTrackingAnalysis(r.Context(), jobID, clipIndex, sourcePath, cachePath, cacheKey, sourceFingerprint, request)
	s.finishFaceTrackingCall(cacheKey, call, response, err)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": err.Error()})
		return
	}
	writeFaceTrackingResponse(w, response, false)
}

var errFaceTrackingInvalidRequest = errors.New("invalid face tracking project request")

func (s *Server) resolveFaceTrackingSource(ctx context.Context, jobID string, clipIndex int) (string, string, float64, float64, error) {
	job, ok := s.store.Get(ctx, jobID)
	if !ok {
		return "", "", 0, 0, errors.New("Project not found")
	}
	var result struct {
		Clips []struct {
			Start               float64 `json:"start"`
			End                 float64 `json:"end"`
			SourceVideoFilename string  `json:"source_video_filename"`
		} `json:"clips"`
	}
	if err := json.Unmarshal(job.Result, &result); err != nil || clipIndex < 0 || clipIndex >= len(result.Clips) {
		return "", "", 0, 0, errors.New("Clip not found")
	}
	clip := result.Clips[clipIndex]
	if clip.End <= clip.Start || clip.Start < 0 {
		return "", "", 0, 0, errFaceTrackingInvalidRequest
	}
	root := job.OutputDir
	if strings.TrimSpace(root) == "" {
		root = filepath.Join(s.config.OutputDir, job.ID)
	}
	jobRoot, err := filepath.Abs(root)
	if err != nil {
		return "", "", 0, 0, errors.New("Could not resolve project cache")
	}
	filename := clip.SourceVideoFilename
	if strings.TrimSpace(filename) == "" {
		filename = "source.mp4"
	}
	if filepath.Base(filename) != filename || !hasVideoExtension(filename) {
		return "", "", 0, 0, errFaceTrackingInvalidRequest
	}
	sourcePath, err := filepath.Abs(filepath.Join(jobRoot, filename))
	if err != nil || !safePath(jobRoot, sourcePath) {
		return "", "", 0, 0, errFaceTrackingInvalidRequest
	}
	if _, err := os.Stat(sourcePath); err != nil {
		return "", "", 0, 0, errors.New("Project master is not cached")
	}
	return sourcePath, jobRoot, clip.Start, clip.End, nil
}

func faceTrackingCacheKey(sourceFingerprint string, request faceTrackingRequest) string {
	value := strings.Join([]string{
		sourceFingerprint,
		strconv.FormatFloat(request.StartSeconds, 'f', 6, 64),
		strconv.FormatFloat(request.EndSeconds, 'f', 6, 64),
		strconv.Itoa(request.SourceWidth),
		strconv.Itoa(request.SourceHeight),
		request.AlgorithmVersion,
	}, "|")
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])
}

func (s *Server) beginFaceTrackingCall(cacheKey string) (*faceTrackingCall, bool) {
	s.faceTrackingMu.Lock()
	defer s.faceTrackingMu.Unlock()
	if existing, ok := s.faceTrackingRunning[cacheKey]; ok {
		return existing, false
	}
	call := &faceTrackingCall{done: make(chan struct{})}
	s.faceTrackingRunning[cacheKey] = call
	return call, true
}

func (s *Server) finishFaceTrackingCall(cacheKey string, call *faceTrackingCall, response faceTrackingCacheRecord, err error) {
	s.faceTrackingMu.Lock()
	call.response = response
	call.err = err
	delete(s.faceTrackingRunning, cacheKey)
	close(call.done)
	s.faceTrackingMu.Unlock()
}

func (s *Server) runFaceTrackingAnalysis(ctx context.Context, jobID string, clipIndex int, sourcePath, cachePath, cacheKey, sourceFingerprint string, request faceTrackingRequest) (faceTrackingCacheRecord, error) {
	workerResult, err := s.translationRunner.Run(ctx, fmt.Sprintf("project-%s-clip-%d-face-tracking-%s", jobID, clipIndex, cacheKey[:12]), "face_tracking", map[string]any{
		"source_path":   sourcePath,
		"start_seconds": request.StartSeconds,
		"end_seconds":   request.EndSeconds,
		"source_width":  request.SourceWidth,
		"source_height": request.SourceHeight,
	}, nil)
	if err != nil {
		return faceTrackingCacheRecord{}, fmt.Errorf("Face tracking analysis failed: %w", err)
	}
	var result struct {
		Track json.RawMessage `json:"track"`
	}
	if err := json.Unmarshal(workerResult, &result); err != nil || len(result.Track) == 0 {
		return faceTrackingCacheRecord{}, errors.New("Face tracking worker returned an invalid track")
	}
	if err := validateFaceTrackingTrack(result.Track, request.EndSeconds-request.StartSeconds); err != nil {
		return faceTrackingCacheRecord{}, fmt.Errorf("Face tracking worker returned an invalid track: %w", err)
	}
	record := faceTrackingCacheRecord{
		CacheKey:           cacheKey,
		AlgorithmVersion:   faceTrackingAlgorithmVersion,
		SourceFingerprint:  sourceFingerprint,
		SourceStartSeconds: request.StartSeconds,
		SourceEndSeconds:   request.EndSeconds,
		SourceWidth:        request.SourceWidth,
		SourceHeight:       request.SourceHeight,
		Track:              result.Track,
	}
	if err := writeFaceTrackingCache(cachePath, record); err != nil {
		return faceTrackingCacheRecord{}, fmt.Errorf("Could not persist face tracking cache: %w", err)
	}
	return record, nil
}

func validateFaceTrackingTrack(raw json.RawMessage, duration float64) error {
	var track faceTrackingTrack
	if err := json.Unmarshal(raw, &track); err != nil || len(track.Scenes) == 0 {
		return errors.New("track scenes are missing")
	}
	previousEnd := 0.0
	for _, scene := range track.Scenes {
		if scene.StartSec < 0 || scene.EndSec <= scene.StartSec || scene.StartSec < previousEnd || scene.EndSec > duration+0.05 {
			return errors.New("track scene range is invalid")
		}
		if scene.Strategy != "TRACK" && scene.Strategy != "GENERAL" || len(scene.Keyframes) == 0 {
			return errors.New("track scene data is invalid")
		}
		previousTime := scene.StartSec
		for _, keyframe := range scene.Keyframes {
			if keyframe.TimeSec < scene.StartSec || keyframe.TimeSec > scene.EndSec || keyframe.TimeSec < previousTime {
				return errors.New("track keyframe time is invalid")
			}
			if keyframe.Rect.X < 0 || keyframe.Rect.Y < 0 || keyframe.Rect.Width <= 0 || keyframe.Rect.Height <= 0 || keyframe.Rect.X+keyframe.Rect.Width > 1 || keyframe.Rect.Y+keyframe.Rect.Height > 1 {
				return errors.New("track crop rectangle is invalid")
			}
			previousTime = keyframe.TimeSec
		}
		previousEnd = scene.EndSec
	}
	return nil
}

func readFaceTrackingCache(path, cacheKey, sourceFingerprint string, request faceTrackingRequest) (faceTrackingCacheRecord, bool) {
	data, err := os.ReadFile(path)
	if err != nil {
		return faceTrackingCacheRecord{}, false
	}
	var record faceTrackingCacheRecord
	if json.Unmarshal(data, &record) != nil || record.CacheKey != cacheKey || record.AlgorithmVersion != faceTrackingAlgorithmVersion || record.SourceFingerprint != sourceFingerprint || record.SourceWidth != request.SourceWidth || record.SourceHeight != request.SourceHeight || record.SourceStartSeconds != request.StartSeconds || record.SourceEndSeconds != request.EndSeconds || validateFaceTrackingTrack(record.Track, request.EndSeconds-request.StartSeconds) != nil {
		return faceTrackingCacheRecord{}, false
	}
	return record, true
}

func writeFaceTrackingCache(path string, record faceTrackingCacheRecord) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".face-tracking-*.tmp")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if _, err := temporary.Write(data); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, path)
}

func writeFaceTrackingResponse(w http.ResponseWriter, record faceTrackingCacheRecord, cacheHit bool) {
	writeJSON(w, http.StatusOK, map[string]any{
		"cache_hit":            cacheHit,
		"cache_key":            record.CacheKey,
		"algorithm_version":    record.AlgorithmVersion,
		"source_fingerprint":   record.SourceFingerprint,
		"source_start_seconds": record.SourceStartSeconds,
		"source_end_seconds":   record.SourceEndSeconds,
		"source_width":         record.SourceWidth,
		"source_height":        record.SourceHeight,
		"track":                json.RawMessage(record.Track),
	})
}
