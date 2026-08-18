package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mutonby/openshorts/backend-go/internal/config"
	"github.com/mutonby/openshorts/backend-go/internal/domain"
	"github.com/mutonby/openshorts/backend-go/internal/jobs"
)

func TestDeleteProjectRemovesItFromProjectHistory(t *testing.T) {
	store := jobs.NewMemoryStore()
	job, err := store.Create(context.Background(), domain.CreateJobInput{Kind: "clip-generation"})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetResult(context.Background(), job.ID, []byte(`{"clips":[{"video_filename":"clip.mp4"}]}`)); err != nil {
		t.Fatal(err)
	}
	server := NewServerWithStore(config.Config{OutputDir: t.TempDir()}, store)

	deleteRequest := httptest.NewRequest(http.MethodDelete, "/api/projects/"+job.ID, nil)
	deleteResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(deleteResponse, deleteRequest)
	if deleteResponse.Code != http.StatusOK {
		t.Fatalf("expected project deletion to succeed, got %d: %s", deleteResponse.Code, deleteResponse.Body.String())
	}

	historyRequest := httptest.NewRequest(http.MethodGet, "/api/projects/history", nil)
	historyResponse := httptest.NewRecorder()
	server.Handler().ServeHTTP(historyResponse, historyRequest)
	if historyResponse.Code != http.StatusOK {
		t.Fatalf("expected project history to load, got %d: %s", historyResponse.Code, historyResponse.Body.String())
	}
	if strings.Contains(historyResponse.Body.String(), job.ID) {
		t.Fatalf("deleted project still appears in history: %s", historyResponse.Body.String())
	}
}
