import json

from fastapi.testclient import TestClient

import app as app_module


def test_migration_preserves_existing_output_and_url(tmp_path, monkeypatch):
    monkeypatch.setattr(app_module, "OUTPUT_DIR", str(tmp_path))
    job_id = "job"
    output_dir = tmp_path / job_id
    output_dir.mkdir()
    output_file = output_dir / "edited.mp4"
    output_file.write_bytes(b"existing-output")
    metadata = {"shorts": [{"video_url": "/videos/job/edited.mp4", "start": 1, "end": 3}]}
    metadata_path = output_dir / "job_metadata.json"
    metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
    app_module.jobs.clear()
    app_module.jobs[job_id] = {"result": {"clips": [dict(metadata["shorts"][0])]}}

    response = TestClient(app_module.app).get(f"/api/clip/{job_id}/0/versions")

    assert response.status_code == 200
    assert output_file.read_bytes() == b"existing-output"
    persisted = json.loads(metadata_path.read_text(encoding="utf-8"))
    assert persisted["shorts"][0]["video_url"] == "/videos/job/edited.mp4"
    assert persisted["shorts"][0]["current_version_id"]
