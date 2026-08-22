package versions

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
)

func TestPostgresRepositoryDeletesCurrentVersionAndRepointsHead(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not configured")
	}

	config, err := pgx.ParseConfig(databaseURL)
	if err != nil {
		t.Fatalf("parse database URL: %v", err)
	}
	db := sql.OpenDB(stdlib.GetConnector(*config))
	defer db.Close()
	ctx := context.Background()
	if err := db.PingContext(ctx); err != nil {
		t.Fatalf("ping database: %v", err)
	}
	repo, err := NewPostgresRepository(db)
	if err != nil {
		t.Fatalf("create repository: %v", err)
	}

	projectID := fmt.Sprintf("postgres-delete-test-%d", time.Now().UnixNano())
	defer func() {
		_, _ = db.ExecContext(ctx, `DELETE FROM clip_version_heads WHERE project_id = $1`, projectID)
		_, _ = db.ExecContext(ctx, `DELETE FROM clip_versions WHERE project_id = $1`, projectID)
	}()

	first, _, err := repo.Create(ctx, projectID, 0, map[string]any{"name": "first"}, nil)
	if err != nil {
		t.Fatalf("create first version: %v", err)
	}
	if _, err := repo.Complete(ctx, projectID, 0, first.VersionID, "/videos/first.mp4"); err != nil {
		t.Fatalf("complete first version: %v", err)
	}
	second, _, err := repo.Create(ctx, projectID, 0, map[string]any{"name": "second"}, nil)
	if err != nil {
		t.Fatalf("create second version: %v", err)
	}
	if _, err := repo.Complete(ctx, projectID, 0, second.VersionID, "/videos/second.mp4"); err != nil {
		t.Fatalf("complete second version: %v", err)
	}

	deleted, replacement, err := repo.Delete(ctx, projectID, 0, second.VersionID)
	if err != nil {
		t.Fatalf("delete current version: %v", err)
	}
	if deleted.VersionID != second.VersionID || replacement != first.VersionID {
		t.Fatalf("unexpected deletion result: deleted=%#v replacement=%q", deleted, replacement)
	}
	current, remaining, err := repo.List(ctx, projectID, 0)
	if err != nil {
		t.Fatalf("list versions after deletion: %v", err)
	}
	if current != first.VersionID || len(remaining) != 1 || remaining[0].VersionID != first.VersionID {
		t.Fatalf("unexpected post-delete history: current=%q remaining=%#v", current, remaining)
	}
}
