package integrations

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestElevenLabsTranslationCreatesPollsAndDownloads(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/dubbing":
			if r.Method != http.MethodPost || r.Header.Get("xi-api-key") != "secret" {
				t.Fatalf("unexpected create request: %s %s", r.Method, r.Header.Get("xi-api-key"))
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"dubbing_id":"dub-1"}`))
		case "/v1/dubbing/dub-1":
			_, _ = w.Write([]byte(`{"status":"dubbed"}`))
		case "/v1/dubbing/dub-1/audio/es":
			_, _ = w.Write([]byte("translated-video"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	output := filepath.Join(t.TempDir(), "translated.mp4")
	client := ElevenLabsClient{BaseURL: server.URL + "/v1", HTTP: server.Client(), PollInterval: -1}
	if err := client.TranslateFile(context.Background(), "input.mp4", []byte("source-video"), "es", "en", "secret", output); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "translated-video" {
		t.Fatalf("unexpected output: %q", data)
	}
}
