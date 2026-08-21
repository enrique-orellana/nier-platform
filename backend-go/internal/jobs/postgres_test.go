package jobs

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/mutonby/openshorts/backend-go/internal/domain"
)

func TestClipStatusSchemaIncludesDiscarded(t *testing.T) {
	if !strings.Contains(jobsSchema, "'discarded'") {
		t.Fatal("clip status schema does not allow discarded")
	}
	contents, err := os.ReadFile("migrations/004_discarded_clip_status.sql")
	if err != nil {
		t.Fatalf("read discarded clip status migration: %v", err)
	}
	if !strings.Contains(string(contents), "'discarded'") {
		t.Fatal("discarded clip status migration does not allow discarded")
	}
}

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

func TestPostgresStorePersistsClipStatusAcrossReopen(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not configured")
	}
	ctx := context.Background()
	first, err := OpenPostgresStore(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open first store: %v", err)
	}
	job, err := first.Create(ctx, domain.CreateJobInput{Kind: "postgres-clip-status-test"})
	if err != nil {
		_ = first.Close()
		t.Fatalf("create job: %v", err)
	}
	if _, err := first.SetClipStatus(ctx, job.ID, 2, "discarded"); err != nil {
		_ = first.Close()
		t.Fatalf("set clip status: %v", err)
	}
	if err := first.Close(); err != nil {
		t.Fatalf("close first store: %v", err)
	}

	second, err := OpenPostgresStore(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open second store: %v", err)
	}
	defer second.Close()
	defer second.db.ExecContext(ctx, `DELETE FROM clip_statuses WHERE project_id = $1`, job.ID)
	defer second.db.ExecContext(ctx, `DELETE FROM jobs WHERE id = $1`, job.ID)
	statuses, err := second.GetClipStatuses(ctx, job.ID)
	if err != nil {
		t.Fatalf("get clip statuses: %v", err)
	}
	status, ok := statuses[2]
	if !ok || status.Status != "discarded" || status.UpdatedAt.IsZero() {
		t.Fatalf("clip status did not persist across reopen: %#v", statuses)
	}
}

func TestPostgresStorePersistsAuditEventAcrossReopen(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not configured")
	}
	ctx := context.Background()
	first, err := OpenPostgresStore(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open first store: %v", err)
	}
	job, err := first.Create(ctx, domain.CreateJobInput{Kind: "postgres-audit-test"})
	if err != nil {
		_ = first.Close()
		t.Fatalf("create job: %v", err)
	}
	event, err := first.StartAuditEvent(ctx, job.ID, domain.StartAuditEventInput{
		Category:    "external_request",
		Name:        "ai.analysis",
		Host:        "openrouter.ai",
		Method:      "POST",
		RequestBody: `{"prompt":"safe"}`,
		CaptureMode: "full_redacted",
	})
	if err != nil {
		_ = first.Close()
		t.Fatalf("start audit event: %v", err)
	}
	if _, err := first.FinishAuditEvent(ctx, job.ID, event.ID, domain.FinishAuditEventInput{
		Status:       domain.AuditEventStatusCompleted,
		HTTPStatus:   200,
		ResponseBody: `{"ok":true}`,
		DurationMS:   42,
		FinishedAt:   event.StartedAt.Add(42 * time.Millisecond),
	}); err != nil {
		_ = first.Close()
		t.Fatalf("finish audit event: %v", err)
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
	events, err := second.ListAuditEvents(ctx, job.ID)
	if err != nil {
		t.Fatalf("list audit events after reopen: %v", err)
	}
	if len(events) != 1 || events[0].Sequence != 1 || events[0].Status != domain.AuditEventStatusCompleted || events[0].DurationMS != 42 {
		t.Fatalf("audit event did not persist across reopen: %#v", events)
	}
	if events[0].RequestBody != `{"prompt":"safe"}` || events[0].ResponseBody != `{"ok":true}` {
		t.Fatalf("audit bodies did not persist across reopen: %#v", events[0])
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
