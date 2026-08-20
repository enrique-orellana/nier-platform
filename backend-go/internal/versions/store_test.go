package versions

import (
	"os"
	"path/filepath"
	"testing"
)

func TestStoreCreatesImmutableVersionAndPromotesCompletedVersion(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatalf("create store: %v", err)
	}
	created, err := store.CreateVersion(map[string]any{"name": "first"}, nil)
	if err != nil {
		t.Fatalf("create version: %v", err)
	}
	if created.VersionID == "" || created.Status != RenderStatusPending || created.ManifestRevision == "" {
		t.Fatalf("unexpected version: %#v", created)
	}
	manifest, err := store.LoadManifest(created.VersionID)
	if err != nil {
		t.Fatalf("load manifest: %v", err)
	}
	if manifest["version_id"] != created.VersionID || manifest["render_status"] != string(RenderStatusPending) {
		t.Fatalf("unexpected manifest: %#v", manifest)
	}

	if _, err := store.PromoteVersion(created.VersionID, "/videos/first.mp4"); err == nil {
		t.Fatal("expected pending version promotion to fail")
	}
	if _, err := store.UpdateRender(created.VersionID, RenderStatusDone, ""); err != nil {
		t.Fatalf("mark version done: %v", err)
	}
	promoted, err := store.PromoteVersion(created.VersionID, "/videos/first.mp4")
	if err != nil {
		t.Fatalf("promote version: %v", err)
	}
	if promoted.OutputURL != "/videos/first.mp4" || store.CurrentVersionID() != created.VersionID {
		t.Fatalf("unexpected promotion: %#v", promoted)
	}
}

func TestStoreRequiresExistingParentAndValidRenderStatus(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatalf("create store: %v", err)
	}
	if _, err := store.CreateVersion(map[string]any{}, stringPtr("00000000-0000-0000-0000-000000000000")); err == nil {
		t.Fatal("expected missing parent to fail")
	}
	created, err := store.CreateVersion(map[string]any{}, nil)
	if err != nil {
		t.Fatalf("create version: %v", err)
	}
	if _, err := store.UpdateRender(created.VersionID, "unknown", ""); err == nil {
		t.Fatal("expected invalid render status to fail")
	}
}

func TestStoreDeletesOneVersionAndFallsBackWhenDeletingCurrent(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatalf("create store: %v", err)
	}
	v0, err := store.CreateVersion(map[string]any{"name": "first"}, nil)
	if err != nil {
		t.Fatalf("create first version: %v", err)
	}
	v1, err := store.CreateVersion(map[string]any{"name": "middle"}, &v0.VersionID)
	if err != nil {
		t.Fatalf("create middle version: %v", err)
	}
	v2, err := store.CreateVersion(map[string]any{"name": "last"}, &v1.VersionID)
	if err != nil {
		t.Fatalf("create last version: %v", err)
	}
	for _, version := range []VersionRecord{v0, v1, v2} {
		if _, err := store.UpdateRender(version.VersionID, RenderStatusDone, ""); err != nil {
			t.Fatalf("mark version done: %v", err)
		}
	}
	if _, err := store.PromoteVersion(v2.VersionID, "/videos/last.mp4"); err != nil {
		t.Fatalf("promote last version: %v", err)
	}

	deleted, current, err := store.DeleteVersion(v1.VersionID)
	if err != nil {
		t.Fatalf("delete middle version: %v", err)
	}
	if deleted.VersionID != v1.VersionID || current != v2.VersionID {
		t.Fatalf("unexpected deletion result: deleted=%#v current=%q", deleted, current)
	}
	if _, err := store.LoadVersion(v1.VersionID); err == nil {
		t.Fatal("expected deleted version to be unavailable")
	}
	if _, err := os.Stat(filepath.Join(store.versionsDir, v1.VersionID+".json")); !os.IsNotExist(err) {
		t.Fatalf("expected deleted manifest to be removed, err=%v", err)
	}
	if _, err := store.LoadVersion(v2.VersionID); err != nil {
		t.Fatalf("expected child version to remain: %v", err)
	}

	deleted, current, err = store.DeleteVersion(v2.VersionID)
	if err != nil {
		t.Fatalf("delete current version: %v", err)
	}
	if deleted.VersionID != v2.VersionID || current != v0.VersionID || store.CurrentVersionID() != v0.VersionID {
		t.Fatalf("unexpected current fallback: deleted=%#v current=%q store=%q", deleted, current, store.CurrentVersionID())
	}
}

func stringPtr(value string) *string { return &value }
