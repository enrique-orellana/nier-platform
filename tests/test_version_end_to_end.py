from version_store import VersionStore


def manifest(layer):
    return {
        "schema_version": 1,
        "project_id": "job",
        "workflow": "long_video",
        "assets": {},
        "timeline": {"source_video_url": "/videos/job/source.mp4"},
        "subtitle_tracks": [{"id": "original", "language": "en", "captions": []}],
        "active_subtitle_track_id": "original",
        "layers": {"hook": layer},
        "export_policy": {"codec": "h264", "container": "mp4"},
    }


def test_version_history_keeps_parent_and_branch_outputs(tmp_path):
    store = VersionStore(tmp_path / "clip")
    v0 = store.create_version(manifest(None), None)
    store.update_render(v0.version_id, "done")
    store.promote_version(v0.version_id, "/videos/job/v0.mp4")

    v1 = store.create_version(manifest({"text": "Hook"}), v0.version_id)
    store.update_render(v1.version_id, "done")
    store.promote_version(v1.version_id, "/videos/job/v1.mp4")
    v2 = store.create_version(manifest({"text": "Hook", "track": "es"}), v1.version_id)
    store.update_render(v2.version_id, "done")
    store.promote_version(v2.version_id, "/videos/job/v2.mp4")

    branch = store.create_version(manifest({"text": "Original branch"}), v1.version_id)
    store.update_render(branch.version_id, "done")
    store.promote_version(branch.version_id, "/videos/job/branch.mp4")

    assert store.load_version(v2.version_id).parent_version_id == v1.version_id
    assert store.load_version(branch.version_id).parent_version_id == v1.version_id
    assert store.load_version(v2.version_id).output_url == "/videos/job/v2.mp4"
    assert store.load_version(branch.version_id).output_url == "/videos/job/branch.mp4"
