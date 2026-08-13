package media

import (
	"context"
	"reflect"
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
	args := SubtitleBurnArgs("input.mp4", "captions.srt", "output.mp4", SubtitleStyle{Alignment: "bottom", FontSize: 16})
	want := []string{"-y", "-i", "input.mp4", "-vf", "subtitles=captions.srt", "-c:a", "copy", "output.mp4"}
	if !reflect.DeepEqual(args, want) {
		t.Fatalf("args = %#v, want %#v", args, want)
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
