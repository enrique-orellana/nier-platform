package versions

import (
	"context"
	"errors"
	"testing"
)

func TestMemoryRepositoryPersistsImmutableManifestAndHead(t *testing.T) {
	repo := NewMemoryRepository()
	manifest := map[string]any{
		"layers": map[string]any{
			"hook": map[string]any{
				"color":      "#FF00AA",
				"fontSize":   48,
				"background": "#111111",
				"size":       "M",
			},
		},
		"render_spec": map[string]any{
			"duration_in_frames": 150,
			"fps":                30,
			"width":              1080,
			"height":             1920,
		},
	}
	created, saved, err := repo.Create(context.Background(), "project-a", 4, manifest, nil)
	if err != nil {
		t.Fatalf("create version: %v", err)
	}
	if created.Status != RenderStatusPending || created.ManifestRevision == "" || saved["version_id"] != created.VersionID {
		t.Fatalf("unexpected creation result: %#v %#v", created, saved)
	}
	if saved["master"] != nil || saved["render_status"] != string(RenderStatusPending) {
		t.Fatalf("expected version metadata in manifest: %#v", saved)
	}

	manifest["layers"].(map[string]any)["hook"].(map[string]any)["color"] = "mutated-after-create"
	loadedRecord, loaded, err := repo.Load(context.Background(), "project-a", 4, created.VersionID)
	if err != nil {
		t.Fatalf("load version: %v", err)
	}
	if loadedRecord.VersionID != created.VersionID || loaded["manifest_revision"] != created.ManifestRevision {
		t.Fatalf("unexpected loaded version: %#v %#v", loadedRecord, loaded)
	}
	if got := loaded["layers"].(map[string]any)["hook"].(map[string]any)["color"]; got != "#FF00AA" {
		t.Fatalf("manifest was not deep copied: %v", got)
	}

	loaded["layers"].(map[string]any)["hook"].(map[string]any)["background"] = "mutated-after-load"
	_, reloaded, err := repo.Load(context.Background(), "project-a", 4, created.VersionID)
	if err != nil {
		t.Fatalf("reload version: %v", err)
	}
	if got := reloaded["layers"].(map[string]any)["hook"].(map[string]any)["background"]; got != "#111111" {
		t.Fatalf("loaded manifest was not deep copied: %v", got)
	}

	if current, versions, err := repo.List(context.Background(), "project-a", 4); err != nil || current != "" || len(versions) != 1 {
		t.Fatalf("unexpected list result: current=%q versions=%#v err=%v", current, versions, err)
	}
}

func TestMemoryRepositoryValidatesParentScopeAndPromotesOnlyCompletedVersions(t *testing.T) {
	repo := NewMemoryRepository()
	first, _, err := repo.Create(context.Background(), "project-a", 4, map[string]any{"name": "first"}, nil)
	if err != nil {
		t.Fatalf("create first version: %v", err)
	}
	if _, _, err := repo.Create(context.Background(), "project-b", 4, map[string]any{}, &first.VersionID); err == nil {
		t.Fatal("expected cross-project parent to fail")
	}
	child, _, err := repo.Create(context.Background(), "project-a", 4, map[string]any{"name": "child"}, &first.VersionID)
	if err != nil {
		t.Fatalf("create child version: %v", err)
	}
	if _, err := repo.Promote(context.Background(), "project-a", 4, child.VersionID, "/videos/child.mp4"); err == nil {
		t.Fatal("expected pending version promotion to fail")
	}
	if _, err := repo.Complete(context.Background(), "project-a", 4, child.VersionID, "/videos/child.mp4"); err != nil {
		t.Fatalf("complete version: %v", err)
	}
	current, _, err := repo.List(context.Background(), "project-a", 4)
	if err != nil || current != child.VersionID {
		t.Fatalf("expected completed child to become current: current=%q err=%v", current, err)
	}
	if _, err := repo.Promote(context.Background(), "project-a", 4, first.VersionID, "/videos/first.mp4"); err == nil {
		t.Fatal("expected incomplete version promotion to fail")
	}
}

func TestMemoryRepositoryRejectsDeletingParentsAndChoosesCompletedFallback(t *testing.T) {
	repo := NewMemoryRepository()
	first, _, err := repo.Create(context.Background(), "project-a", 4, map[string]any{"name": "first"}, nil)
	if err != nil {
		t.Fatalf("create first version: %v", err)
	}
	child, _, err := repo.Create(context.Background(), "project-a", 4, map[string]any{"name": "child"}, &first.VersionID)
	if err != nil {
		t.Fatalf("create child version: %v", err)
	}
	if _, _, err := repo.Delete(context.Background(), "project-a", 4, first.VersionID); !errors.Is(err, ErrVersionHasChildren) {
		t.Fatalf("expected parent deletion conflict, got %v", err)
	}
	if _, err := repo.Complete(context.Background(), "project-a", 4, first.VersionID, "/videos/first.mp4"); err != nil {
		t.Fatalf("complete first version: %v", err)
	}
	if _, err := repo.Complete(context.Background(), "project-a", 4, child.VersionID, "/videos/child.mp4"); err != nil {
		t.Fatalf("complete child version: %v", err)
	}
	if _, err := repo.Promote(context.Background(), "project-a", 4, child.VersionID, "/videos/child.mp4"); err != nil {
		t.Fatalf("promote child version: %v", err)
	}
	deleted, replacement, err := repo.Delete(context.Background(), "project-a", 4, child.VersionID)
	if err != nil {
		t.Fatalf("delete current child: %v", err)
	}
	if deleted.VersionID != child.VersionID || replacement != first.VersionID {
		t.Fatalf("unexpected deletion result: %#v replacement=%q", deleted, replacement)
	}
}
