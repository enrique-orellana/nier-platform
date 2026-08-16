package jobs

import (
	"context"
	"os"
	"testing"

	"github.com/mutonby/openshorts/backend-go/internal/domain"
)

func TestNewPostgresStoreRequiresDatabase(t *testing.T) {
	if _, err := NewPostgresStore(nil); err == nil {
		t.Fatal("expected nil database to be rejected")
	}
}

func TestPostgresStorePersistsJobAcrossReopen(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not configured")
	}
	ctx := context.Background()
	first, err := OpenPostgresStore(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open first store: %v", err)
	}
	job, err := first.Create(ctx, domain.CreateJobInput{Kind: "postgres-test", OutputDir: "output/test"})
	if err != nil {
		_ = first.Close()
		t.Fatalf("create job: %v", err)
	}
	if err := first.AppendLog(ctx, job.ID, "persisted log"); err != nil {
		_ = first.Close()
		t.Fatalf("append log: %v", err)
	}
	if err := first.SetResult(ctx, job.ID, []byte(`{"ok":true}`)); err != nil {
		_ = first.Close()
		t.Fatalf("set result: %v", err)
	}
	if err := first.Close(); err != nil {
		t.Fatalf("close first store: %v", err)
	}

	second, err := OpenPostgresStore(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open second store: %v", err)
	}
	defer second.Close()
	defer second.db.ExecContext(ctx, `DELETE FROM jobs WHERE id = $1`, job.ID)
	loaded, ok := second.Get(ctx, job.ID)
	if !ok || len(loaded.Logs) != 1 || loaded.Logs[0].Message != "persisted log" || string(loaded.Result) != `{"ok":true}` {
		t.Fatalf("job did not persist across reopen: %#v", loaded)
	}
}

func TestPostgresStorePersistsClipRenderIdentityAndDeduplicates(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not configured")
	}
	ctx := context.Background()
	store, err := OpenPostgresStore(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()

	parent, err := store.Create(ctx, domain.CreateJobInput{Kind: "postgres-deferred-parent", OutputDir: "output/parent"})
	if err != nil {
		t.Fatalf("create parent: %v", err)
	}
	input := domain.CreateJobInput{
		Kind:        "clip-render",
		ParentJobID: parent.ID,
		ClipIndex:   4,
		OutputDir:   "output/parent",
	}
	child, err := store.CreateClipRenderIfAbsent(ctx, input)
	if err != nil {
		t.Fatalf("create child: %v", err)
	}
	defer store.db.ExecContext(ctx, `DELETE FROM jobs WHERE id = $1 OR id = $2`, parent.ID, child.ID)
	duplicate, err := store.CreateClipRenderIfAbsent(ctx, input)
	if err != nil {
		t.Fatalf("deduplicate child: %v", err)
	}
	if duplicate.ID != child.ID || duplicate.ParentJobID != parent.ID || duplicate.ClipIndex != 4 {
		t.Fatalf("unexpected deduplicated child: %#v", duplicate)
	}
}
