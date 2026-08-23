package main

import "testing"

func TestNeedsHostEncoder(t *testing.T) {
	if !needsHostEncoder([]string{"-c:v", "h264_nvenc"}) {
		t.Fatal("expected NVENC video encoding to use the host encoder")
	}
	if needsHostEncoder([]string{"-c:a", "libfdk_aac"}) {
		t.Fatal("expected audio-only preprocessing to use the bundled encoder")
	}
}

func TestRewriteVideoArgsForAmf(t *testing.T) {
	got := rewriteVideoArgs([]string{
		"-c:v", "h264_nvenc",
		"-c:a", "libfdk_aac",
		"-preset", "fast",
		"-b:v", "20M",
	})
	want := []string{"-c:v", "h264_amf", "-c:a", "aac", "-b:v", "20M"}

	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}
