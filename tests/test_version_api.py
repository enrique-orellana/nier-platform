import json

from fastapi.testclient import TestClient

import app as app_module


def setup_job(tmp_path, monkeypatch):
    monkeypatch.setattr(app_module, "OUTPUT_DIR", str(tmp_path))
    job_id = "job"
    output_dir = tmp_path / job_id
    output_dir.mkdir()
    metadata = {"shorts": [{"video_url": "/videos/job/clip.mp4", "start": 0, "end": 2}]}
    (output_dir / "job_metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
    app_module.jobs.clear()
    app_module.jobs[job_id] = {"result": {"clips": [dict(metadata["shorts"][0])]}}
    return job_id


def test_get_versions_returns_migrated_legacy_version(tmp_path, monkeypatch):
    job_id = setup_job(tmp_path, monkeypatch)
    client = TestClient(app_module.app)

    response = client.get(f"/api/clip/{job_id}/0/versions")

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["versions"]) == 1
    assert payload["current_version_id"] == payload["versions"][0]["version_id"]
    assert payload["versions"][0]["status"] == "done"


def test_branch_from_historical_version_creates_child(tmp_path, monkeypatch):
    job_id = setup_job(tmp_path, monkeypatch)
    client = TestClient(app_module.app)
    initial = client.get(f"/api/clip/{job_id}/0/versions").json()["versions"][0]

    response = client.post(
        f"/api/clip/{job_id}/0/versions/branch",
        json={"version_id": initial["version_id"]},
    )

    assert response.status_code == 200
    assert response.json()["version"]["parent_version_id"] == initial["version_id"]


def test_completed_version_becomes_current_without_deleting_parent(tmp_path, monkeypatch):
    job_id = setup_job(tmp_path, monkeypatch)
    client = TestClient(app_module.app)
    initial = client.get(f"/api/clip/{job_id}/0/versions").json()["versions"][0]
    manifest = client.get(
        f"/api/clip/{job_id}/0/versions/{initial['version_id']}"
    ).json()["manifest"]

    created = client.post(
        f"/api/clip/{job_id}/0/versions",
        json={"manifest": manifest, "parent_version_id": initial["version_id"]},
    ).json()["version"]
    completed = client.post(
        f"/api/clip/{job_id}/0/versions/{created['version_id']}/complete",
        json={"output_url": "/videos/job/master-child.mp4"},
    )

    assert completed.status_code == 200
    assert completed.json()["current_version_id"] == created["version_id"]
    versions = client.get(f"/api/clip/{job_id}/0/versions").json()["versions"]
    assert {item["version_id"] for item in versions} == {initial["version_id"], created["version_id"]}


def test_update_version_manifest_keeps_selected_version_id(tmp_path, monkeypatch):
    job_id = setup_job(tmp_path, monkeypatch)
    client = TestClient(app_module.app)
    initial = client.get(f"/api/clip/{job_id}/0/versions").json()["versions"][0]
    manifest = client.get(
        f"/api/clip/{job_id}/0/versions/{initial['version_id']}"
    ).json()["manifest"]
    manifest["layers"] = {"hook": {"text": "edited"}}

    response = client.put(
        f"/api/clip/{job_id}/0/versions/{initial['version_id']}",
        json={"manifest": manifest},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["version"]["version_id"] == initial["version_id"]
    assert payload["manifest"]["layers"]["hook"]["text"] == "edited"
    assert len(client.get(f"/api/clip/{job_id}/0/versions").json()["versions"]) == 1
