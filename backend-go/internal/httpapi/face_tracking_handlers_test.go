package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/mutonby/openshorts/backend-go/internal/config"
	"github.com/mutonby/openshorts/backend-go/internal/domain"
	"github.com/mutonby/openshorts/backend-go/internal/jobs"
)

type faceTrackingTestWorker struct {
	mu      sync.Mutex
	calls   int
	started chan struct{}
	release chan struct{}
}

func (worker *faceTrackingTestWorker) Run(_ context.Context, _ string, operation string, _ map[string]any, _ map[string]string) (json.RawMessage, error) {
	if operation != "face_tracking" {
		panic("unexpected operation: " + operation)
	}
	worker.mu.Lock()
	worker.calls++
	if worker.started != nil && worker.calls == 1 {
		close(worker.started)
	}
	worker.mu.Unlock()
	if worker.release != nil {
		<-worker.release
	}
	return json.RawMessage(`{"track":{"scenes":[{"start_sec":0,"end_sec":2,"strategy":"TRACK","keyframes":[{"time_sec":0,"rect":{"x":0.25,"y":0,"width":0.5,"height":1}},{"time_sec":2,"rect":{"x":0.4,"y":0,"width":0.5,"height":1}}]}]}}`), nil
}

func newFaceTrackingTestServer(t *testing.T, worker OperationClient) (*Server, *jobs.MemoryStore, string) {
	t.Helper()
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "source.mp4"), []byte("master"), 0o644); err != nil {
		t.Fatal(err)
	}
	store := jobs.NewMemoryStore()
	job, err := store.Create(context.Background(), domain.CreateJobInput{Kind: "highlight-generation", OutputDir: root})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetResult(context.Background(), job.ID, []byte(`{"clips":[{"start":0,"end":2,"source_video_filename":"source.mp4"}]}`)); err != nil {
		t.Fatal(err)
	}
	return NewServerWithDependencies(config.Config{OutputDir: root}, store, nil, worker), store, job.ID
}

func doFaceTrackingRequest(t *testing.T, server *Server, jobID string, start, end float64, width, height int) map[string]any {
	t.Helper()
	body := `{"start_seconds":0,"end_seconds":2,"source_width":1920,"source_height":1080,"algorithm_version":"yolo-standard-v1"}`
	if start != 0 || end != 2 || width != 1920 || height != 1080 {
		bodyBytes, _ := json.Marshal(map[string]any{
			"start_seconds": start, "end_seconds": end, "source_width": width,
			"source_height": height, "algorithm_version": faceTrackingAlgorithmVersion,
		})
		body = string(bodyBytes)
	}
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/clip/"+jobID+"/0/face-tracking", strings.NewReader(body)))
	if response.Code != http.StatusOK {
		t.Fatalf("expected face tracking response, got %d: %s", response.Code, response.Body.String())
	}
	var payload map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	return payload
}

func TestFaceTrackingEndpointCachesWorkerResult(t *testing.T) {
	worker := &faceTrackingTestWorker{}
	server, _, jobID := newFaceTrackingTestServer(t, worker)

	first := doFaceTrackingRequest(t, server, jobID, 0, 2, 1920, 1080)
	second := doFaceTrackingRequest(t, server, jobID, 0, 2, 1920, 1080)
	if first["cache_hit"] != false || second["cache_hit"] != true {
		t.Fatalf("unexpected cache flags: %#v %#v", first["cache_hit"], second["cache_hit"])
	}
	worker.mu.Lock()
	calls := worker.calls
	worker.mu.Unlock()
	if calls != 1 {
		t.Fatalf("expected one worker call, got %d", calls)
	}
	if first["track"] == nil {
		t.Fatal("expected track in response")
	}
}

func TestFaceTrackingEndpointDeduplicatesConcurrentMisses(t *testing.T) {
	worker := &faceTrackingTestWorker{started: make(chan struct{}), release: make(chan struct{})}
	server, _, jobID := newFaceTrackingTestServer(t, worker)
	responses := make(chan int, 2)
	for range 2 {
		go func() {
			request := httptest.NewRequest(http.MethodPost, "/api/clip/"+jobID+"/0/face-tracking", strings.NewReader(`{"start_seconds":0,"end_seconds":2,"source_width":1920,"source_height":1080,"algorithm_version":"yolo-standard-v1"}`))
			response := httptest.NewRecorder()
			server.Handler().ServeHTTP(response, request)
			responses <- response.Code
		}()
	}
	select {
	case <-worker.started:
	case <-time.After(2 * time.Second):
		t.Fatal("worker did not start")
	}
	worker.mu.Lock()
	if worker.calls != 1 {
		t.Fatalf("expected one in-flight worker call, got %d", worker.calls)
	}
	worker.mu.Unlock()
	close(worker.release)
	for range 2 {
		if code := <-responses; code != http.StatusOK {
			t.Fatalf("expected concurrent request to succeed, got %d", code)
		}
	}
}

func TestFaceTrackingEndpointRejectsInvalidRequests(t *testing.T) {
	server, _, jobID := newFaceTrackingTestServer(t, &faceTrackingTestWorker{})

	for _, test := range []struct {
		name   string
		method string
		body   string
		want   int
	}{
		{name: "method", method: http.MethodGet, body: "", want: http.StatusMethodNotAllowed},
		{name: "json", method: http.MethodPost, body: "not-json", want: http.StatusBadRequest},
		{name: "range", method: http.MethodPost, body: `{"start_seconds":2,"end_seconds":1,"source_width":1920,"source_height":1080,"algorithm_version":"yolo-standard-v1"}`, want: http.StatusBadRequest},
		{name: "algorithm", method: http.MethodPost, body: `{"start_seconds":0,"end_seconds":2,"source_width":1920,"source_height":1080,"algorithm_version":"old"}`, want: http.StatusBadRequest},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			server.Handler().ServeHTTP(response, httptest.NewRequest(test.method, "/api/clip/"+jobID+"/0/face-tracking", strings.NewReader(test.body)))
			if response.Code != test.want {
				t.Fatalf("expected status %d, got %d: %s", test.want, response.Code, response.Body.String())
			}
		})
	}
}
