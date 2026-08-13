package manifests

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCalculateRevisionMatchesPythonCanonicalJSON(t *testing.T) {
	manifest := map[string]any{
		"schema_version": 1,
		"name":           "clip",
		"assets": map[string]any{
			"a": map[string]any{"x": 1},
		},
		"master":            map[string]any{"validated": true},
		"updated_at":        "2026-08-13T00:00:00Z",
		"render_status":     "done",
		"manifest_revision": "old",
	}

	got, err := CalculateRevision(manifest)
	if err != nil {
		t.Fatalf("calculate revision: %v", err)
	}
	const expected = "27644a3cea2c1a70d81da5b2eeadb383c7330e99ed60de5b9fde66f11a9d5dbc"
	if got != expected {
		t.Fatalf("expected revision %s, got %s", expected, got)
	}
}

func TestVerifyAssetsAcceptsMatchingFileAndRejectsPathEscape(t *testing.T) {
	projectDir := t.TempDir()
	assetDir := filepath.Join(projectDir, "assets")
	if err := os.Mkdir(assetDir, 0o755); err != nil {
		t.Fatalf("create asset directory: %v", err)
	}
	assetPath := filepath.Join(assetDir, "source.txt")
	if err := os.WriteFile(assetPath, []byte("source"), 0o644); err != nil {
		t.Fatalf("write asset: %v", err)
	}
	hash, err := SHA256File(assetPath)
	if err != nil {
		t.Fatalf("hash asset: %v", err)
	}
	manifest := map[string]any{
		"schema_version": 1,
		"assets": map[string]any{
			"source": map[string]any{"relative_path": "assets/source.txt", "sha256": hash},
		},
	}
	if err := VerifyAssets(manifest, projectDir); err != nil {
		t.Fatalf("verify matching asset: %v", err)
	}

	manifest["assets"] = map[string]any{
		"source": map[string]any{"relative_path": "../source.txt", "sha256": hash},
	}
	if err := VerifyAssets(manifest, projectDir); err == nil {
		t.Fatal("expected path escape to be rejected")
	}
}
