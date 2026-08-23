package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/mutonby/openshorts/backend-go/internal/config"
	"github.com/mutonby/openshorts/backend-go/internal/integrations"
)

func TestMediaURLReturnsFreshSignedObjectURL(t *testing.T) {
	server := NewServer(config.Config{})
	server.s3Store = &integrations.S3Store{
		Bucket:        "openshorts-media",
		PublicURLBase: "http://storage.example",
	}
	target := "http://storage.example/openshorts-media/job/clips/render-1/source_clip_14.mp4"
	request := httptest.NewRequest(http.MethodGet, "/api/media-url?url="+url.QueryEscape(target), nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected JSON response, got %d: %s", response.Code, response.Body.String())
	}
	var payload struct {
		URL       string `json:"url"`
		ExpiresAt string `json:"expiresAt"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.URL != target {
		t.Fatalf("unexpected refreshed URL: %s", payload.URL)
	}
	if payload.ExpiresAt == "" {
		t.Fatal("expected media URL expiration timestamp")
	}
}
