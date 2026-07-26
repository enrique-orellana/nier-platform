import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from media_probe import MediaProbe
from render_manifest import (
    calculate_revision,
    load_manifest,
    master_is_current,
    register_asset,
    save_manifest_atomic,
    verify_manifest_assets,
)


def fixture_probe():
    return MediaProbe(
        path="source.mp4", width=1080, height=1920, display_width=1080,
        display_height=1920, duration_seconds=2, fps=30, fps_fraction="30/1",
        codec="h264", profile="High", pixel_format="yuv420p", color_range="tv",
        color_space="bt709", color_transfer="bt709", color_primaries="bt709",
        rotation=0, size_bytes=12, audio=None,
    )


def fixture_manifest():
    return {
        "schema_version": 1,
        "project_id": "job",
        "workflow": "long_video",
        "assets": {},
        "timeline": {"source_asset_id": "source"},
        "layers": {"hook": None},
        "export_policy": {"codec": "h264"},
    }


class ManifestTests(unittest.TestCase):
    def test_register_asset_hashes_file_and_stores_relative_path(self):
        with tempfile.TemporaryDirectory() as root:
            project = Path(root)
            source = project / "source.mp4"
            source.write_bytes(b"source-bytes")
            asset = register_asset(source, project, fixture_probe())
            self.assertEqual(asset["sha256"], hashlib.sha256(b"source-bytes").hexdigest())
            self.assertEqual(asset["relative_path"], "source.mp4")

    def test_revision_ignores_export_result(self):
        manifest = fixture_manifest()
        before = calculate_revision(manifest)
        manifest["master"] = {"revision": before, "video_url": "/videos/job/master.mp4"}
        self.assertEqual(calculate_revision(manifest), before)

    def test_previous_export_becomes_stale_after_layer_change(self):
        manifest = fixture_manifest()
        revision = calculate_revision(manifest)
        manifest["master"] = {"revision": revision, "video_url": "/videos/job/master.mp4", "validated": True}
        self.assertTrue(master_is_current(manifest))
        manifest["layers"]["hook"] = {"text": "New hook"}
        self.assertFalse(master_is_current(manifest))

    def test_verify_assets_rejects_modified_source(self):
        with tempfile.TemporaryDirectory() as root:
            project = Path(root)
            source = project / "source.mp4"
            source.write_bytes(b"source")
            asset = register_asset(source, project, fixture_probe())
            manifest = fixture_manifest()
            manifest["assets"] = {"source": asset}
            source.write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "checksum"):
                verify_manifest_assets(manifest, project)

    def test_save_and_load_manifest_atomically(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "manifest.json"
            manifest = fixture_manifest()
            revision = save_manifest_atomic(path, manifest)
            self.assertEqual(revision, calculate_revision(manifest))
            self.assertEqual(load_manifest(path)["schema_version"], 1)
            self.assertFalse(path.with_name(".manifest.json.tmp").exists())

    def test_revision_ignores_version_bookkeeping(self):
        manifest = fixture_manifest()
        manifest["version_id"] = "version-1"
        manifest["parent_version_id"] = None
        manifest["manifest_revision"] = "old-revision"
        before = calculate_revision(manifest)
        manifest["manifest_revision"] = "new-revision"
        manifest["render_status"] = "done"
        manifest["updated_at"] = "2026-07-26T00:00:00+00:00"
        self.assertEqual(calculate_revision(manifest), before)

    def test_manifest_revision_mismatch_is_rejected(self):
        manifest = fixture_manifest()
        manifest["version_id"] = "version-1"
        manifest["manifest_revision"] = "wrong"
        with self.assertRaisesRegex(ValueError, "revision"):
            save_manifest_atomic(Path(tempfile.mkdtemp()) / "manifest.json", manifest)


if __name__ == "__main__":
    unittest.main()
