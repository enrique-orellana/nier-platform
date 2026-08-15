package jobs

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/mutonby/openshorts/backend-go/internal/domain"
)

func TestPostgresHighlightProjectSurvivesReopen(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not configured")
	}
	ctx := context.Background()
	first, err := OpenPostgresStore(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	project, job, err := first.CreateHighlightProject(ctx, domain.CreateHighlightProjectInput{
		Name:                 fmt.Sprintf("durability-%d", time.Now().UnixNano()),
		SourceBucket:         "youtube-downloads",
		SourceKey:            "durability.mp4",
		MinDurationSeconds:   720,
		IdealDurationSeconds: 1200,
	})
	if err != nil {
		_ = first.Close()
		t.Fatal(err)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}

	second, err := OpenPostgresStore(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	gotProject, gotJob, err := second.GetHighlightProject(ctx, project.ID)
	if err != nil {
		t.Fatal(err)
	}
	if gotProject.LatestJobID != job.ID || gotJob.ProjectID != project.ID {
		t.Fatalf("association not durable: project=%#v job=%#v", gotProject, gotJob)
	}
	if err := second.DeleteHighlightProject(ctx, project.ID); err != nil {
		t.Fatal(err)
	}
}

func TestMemoryStoreCreatesAndListsHighlightProject(t *testing.T) {
	store := NewMemoryStore()
	project, job, err := store.CreateHighlightProject(context.Background(), domain.CreateHighlightProjectInput{
		Name:                 "Episode one",
		SourceBucket:         "youtube-downloads",
		SourceKey:            "videos/episode-one.mp4",
		MinDurationSeconds:   720,
		IdealDurationSeconds: 1200,
	})
	if err != nil {
		t.Fatal(err)
	}
	if project.LatestJobID != job.ID || job.ProjectID != project.ID {
		t.Fatalf("project/job association missing: project=%#v job=%#v", project, job)
	}

	projects, err := store.ListHighlightProjects(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(projects) != 1 || projects[0].ID != project.ID {
		t.Fatalf("unexpected projects: %#v", projects)
	}
}

func TestMemoryStoreRetryKeepsProjectAndCreatesNewJob(t *testing.T) {
	store := NewMemoryStore()
	project, first, err := store.CreateHighlightProject(context.Background(), domain.CreateHighlightProjectInput{
		Name:                 "Retry me",
		SourceBucket:         "youtube-downloads",
		SourceKey:            "source.mp4",
		MinDurationSeconds:   720,
		IdealDurationSeconds: 1200,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Transition(context.Background(), first.ID, domain.JobStatusFailed, "analysis failed"); err != nil {
		t.Fatal(err)
	}

	second, err := store.RetryHighlightProject(context.Background(), project.ID)
	if err != nil {
		t.Fatal(err)
	}
	if second.ID == first.ID || second.ProjectID != project.ID || second.Status != domain.JobStatusQueued {
		t.Fatalf("unexpected retry job: %#v", second)
	}
	updated, latest, err := store.GetHighlightProject(context.Background(), project.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.LatestJobID != second.ID || latest.ID != second.ID {
		t.Fatalf("latest job was not updated: project=%#v job=%#v", updated, latest)
	}
}

func TestMemoryStoreRejectsEditingActiveProject(t *testing.T) {
	store := NewMemoryStore()
	project, _, err := store.CreateHighlightProject(context.Background(), domain.CreateHighlightProjectInput{
		Name:                 "Active",
		SourceBucket:         "youtube-downloads",
		SourceKey:            "source.mp4",
		MinDurationSeconds:   720,
		IdealDurationSeconds: 1200,
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.UpdateHighlightProject(context.Background(), project.ID, domain.UpdateHighlightProjectInput{
		Name:                 "Changed",
		MinDurationSeconds:   900,
		IdealDurationSeconds: 1500,
	})
	if !errors.Is(err, ErrProjectActive) {
		t.Fatalf("expected ErrProjectActive, got %v", err)
	}
}

func TestMemoryStoreDeletesProjectAndJobs(t *testing.T) {
	store := NewMemoryStore()
	project, job, err := store.CreateHighlightProject(context.Background(), domain.CreateHighlightProjectInput{
		Name:                 "Delete me",
		SourceBucket:         "youtube-downloads",
		SourceKey:            "source.mp4",
		MinDurationSeconds:   720,
		IdealDurationSeconds: 1200,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Transition(context.Background(), job.ID, domain.JobStatusCancelled, "cancelled"); err != nil {
		t.Fatal(err)
	}
	if err := store.DeleteHighlightProject(context.Background(), project.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.GetHighlightProject(context.Background(), project.ID); !errors.Is(err, ErrProjectNotFound) {
		t.Fatalf("expected project to be deleted, got %v", err)
	}
	if _, ok := store.Get(context.Background(), job.ID); ok {
		t.Fatal("expected project job to be deleted")
	}
}
