package media

import (
	"context"
	"encoding/json"
	"fmt"
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
	Alignment string
	FontSize  int
}

func SubtitleBurnArgs(inputPath, subtitlePath, outputPath string, style SubtitleStyle) []string {
	_ = style
	return []string{"-y", "-i", inputPath, "-vf", "subtitles=" + subtitlePath, "-c:a", "copy", outputPath}
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

func BuildWordSRT(transcript map[string]any, start, end float64) (string, error) {
	segments, _ := transcript["segments"].([]any)
	var output strings.Builder
	sequence := 1
	for _, rawSegment := range segments {
		segment, _ := rawSegment.(map[string]any)
		words, _ := segment["words"].([]any)
		for _, rawWord := range words {
			word, _ := rawWord.(map[string]any)
			wordStart, okStart := numberValue(word["start"])
			wordEnd, okEnd := numberValue(word["end"])
			text, _ := word["word"].(string)
			if !okStart || !okEnd || strings.TrimSpace(text) == "" || wordEnd <= start || wordStart >= end {
				continue
			}
			if wordStart < start {
				wordStart = start
			}
			if wordEnd > end {
				wordEnd = end
			}
			fmt.Fprintf(&output, "%d\n%s --> %s\n%s\n\n", sequence, formatSRTTime(wordStart-start), formatSRTTime(wordEnd-start), strings.TrimSpace(text))
			sequence++
		}
	}
	if sequence == 1 {
		return "", fmt.Errorf("no words found for this clip range")
	}
	return output.String(), nil
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
