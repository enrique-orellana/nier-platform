package media

import (
	"context"
	"strings"
	"testing"
)

type recordingRunner struct {
	name string
	args []string
}

func (r *recordingRunner) Run(_ context.Context, name string, args ...string) error {
	r.name, r.args = name, args
	return nil
}

func TestSubtitleBurnArgsDoNotUseShellInterpolation(t *testing.T) {
	args := SubtitleBurnArgs(`input.mp4`, `C:\tmp\captions.srt`, `output.mp4`, SubtitleStyle{
		Alignment: "top", FontSize: 20, FontName: "Arial", FontColor: "#FF0000", BorderColor: "#000000", BorderWidth: 3,
	})
	filter := args[4]
	for _, expected := range []string{
		`subtitles='C\:/tmp/captions.srt'`,
		`force_style='`,
		`Alignment=6`,
		`Fontname=Arial`,
		`Fontsize=17`,
		`PrimaryColour=&H000000FF`,
		`Outline=3`,
		`setsar=1`,
		`colorspace=all=bt709:iall=bt709:range=tv:irange=tv`,
	} {
		if !strings.Contains(filter, expected) {
			t.Fatalf("filter %q does not contain %q", filter, expected)
		}
	}
	for _, pair := range [][]string{{"-c:v", "libx264"}, {"-profile:v", "high"}, {"-level:v", "4.2"}, {"-preset", "veryslow"}, {"-crf", "14"}, {"-pix_fmt", "yuv420p"}, {"-c:a", "aac"}, {"-ar", "48000"}, {"-ac", "2"}, {"-b:a", "192k"}, {"-movflags", "+faststart"}} {
		if !containsArgPair(args, pair[0], pair[1]) {
			t.Fatalf("args %#v does not contain %s %s", args, pair[0], pair[1])
		}
	}
}

func containsArgPair(args []string, key, value string) bool {
	for index := 0; index+1 < len(args); index++ {
		if args[index] == key && args[index+1] == value {
			return true
		}
	}
	return false
}

func TestBuildWordSRTGroupsWordsIntoReadableCues(t *testing.T) {
	transcript := map[string]any{"segments": []any{map[string]any{"words": []any{
		map[string]any{"word": "one", "start": 0.0, "end": 0.3},
		map[string]any{"word": "two", "start": 0.4, "end": 0.7},
		map[string]any{"word": "three", "start": 0.8, "end": 1.1},
	}}}}
	srt, err := BuildWordSRT(transcript, 0, 2)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(srt, " --> ") != 1 || !strings.Contains(srt, "one two three") {
		t.Fatalf("expected one grouped cue, got %q", srt)
	}
}

func TestBuildWordSRTFallsBackToTranscriptSegments(t *testing.T) {
	transcript := map[string]any{"segments": []any{
		map[string]any{"start": 1.0, "end": 2.5, "text": "A segment caption"},
	}}
	srt, err := BuildWordSRT(transcript, 1, 3)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(srt, "A segment caption") || !strings.Contains(srt, "0:00:00,000 --> 0:00:01,500") {
		t.Fatalf("expected segment caption with clipped timing, got %q", srt)
	}
}

func TestSafeMediaPathRejectsTraversal(t *testing.T) {
	if SafeMediaPath("output/job", "output/job/clip.mp4") == false {
		t.Fatal("expected path inside root to be accepted")
	}
	if SafeMediaPath("output/job", "output/job/../other.mp4") {
		t.Fatal("expected traversal path to be rejected")
	}
}

func TestBurnSubtitlesUsesInjectedRunner(t *testing.T) {
	runner := &recordingRunner{}
	if err := BurnSubtitles(context.Background(), runner, "input.mp4", "captions.srt", "output.mp4", SubtitleStyle{}); err != nil {
		t.Fatal(err)
	}
	if runner.name != "ffmpeg" || len(runner.args) == 0 || runner.args[len(runner.args)-1] != "output.mp4" {
		t.Fatalf("unexpected command: %q %#v", runner.name, runner.args)
	}
}
