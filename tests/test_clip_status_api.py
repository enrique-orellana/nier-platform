from fastapi.testclient import TestClient

import app as app_module


def setup_job(monkeypatch):
    app_module.jobs.clear()
    app_module.jobs["job-1"] = {
        "result": {
            "clips": [
                {"video_url": "/videos/job-1/clip-1.mp4"},
                {"video_url": "/videos/job-1/clip-2.mp4"},
            ]
        }
    }


def test_get_statuses_defaults_existing_project_to_not_reviewed(monkeypatch):
    setup_job(monkeypatch)
    monkeypatch.setattr(
        app_module,
        "load_clip_statuses",
        lambda _job_id: {"version": 1, "clips": {}},
    )

    response = TestClient(app_module.app).get("/api/projects/job-1/statuses")

    assert response.status_code == 200
    assert response.json() == {"version": 1, "clips": {}}


def test_patch_clip_status_persists_a_valid_status(monkeypatch):
    setup_job(monkeypatch)
    document = {"version": 1, "clips": {}}
    saved = []
    monkeypatch.setattr(app_module, "load_clip_statuses", lambda _job_id: document)
    monkeypatch.setattr(
        app_module,
        "save_clip_statuses",
        lambda _job_id, clips: saved.append(clips),
    )

    response = TestClient(app_module.app).patch(
        "/api/projects/job-1/clips/1/status",
        json={"status": "edited"},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "edited"
    assert saved[0]["1"]["status"] == "edited"


def test_patch_clip_status_rejects_unknown_status(monkeypatch):
    setup_job(monkeypatch)

    response = TestClient(app_module.app).patch(
        "/api/projects/job-1/clips/0/status",
        json={"status": "queued"},
    )

    assert response.status_code == 422


def test_patch_clip_status_rejects_unknown_clip(monkeypatch):
    setup_job(monkeypatch)

    response = TestClient(app_module.app).patch(
        "/api/projects/job-1/clips/9/status",
        json={"status": "reviewing"},
    )

    assert response.status_code == 404


def test_get_statuses_rejects_unknown_project(monkeypatch):
    app_module.jobs.clear()
    monkeypatch.setattr(app_module, "_get_job", lambda _job_id: None)

    response = TestClient(app_module.app).get("/api/projects/missing/statuses")

    assert response.status_code == 404
