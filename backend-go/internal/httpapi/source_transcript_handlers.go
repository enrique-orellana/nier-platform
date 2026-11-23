package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/mutonby/openshorts/backend-go/internal/domain"
	"github.com/mutonby/openshorts/backend-go/internal/media"
)

type sourceTranscriptPayload struct {
	Transcript     map[string]any `json:"transcript"`
	SubtitleTracks any            `json:"subtitle_tracks"`
	VideoURL       string         `json:"source_video_url"`
	Duration       float64        `json:"source_duration_seconds"`
	UseWordTimings *bool          `json:"use_word_timings"`
}

func (s *Server) projectSourceTranscript(w http.ResponseWriter, r *http.Request, jobID string) {
	if !validProjectJobID(jobID) {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Project not found"})
		return
	}
	switch r.Method {
	case http.MethodGet:
		s.getProjectSourceTranscript(w, r.Context(), jobID)
	case http.MethodPatch:
		s.updateProjectSourceTranscript(w, r, jobID)
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method not allowed"})
	}
}

func validProjectJobID(jobID string) bool {
	return jobID != "" && jobID != "." && jobID != ".." && filepath.Base(jobID) == jobID && !strings.ContainsAny(jobID, `/\\`)
}

func (s *Server) sourceTranscriptOutputDir(ctx context.Context, jobID string) string {
	if job, ok := s.store.Get(ctx, jobID); ok && strings.TrimSpace(job.OutputDir) != "" {
		return job.OutputDir
	}
	root := s.config.OutputDir
	if root == "" {
		root = "output"
	}
	return filepath.Join(root, jobID)
}

func (s *Server) loadProjectSourceMetadata(ctx context.Context, jobID string) (map[string]any, string, error) {
	outputDir := s.sourceTranscriptOutputDir(ctx, jobID)
	metadataPath, err := s.deferredMetadataPath(ctx, outputDir, jobID)
	if err == nil {
		contents, readErr := os.ReadFile(metadataPath)
		if readErr != nil {
			return nil, "", readErr
		}
		metadata := map[string]any{}
		if decodeErr := json.Unmarshal(contents, &metadata); decodeErr != nil {
			return nil, "", fmt.Errorf("decode source metadata: %w", decodeErr)
		}
		return metadata, metadataPath, nil
	}

	job, ok := s.store.Get(ctx, jobID)
	if !ok || len(job.Result) == 0 {
		return nil, "", err
	}
	metadata := map[string]any{}
	if decodeErr := json.Unmarshal(job.Result, &metadata); decodeErr != nil {
		return nil, "", fmt.Errorf("decode project result: %w", decodeErr)
	}
	if _, exists := metadata["shorts"]; !exists {
		if clips, ok := metadata["clips"]; ok {
			metadata["shorts"] = clips
		}
	}
	if _, exists := metadata["source_duration_seconds"]; !exists {
		if duration := sourceDurationFromMetadata(metadata); duration > 0 {
			metadata["source_duration_seconds"] = duration
		}
	}
	return metadata, filepath.Join(outputDir, "source_metadata.json"), nil
}

func sourceTranscriptFromMetadata(metadata map[string]any) map[string]any {
	transcript, _ := metadata["transcript"].(map[string]any)
	return transcript
}

func sourceVideoFilename(metadata map[string]any) string {
	asset, _ := metadata["source_asset"].(map[string]any)
	if filename, _ := asset["relative_path"].(string); strings.TrimSpace(filename) != "" {
		return strings.TrimSpace(filename)
	}
	shorts, _ := metadata["shorts"].([]any)
	if len(shorts) > 0 {
		if clip, ok := shorts[0].(map[string]any); ok {
			if filename, _ := clip["source_video_filename"].(string); strings.TrimSpace(filename) != "" {
				return strings.TrimSpace(filename)
			}
		}
	}
	filename, _ := metadata["source_video_filename"].(string)
	return strings.TrimSpace(filename)
}

func sourceTranscriptDuration(metadata map[string]any) float64 {
	if duration := sourceDurationFromMetadata(metadata); duration > 0 {
		return duration
	}
	for _, key := range []string{"video_duration", "duration"} {
		if duration, ok := numericTime(metadata[key]); ok && duration > 0 {
			return duration
		}
	}
	if sourceMetadata, ok := metadata["source_metadata"].(map[string]any); ok {
		if duration, ok := numericTime(sourceMetadata["duration"]); ok && duration > 0 {
			return duration
		}
	}
	return 0
}

func (s *Server) sourceVideoFilenameFromResult(ctx context.Context, jobID string) string {
	job, ok := s.store.Get(ctx, jobID)
	if !ok || len(job.Result) == 0 {
		return ""
	}
	var result struct {
		SourceVideoFilename string `json:"source_video_filename"`
		SourceAsset         struct {
			RelativePath string `json:"relative_path"`
		} `json:"source_asset"`
		Clips  []map[string]any `json:"clips"`
		Shorts []map[string]any `json:"shorts"`
	}
	if json.Unmarshal(job.Result, &result) != nil {
		return ""
	}
	if filename := strings.TrimSpace(result.SourceAsset.RelativePath); filename != "" {
		return filename
	}
	if filename := strings.TrimSpace(result.SourceVideoFilename); filename != "" {
		return filename
	}
	clips := result.Clips
	if len(clips) == 0 {
		clips = result.Shorts
	}
	if len(clips) > 0 {
		filename, _ := clips[0]["source_video_filename"].(string)
		return strings.TrimSpace(filename)
	}
	return ""
}

func (s *Server) getProjectSourceTranscript(w http.ResponseWriter, ctx context.Context, jobID string) {
	metadata, _, err := s.loadProjectSourceMetadata(ctx, jobID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Project source metadata is unavailable"})
		return
	}
	transcript := sourceTranscriptFromMetadata(metadata)
	if len(transcript) == 0 {
		transcript = s.sourceTranscriptFromResult(ctx, jobID)
	}
	if len(transcript) == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Source transcript is unavailable"})
		return
	}
	duration := sourceTranscriptDuration(metadata)
	if duration <= 0 {
		if job, ok := s.store.Get(ctx, jobID); ok && len(job.Result) > 0 {
			var result map[string]any
			if json.Unmarshal(job.Result, &result) == nil {
				duration = sourceTranscriptDuration(result)
			}
		}
	}
	filename := sourceVideoFilename(metadata)
	if filename == "" {
		filename = s.sourceVideoFilenameFromResult(ctx, jobID)
	}
	videoURL := ""
	if filename != "" {
		videoURL = s.directMasterArtifactURL(jobID, filename)
	}
	if videoURL == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Source video is unavailable"})
		return
	}
	configured, ok := metadata["source_transcript_use_word_timings"].(bool)
	if !ok {
		configured = false
	}
	writeJSON(w, http.StatusOK, sourceTranscriptPayload{
		Transcript:     transcript,
		SubtitleTracks: metadata["source_subtitle_tracks"],
		VideoURL:       videoURL,
		Duration:       duration,
		UseWordTimings: &configured,
	})
}

func validateSourceTranscript(transcript map[string]any, duration float64) error {
	segments, ok := transcript["segments"].([]any)
	if !ok || len(segments) == 0 {
		return errors.New("transcript must contain at least one timed segment")
	}
	for index, rawSegment := range segments {
		segment, ok := rawSegment.(map[string]any)
		if !ok {
			return fmt.Errorf("transcript segment %d is invalid", index+1)
		}
		start, startOK := numericTime(segment["start"])
		end, endOK := numericTime(segment["end"])
		if !startOK || !endOK || start < 0 || end <= start || (duration > 0 && end > duration) {
			return fmt.Errorf("transcript segment %d has an invalid time range", index+1)
		}
		words, _ := segment["words"].([]any)
		for wordIndex, rawWord := range words {
			word, ok := rawWord.(map[string]any)
			if !ok {
				return fmt.Errorf("transcript word %d in segment %d is invalid", wordIndex+1, index+1)
			}
			wordStart, wordStartOK := numericTime(word["start"])
			wordEnd, wordEndOK := numericTime(word["end"])
			if !wordStartOK || !wordEndOK || wordStart < 0 || wordEnd <= wordStart || wordStart < start || wordEnd > end || (duration > 0 && wordEnd > duration) {
				return fmt.Errorf("transcript word %d in segment %d has an invalid time range", wordIndex+1, index+1)
			}
		}
	}
	return nil
}

func validateSourceSubtitleTracks(tracks []map[string]any, duration float64) error {
	seenIDs := make(map[string]struct{}, len(tracks))
	seenLanguages := make(map[string]struct{}, len(tracks))
	for trackIndex, track := range tracks {
		id, _ := track["id"].(string)
		id = strings.TrimSpace(id)
		language, _ := track["language"].(string)
		language = strings.ToLower(strings.TrimSpace(language))
		if id == "" || language == "" {
			return fmt.Errorf("subtitle track %d must have an id and language", trackIndex+1)
		}
		if _, exists := seenIDs[id]; exists {
			return fmt.Errorf("subtitle track id %q is duplicated", id)
		}
		if _, exists := seenLanguages[language]; exists {
			return fmt.Errorf("subtitle language %q has more than one track", language)
		}
		seenIDs[id] = struct{}{}
		seenLanguages[language] = struct{}{}

		cues, _ := track["cues"].([]any)
		for cueIndex, rawCue := range cues {
			cue, ok := rawCue.(map[string]any)
			if !ok {
				return fmt.Errorf("subtitle cue %d in track %q is invalid", cueIndex+1, id)
			}
			start, startOK := numericTime(cue["startMs"])
			end, endOK := numericTime(cue["endMs"])
			if !startOK || !endOK || start < 0 || end <= start || (duration > 0 && end > duration*1000) {
				return fmt.Errorf("subtitle cue %d in track %q has an invalid time range", cueIndex+1, id)
			}
		}
	}
	return nil
}

func numericTime(value any) (float64, bool) {
	number, ok := value.(float64)
	return number, ok && !math.IsNaN(number) && !math.IsInf(number, 0)
}

func refreshProjectClipTranscript(clip map[string]any, transcript map[string]any) bool {
	return refreshProjectClipTranscriptWithWordTimings(clip, transcript, true)
}

func refreshProjectClipTranscriptWithWordTimings(clip map[string]any, transcript map[string]any, useWordTimings bool) bool {
	start, startOK := numericTime(clip["start"])
	end, endOK := numericTime(clip["end"])
	if !startOK || !endOK || end <= start {
		return false
	}
	return refreshProjectTranscriptForRangeWithWordTimings(clip, transcript, start, end, useWordTimings)
}

func refreshProjectTranscriptForRange(clip, transcript map[string]any, start, end float64) bool {
	return refreshProjectTranscriptForRangeWithWordTimings(clip, transcript, start, end, true)
}

func refreshProjectTranscriptForRangeWithWordTimings(clip, transcript map[string]any, start, end float64, useWordTimings bool) bool {
	if end <= start {
		return false
	}
	if refreshGeneratedClipSubtitlesWithWordTimings(clip, transcript, start, end, useWordTimings) {
		if activeTrack, ok := clip["active_subtitle_track_id"].(string); !ok || strings.TrimSpace(activeTrack) == "" {
			clip["active_subtitle_track_id"] = "original"
		}
		return true
	}

	captions := media.BuildSubtitleCuesWithWordTimings(transcript, start, end, useWordTimings)
	if len(captions) == 0 {
		return false
	}
	encodedCaptions := make([]any, 0, len(captions))
	for _, cue := range captions {
		encodedCaptions = append(encodedCaptions, map[string]any{
			"text": cue.Text, "startMs": cue.StartMs, "endMs": cue.EndMs,
		})
	}
	track := map[string]any{
		"id": "original", "origin": "generated", "label": "Original",
		"language": transcript["language"], "cues": encodedCaptions, "captions": encodedCaptions,
	}
	if activeTrack, ok := clip["active_subtitle_track_id"].(string); !ok || strings.TrimSpace(activeTrack) == "" {
		clip["active_subtitle_track_id"] = "original"
	}
	tracks, _ := clip["subtitle_tracks"].([]any)
	clip["subtitle_tracks"] = append(tracks, track)
	if legacy, ok := clip["subtitles"].(map[string]any); !ok || isGeneratedSubtitleTrack(legacy) {
		clip["subtitles"] = track
	}
	layers, _ := clip["layers"].(map[string]any)
	if layers == nil {
		layers = make(map[string]any)
	}
	if layer, ok := layers["subtitles"].(map[string]any); !ok || isGeneratedSubtitleTrack(layer) {
		layers["subtitles"] = track
	}
	clip["layers"] = layers
	return true
}

func (s *Server) updateProjectSourceTranscript(w http.ResponseWriter, r *http.Request, jobID string) {
	var request struct {
		Transcript             map[string]any    `json:"transcript"`
		SubtitleTracks         *[]map[string]any `json:"subtitle_tracks"`
		SynchronizeWordTimings *bool             `json:"synchronize_word_timings"`
		UseWordTimings         *bool             `json:"use_word_timings"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "Invalid JSON request body"})
		return
	}
	if request.Transcript == nil && request.SubtitleTracks == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"detail": "A transcript or subtitle tracks are required"})
		return
	}
	metadata, metadataPath, err := s.loadProjectSourceMetadata(r.Context(), jobID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Project source metadata is unavailable"})
		return
	}
	duration := sourceTranscriptDuration(metadata)
	useWordTimings := request.UseWordTimings == nil || *request.UseWordTimings
	if request.Transcript != nil {
		synchronizeWordTimings := request.SynchronizeWordTimings == nil || *request.SynchronizeWordTimings
		updateSourceTranscriptWordTimings(request.Transcript, synchronizeWordTimings)
		if err := validateSourceTranscript(request.Transcript, duration); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"detail": err.Error()})
			return
		}
		metadata["transcript"] = request.Transcript
		metadata["source_transcript_use_word_timings"] = useWordTimings
		shorts, _ := metadata["shorts"].([]any)
		for clipIndex, rawClip := range shorts {
			if clip, ok := rawClip.(map[string]any); ok {
				clipUseWordTimings := s.clipUsesWordLevelTimings(r.Context(), jobID, clipIndex)
				refreshProjectClipTranscriptWithWordTimings(clip, request.Transcript, clipUseWordTimings)
			}
		}
	}
	if request.SubtitleTracks != nil {
		if err := validateSourceSubtitleTracks(*request.SubtitleTracks, duration); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"detail": err.Error()})
			return
		}
		metadata["source_subtitle_tracks"] = *request.SubtitleTracks
	}
	updatedMetadata, err := json.MarshalIndent(metadata, "", "  ")
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Could not encode source transcript"})
		return
	}
	if err := os.MkdirAll(filepath.Dir(metadataPath), 0o755); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Could not prepare source metadata"})
		return
	}
	if err := writeJSONFileAtomic(metadataPath, updatedMetadata); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Could not save source transcript locally"})
		return
	}
	if err := s.persistDeferredMetadata(r.Context(), jobID, updatedMetadata); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"detail": "Source transcript is local but could not be saved to object storage; retry the save"})
		return
	}
	if job, ok := s.store.Get(r.Context(), jobID); ok && len(job.Result) > 0 {
		if err := s.updateStoredProjectTranscript(r.Context(), job, request.Transcript, request.SubtitleTracks); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Source subtitle changes were saved, but the project result could not be refreshed; retry the save"})
			return
		}
	}
	response := map[string]any{"success": true}
	if request.Transcript != nil {
		response["transcript"] = request.Transcript
		response["use_word_timings"] = useWordTimings
	}
	if request.SubtitleTracks != nil {
		response["subtitle_tracks"] = *request.SubtitleTracks
	}
	writeJSON(w, http.StatusOK, response)
}

func updateSourceTranscriptWordTimings(transcript map[string]any, synchronize bool) {
	segments, _ := transcript["segments"].([]any)
	for _, rawSegment := range segments {
		segment, ok := rawSegment.(map[string]any)
		if !ok {
			continue
		}
		words, ok := segment["words"].([]any)
		if !ok || len(words) == 0 {
			continue
		}
		text, _ := segment["text"].(string)
		tokens := strings.Fields(text)
		if len(tokens) == 0 {
			segment["words"] = []any{}
			continue
		}
		oldWords := make([]map[string]any, 0, len(words))
		valid := true
		for _, rawWord := range words {
			word, ok := rawWord.(map[string]any)
			if !ok {
				valid = false
				break
			}
			oldWords = append(oldWords, word)
		}
		if !valid || len(oldWords) == 0 {
			continue
		}
		oldText := make([]string, 0, len(oldWords))
		for _, word := range oldWords {
			value, _ := word["word"].(string)
			if value == "" {
				value, _ = word["text"].(string)
			}
			oldText = append(oldText, strings.TrimSpace(value))
		}
		if strings.Join(strings.Fields(strings.Join(oldText, " ")), " ") == strings.Join(tokens, " ") {
			continue
		}
		if !synchronize {
			delete(segment, "words")
			continue
		}

		updated := make([]any, 0, len(tokens))
		for index, token := range tokens {
			startIndex := index * len(oldWords) / len(tokens)
			endIndex := (index+1)*len(oldWords)/len(tokens) - 1
			if endIndex < startIndex {
				endIndex = startIndex
			}
			if startIndex >= len(oldWords) {
				startIndex = len(oldWords) - 1
			}
			if endIndex >= len(oldWords) {
				endIndex = len(oldWords) - 1
			}
			word := make(map[string]any, len(oldWords[startIndex])+2)
			for key, value := range oldWords[startIndex] {
				word[key] = value
			}
			wordKey := "word"
			if _, exists := word[wordKey]; !exists {
				if _, exists := word["text"]; exists {
					wordKey = "text"
				}
			}
			word[wordKey] = token
			if len(tokens) <= len(oldWords) {
				word["start"] = oldWords[startIndex]["start"]
				word["end"] = oldWords[endIndex]["end"]
			} else {
				groupStart := (startIndex*len(tokens) + len(oldWords) - 1) / len(oldWords)
				groupEnd := ((startIndex+1)*len(tokens)+len(oldWords)-1)/len(oldWords) - 1
				groupSize := groupEnd - groupStart + 1
				if groupSize < 1 {
					groupSize = 1
				}
				groupPosition := index - groupStart
				start, startOK := numericTime(oldWords[startIndex]["start"])
				end, endOK := numericTime(oldWords[startIndex]["end"])
				if startOK && endOK && end > start {
					span := end - start
					word["start"] = start + span*float64(groupPosition)/float64(groupSize)
					word["end"] = start + span*float64(groupPosition+1)/float64(groupSize)
				}
			}
			updated = append(updated, word)
		}
		segment["words"] = updated
	}
}

func (s *Server) updateStoredProjectTranscript(ctx context.Context, job domain.Job, transcript map[string]any, subtitleTracks *[]map[string]any) error {
	payload := map[string]any{}
	if err := json.Unmarshal(job.Result, &payload); err != nil {
		return err
	}
	if transcript != nil {
		payload["transcript"] = transcript
		clips, _ := payload["clips"].([]any)
		for clipIndex, rawClip := range clips {
			if clip, ok := rawClip.(map[string]any); ok {
				useWordTimings := s.clipUsesWordLevelTimings(ctx, job.ID, clipIndex)
				refreshProjectClipTranscriptWithWordTimings(clip, transcript, useWordTimings)
			}
		}
	}
	if subtitleTracks != nil {
		payload["source_subtitle_tracks"] = *subtitleTracks
	}
	updated, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return s.store.SetResult(ctx, job.ID, updated)
}

func (s *Server) sourceTranscriptForClip(ctx context.Context, jobID string, clipIndex int) (map[string]any, float64, float64, bool, bool) {
	metadata, _, err := s.loadProjectSourceMetadata(ctx, jobID)
	if err != nil {
		return nil, 0, 0, true, false
	}
	transcript := sourceTranscriptFromMetadata(metadata)
	if len(transcript) == 0 {
		transcript = s.sourceTranscriptFromResult(ctx, jobID)
	}
	if len(transcript) == 0 {
		return nil, 0, 0, true, false
	}
	useWordTimings := s.clipUsesWordLevelTimings(ctx, jobID, clipIndex)
	if shorts, ok := metadata["shorts"].([]any); ok && clipIndex >= 0 && clipIndex < len(shorts) {
		if clip, ok := shorts[clipIndex].(map[string]any); ok {
			start, startOK := numericTime(clip["start"])
			end, endOK := numericTime(clip["end"])
			if startOK && endOK && end > start {
				return transcript, start, end, useWordTimings, true
			}
		}
	}
	if job, ok := s.store.Get(ctx, jobID); ok && len(job.Result) > 0 {
		var result struct {
			Clips []map[string]any `json:"clips"`
		}
		if json.Unmarshal(job.Result, &result) == nil && clipIndex >= 0 && clipIndex < len(result.Clips) {
			clip := result.Clips[clipIndex]
			start, startOK := numericTime(clip["start"])
			end, endOK := numericTime(clip["end"])
			if startOK && endOK && end > start {
				return transcript, start, end, useWordTimings, true
			}
		}
	}
	return transcript, 0, 0, useWordTimings, false
}

func (s *Server) sourceTranscriptFromResult(ctx context.Context, jobID string) map[string]any {
	job, ok := s.store.Get(ctx, jobID)
	if !ok || len(job.Result) == 0 {
		return nil
	}
	payload := map[string]any{}
	if json.Unmarshal(job.Result, &payload) != nil {
		return nil
	}
	transcript, _ := payload["transcript"].(map[string]any)
	return transcript
}
