from fastapi.testclient import TestClient

import app as app_module


def _post_process(monkeypatch, tmp_path, payload):
    monkeypatch.setattr(app_module, "OUTPUT_DIR", str(tmp_path / "output"))
    monkeypatch.setattr(app_module, "jobs", {})
    response = TestClient(app_module.app).post(
        "/api/process?clip_count=5",
        json=payload,
        headers={"X-AI-Provider": "ollama"},
    )
    assert response.status_code == 200, response.text
    return app_module.jobs[response.json()["job_id"]]


def test_legacy_process_forwards_streamer_layout_options(monkeypatch, tmp_path):
    job = _post_process(
        monkeypatch,
        tmp_path,
        {
            "url": "https://example.com/video.mp4",
            "acknowledged": True,
            "layout_format": "streamer_stack",
            "facecam_size": "large",
        },
    )

    assert "--layout-format" in job["cmd"]
    assert job["cmd"][job["cmd"].index("--layout-format") + 1] == "streamer_stack"
    assert "--facecam-size" in job["cmd"]
    assert job["cmd"][job["cmd"].index("--facecam-size") + 1] == "large"


def test_legacy_process_defaults_layout_options(monkeypatch, tmp_path):
    job = _post_process(
        monkeypatch,
        tmp_path,
        {"url": "https://example.com/video.mp4", "acknowledged": True},
    )

    assert job["cmd"][job["cmd"].index("--layout-format") + 1] == "standard"
    assert job["cmd"][job["cmd"].index("--facecam-size") + 1] == "medium"


def test_legacy_process_rejects_invalid_layout_options(monkeypatch, tmp_path):
    monkeypatch.setattr(app_module, "OUTPUT_DIR", str(tmp_path / "output"))
    response = TestClient(app_module.app).post(
        "/api/process",
        json={
            "url": "https://example.com/video.mp4",
            "acknowledged": True,
            "layout_format": "split_screen",
        },
        headers={"X-AI-Provider": "ollama"},
    )

    assert response.status_code == 400
    assert "layout_format" in response.text
