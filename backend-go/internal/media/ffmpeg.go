package media

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

type CommandRunner interface {
	Run(context.Context, string, ...string) error
}

type ExecCommandRunner struct{}

func (ExecCommandRunner) Run(ctx context.Context, name string, args ...string) error {
	return exec.CommandContext(ctx, name, args...).Run()
}

type SubtitleStyle struct {
	Alignment       string
	FontSize        int
	FontName        string
	FontColor       string
	BorderColor     string
	BorderWidth     int
	BackgroundColor string
	BackgroundAlpha float64
}

func SubtitleBurnArgs(inputPath, subtitlePath, outputPath string, style SubtitleStyle) []string {
	return []string{
		"-y", "-i", inputPath, "-vf", subtitleFilter(subtitlePath, style),
		"-c:v", "libx264", "-profile:v", "high", "-level:v", "4.2", "-preset", "veryslow", "-crf", "14",
		"-pix_fmt", "yuv420p", "-color_range", "tv", "-colorspace", "bt709", "-color_trc", "bt709", "-color_primaries", "bt709",
		"-video_track_timescale", "90000", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-b:a", "192k", "-movflags", "+faststart", outputPath,
	}
}

func subtitleFilter(subtitlePath string, style SubtitleStyle) string {
	pathValue := strings.ReplaceAll(subtitlePath, `\`, "/")
	pathValue = strings.ReplaceAll(pathValue, ":", `\:`)
	pathValue = strings.ReplaceAll(pathValue, "'", `\'`)
	return "subtitles='" + pathValue + "':force_style='" + subtitleASSStyle(style) + "',setsar=1,colorspace=all=bt709:iall=bt709:range=tv:irange=tv"
}

func subtitleASSStyle(style SubtitleStyle) string {
	alignment := 2
	switch strings.ToLower(strings.TrimSpace(style.Alignment)) {
	case "top":
		alignment = 6
	case "middle", "center", "centre":
		alignment = 10
	}
	fontName := strings.NewReplacer("'", "", ",", " ").Replace(strings.TrimSpace(style.FontName))
	if fontName == "" {
		fontName = "Verdana"
	}
	fontSize := style.FontSize
	if fontSize <= 0 {
		fontSize = 16
	}
	fontSize = int(float64(fontSize) * 0.85)
	if fontSize < 10 {
		fontSize = 10
	}
	borderWidth := style.BorderWidth
	if borderWidth <= 0 {
		borderWidth = 2
	}
	fontColor := style.FontColor
	if fontColor == "" {
		fontColor = "#FFFFFF"
	}
	borderColor := style.BorderColor
	if borderColor == "" {
		borderColor = "#000000"
	}
	backgroundColor := style.BackgroundColor
	if backgroundColor == "" {
		backgroundColor = "#000000"
	}
	backgroundAlpha := style.BackgroundAlpha
	if backgroundAlpha < 0 {
		backgroundAlpha = 0
	}
	if backgroundAlpha > 1 {
		backgroundAlpha = 1
	}
	borderStyle := 1
	outline := borderWidth
	outlineColor := assColor(borderColor, 1)
	if backgroundAlpha > 0 {
		borderStyle = 3
		outline = 1
		outlineColor = assColor(backgroundColor, backgroundAlpha)
	}
	return fmt.Sprintf("Alignment=%d,Fontname=%s,Fontsize=%d,PrimaryColour=%s,OutlineColour=%s,BackColour=%s,BorderStyle=%d,Outline=%d,Shadow=0,MarginV=25,Bold=1", alignment, fontName, fontSize, assColor(fontColor, 1), outlineColor, assColor("#000000", 0), borderStyle, outline)
}

func assColor(value string, opacity float64) string {
	value = strings.TrimPrefix(strings.TrimSpace(value), "#")
	if len(value) != 6 {
		value = "FFFFFF"
	}
	parsed, err := strconv.ParseUint(value, 16, 32)
	if err != nil {
		parsed = 0xFFFFFF
	}
	if opacity < 0 {
		opacity = 0
	}
	if opacity > 1 {
		opacity = 1
	}
	alpha := int((1-opacity)*255 + 0.5)
	r := (parsed >> 16) & 0xFF
	g := (parsed >> 8) & 0xFF
	b := parsed & 0xFF
	return fmt.Sprintf("&H%02X%02X%02X%02X", alpha, b, g, r)
}

func SafeMediaPath(root, candidate string) bool {
	rootAbs, rootErr := filepath.Abs(root)
	candidateAbs, candidateErr := filepath.Abs(candidate)
	if rootErr != nil || candidateErr != nil {
		return false
	}
	relative, err := filepath.Rel(rootAbs, candidateAbs)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

func BurnSubtitles(ctx context.Context, runner CommandRunner, inputPath, subtitlePath, outputPath string, style SubtitleStyle) error {
	if runner == nil {
		runner = ExecCommandRunner{}
	}
	return runner.Run(ctx, "ffmpeg", SubtitleBurnArgs(inputPath, subtitlePath, outputPath, style)...)
}

type SubtitleCue struct {
	Text    string `json:"text"`
	StartMs int    `json:"startMs"`
	EndMs   int    `json:"endMs"`
}

type subtitleCueTiming struct {
	text       string
	start, end float64
}

func collectSubtitleCueTimings(transcript map[string]any, start, end float64) []subtitleCueTiming {
	segments, _ := transcript["segments"].([]any)
	entries := make([]subtitleCueTiming, 0)
	for _, rawSegment := range segments {
		segment, _ := rawSegment.(map[string]any)
		segmentWords, _ := segment["words"].([]any)
		addedWord := false
		for _, rawWord := range segmentWords {
			word, _ := rawWord.(map[string]any)
			wordStart, okStart := numberValue(word["start"])
			wordEnd, okEnd := numberValue(word["end"])
			text, _ := word["word"].(string)
			if !okStart || !okEnd || strings.TrimSpace(text) == "" || wordEnd <= start || wordStart >= end {
				continue
			}
			entries = append(entries, subtitleCueTiming{text: strings.TrimSpace(text), start: maxFloat64(wordStart-start, 0), end: minFloat(wordEnd-start, end-start)})
			addedWord = true
		}
		if addedWord {
			continue
		}

		segmentStart, okStart := numberValue(segment["start"])
		segmentEnd, okEnd := numberValue(segment["end"])
		text, _ := segment["text"].(string)
		if !okStart || !okEnd || strings.TrimSpace(text) == "" || segmentEnd <= start || segmentStart >= end {
			continue
		}
		entries = append(entries, subtitleCueTiming{text: strings.TrimSpace(text), start: maxFloat64(segmentStart-start, 0), end: minFloat(segmentEnd-start, end-start)})
	}
	return entries
}

func BuildSubtitleCues(transcript map[string]any, start, end float64) []SubtitleCue {
	entries := collectSubtitleCueTimings(transcript, start, end)
	cues := make([]SubtitleCue, 0, len(entries))
	for _, entry := range entries {
		cues = append(cues, SubtitleCue{Text: entry.text, StartMs: int(math.Round(entry.start * 1000)), EndMs: int(math.Round(entry.end * 1000))})
	}
	return cues
}

func BuildWordSRT(transcript map[string]any, start, end float64) (string, error) {
	words := collectSubtitleCueTimings(transcript, start, end)
	var output strings.Builder
	sequence := 1
	current := make([]subtitleCueTiming, 0)
	writeCue := func() {
		if len(current) == 0 {
			return
		}
		text := make([]string, 0, len(current))
		for _, word := range current {
			text = append(text, word.text)
		}
		fmt.Fprintf(&output, "%d\n%s --> %s\n%s\n\n", sequence, formatSRTTime(current[0].start), formatSRTTime(current[len(current)-1].end), strings.Join(text, " "))
		sequence++
		current = current[:0]
	}
	for _, word := range words {
		if len(current) == 0 {
			current = append(current, word)
			continue
		}
		last := current[len(current)-1]
		currentLength := 0
		for _, item := range current {
			currentLength += len(item.text) + 1
		}
		if sentenceEnd(last.text) || currentLength+len(word.text) > 20 || word.end-current[0].start > 2 {
			writeCue()
		}
		current = append(current, word)
	}
	writeCue()
	if sequence == 1 {
		return "", fmt.Errorf("no words found for this clip range")
	}
	return output.String(), nil
}

func sentenceEnd(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return false
	}
	last := value[len(value)-1]
	return last == '.' || last == '!' || last == '?' || last == '\xE2'
}

func minFloat(left, right float64) float64 {
	if left < right {
		return left
	}
	return right
}

func maxFloat64(left, right float64) float64 {
	if left > right {
		return left
	}
	return right
}

func numberValue(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case int:
		return float64(typed), true
	case json.Number:
		parsed, err := typed.Float64()
		return parsed, err == nil
	default:
		return 0, false
	}
}

func formatSRTTime(seconds float64) string {
	if seconds < 0 {
		seconds = 0
	}
	milliseconds := int(seconds*1000 + 0.5)
	hours := milliseconds / 3600000
	milliseconds %= 3600000
	minutes := milliseconds / 60000
	milliseconds %= 60000
	wholeSeconds := milliseconds / 1000
	milliseconds %= 1000
	return strconv.Itoa(hours) + ":" + twoDigits(minutes) + ":" + twoDigits(wholeSeconds) + "," + threeDigits(milliseconds)
}

func twoDigits(value int) string {
	if value < 10 {
		return "0" + strconv.Itoa(value)
	}
	return strconv.Itoa(value)
}
func threeDigits(value int) string {
	if value < 10 {
		return "00" + strconv.Itoa(value)
	}
	if value < 100 {
		return "0" + strconv.Itoa(value)
	}
	return strconv.Itoa(value)
}
