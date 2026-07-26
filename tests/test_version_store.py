import json
import tempfile
import unittest
from pathlib import Path

from version_store import VersionStore


def manifest(name):
    return {
        "schema_version": 1,
        "project_id": "job",
        "workflow": "long_video",
        "assets": {},
        "timeline": {"source_asset_id": "source"},
        "layers": {"hook": {"text": name}},
        "export_policy": {"codec": "h264"},
    }


class VersionStoreTests(unittest.TestCase):
    def test_branch_from_older_version_does_not_change_later_branch(self):
        with tempfile.TemporaryDirectory() as root:
            store = VersionStore(Path(root) / "clip")
            v0 = store.create_version(manifest("v0"), parent_version_id=None)
            v1 = store.create_version(manifest("v1"), parent_version_id=v0.version_id)
            v2 = store.create_version(manifest("v2"), parent_version_id=v1.version_id)
            v3 = store.create_version(manifest("v3"), parent_version_id=v2.version_id)
            v4 = store.create_version(manifest("v4"), parent_version_id=v3.version_id)
            branch = store.create_version(manifest("branch"), parent_version_id=v3.version_id)

            self.assertEqual(store.load_version(v4.version_id).parent_version_id, v3.version_id)
            self.assertEqual(store.load_version(branch.version_id).parent_version_id, v3.version_id)
            self.assertIsNone(store.current_version_id)

    def test_failed_version_cannot_become_current(self):
        with tempfile.TemporaryDirectory() as root:
            store = VersionStore(Path(root) / "clip")
            version = store.create_version(manifest("v0"), parent_version_id=None)
            store.update_render(version.version_id, status="failed", error="render failed")

            with self.assertRaisesRegex(ValueError, "successful"):
                store.promote_version(version.version_id, "/videos/job/v0.mp4")

            index = json.loads((Path(root) / "clip" / "versions" / "index.json").read_text())
            self.assertIsNone(index["current_version_id"])


if __name__ == "__main__":
    unittest.main()
