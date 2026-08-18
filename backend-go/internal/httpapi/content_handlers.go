package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/mutonby/openshorts/backend-go/internal/integrations"
	"github.com/mutonby/openshorts/backend-go/internal/media"
)

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
	clipStart := metadata.Shorts[request.ClipIndex].Start
	clipEnd := metadata.Shorts[request.ClipIndex].End
	srt, err := media.BuildWordSRT(metadata.Transcript, clipStart, clipEnd)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": err.Error()})
		return
	}
	subtitleFilename := fmt.Sprintf("subtitles_%d.srt", request.ClipIndex)
	subtitlePath := filepath.Join(root, subtitleFilename)
	if err := os.WriteFile(subtitlePath, []byte(srt), 0o644); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": err.Error()})
		return
	}
	outputFilename := "subtitled_" + filename
	outputPath := filepath.Join(root, outputFilename)
	if err := media.BurnSubtitles(r.Context(), s.mediaRunner, inputPath, subtitlePath, outputPath, media.SubtitleStyle{Alignment: request.Position, FontSize: request.FontSize, FontName: request.FontName, FontColor: request.FontColor, BorderColor: request.BorderColor, BorderWidth: request.BorderWidth, BackgroundColor: request.Background, BackgroundAlpha: request.BackgroundAlpha}); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": err.Error()})
		return
	}
	if _, err := os.Stat(outputPath); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": "FFmpeg did not produce an output video"})
		return
	}
	videoURL := "/videos/" + request.JobID + "/" + outputFilename
	subtitleURL := "/videos/" + request.JobID + "/" + subtitleFilename
	captions := media.BuildSubtitleCues(metadata.Transcript, clipStart, clipEnd)
	language, _ := metadata.Transcript["language"].(string)
	if language == "" {
		language = "und"
	}
	subtitleTrack := map[string]any{
		"id": "original", "label": "Original", "language": language, "origin": "generated",
		"srt_filename": subtitleFilename, "cues": captions, "captions": captions,
	}
	subtitleLayer := map[string]any{
		"captions": captions,
		"position": request.Position,
		"style": map[string]any{
			"fontFamily": request.FontName, "fontSize": request.FontSize, "fontColor": request.FontColor,
			"borderColor": request.BorderColor, "borderWidth": request.BorderWidth,
			"backgroundColor": request.Background, "backgroundOpacity": request.BackgroundAlpha,
		},
	}
	result.Clips[request.ClipIndex]["video_url"] = videoURL
	result.Clips[request.ClipIndex]["subtitle_filename"] = subtitleFilename
	result.Clips[request.ClipIndex]["subtitle_url"] = subtitleURL
	result.Clips[request.ClipIndex]["subtitles"] = subtitleTrack
	result.Clips[request.ClipIndex]["subtitle_tracks"] = []any{subtitleTrack}
	result.Clips[request.ClipIndex]["active_subtitle_track_id"] = "original"
	resultLayers, _ := result.Clips[request.ClipIndex]["layers"].(map[string]any)
	if resultLayers == nil {
		resultLayers = make(map[string]any)
	}
	resultLayers["subtitles"] = subtitleLayer
	result.Clips[request.ClipIndex]["layers"] = resultLayers
	if encoded, marshalErr := json.Marshal(result); marshalErr == nil {
		_ = s.store.SetResult(r.Context(), request.JobID, encoded)
	}
	metadataData := map[string]any{}
	if json.Unmarshal(contents, &metadataData) == nil {
		if shorts, ok := metadataData["shorts"].([]any); ok && request.ClipIndex < len(shorts) {
			if item, ok := shorts[request.ClipIndex].(map[string]any); ok {
				item["video_url"] = videoURL
				item["subtitle_filename"] = subtitleFilename
				item["subtitle_url"] = subtitleURL
				item["subtitles"] = subtitleTrack
				item["subtitle_tracks"] = []any{subtitleTrack}
				item["active_subtitle_track_id"] = "original"
				itemLayers, _ := item["layers"].(map[string]any)
				if itemLayers == nil {
					itemLayers = make(map[string]any)
				}
				itemLayers["subtitles"] = subtitleLayer
				item["layers"] = itemLayers
			}
		}
		if encoded, marshalErr := json.MarshalIndent(metadataData, "", "  "); marshalErr == nil {
			_ = os.WriteFile(metadataPath, encoded, 0o644)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "new_video_url": videoURL, "subtitle_url": subtitleURL, "subtitle_tracks": []any{subtitleTrack}})
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
