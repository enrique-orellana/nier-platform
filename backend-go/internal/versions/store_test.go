package versions

import (
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

func stringPtr(value string) *string { return &value }
