from fastapi.testclient import TestClient

import app as app_module
import main
from ai_client import AIConfig


class AsyncQueue:
    def __init__(self):
        self.values = []

    async def put(self, value):
        self.values.append(value)


def configured_ai(monkeypatch):
    monkeypatch.setattr(
        app_module,
        "build_ai_config",
        lambda **_kwargs: AIConfig(provider="ollama", base_url="http://localhost:11434"),
    )


def test_process_queues_direct_url_without_ytdlp_flag(monkeypatch):
    app_module.jobs.clear()
    configured_ai(monkeypatch)
    queue = AsyncQueue()
    monkeypatch.setattr(app_module, "job_queue", queue)

    response = TestClient(app_module.app).post(
        "/api/process?clip_count=3",
        json={"url": "http://localhost:9000/openshorts-media/source.mp4", "acknowledged": True},
    )

    assert response.status_code == 200
    command = app_module.jobs[response.json()["job_id"]]["cmd"]
    assert "--direct-url" in command
    assert "http://localhost:9000/openshorts-media/source.mp4" in command
    assert "--url" not in command
    assert queue.values == [response.json()["job_id"]]


def test_process_passes_original_source_url_separately_for_json_url(monkeypatch):
    app_module.jobs.clear()
    configured_ai(monkeypatch)
    queue = AsyncQueue()
    monkeypatch.setattr(app_module, "job_queue", queue)

    source_url = "https://www.twitch.tv/videos/2842570758"
    response = TestClient(app_module.app).post(
        "/api/process",
        json={
            "url": "http://localhost:9000/openshorts-media/source.mp4",
            "source_url": source_url,
            "acknowledged": True,
        },
    )

    assert response.status_code == 200
    job = app_module.jobs[response.json()["job_id"]]
    command = job["cmd"]
    assert command[command.index("--direct-url") + 1] == "http://localhost:9000/openshorts-media/source.mp4"
    assert command[command.index("--source-url") + 1] == source_url
    assert job["attestation"]["source_url"] == source_url
    assert "--url" not in command


def test_process_passes_original_source_url_for_multipart_upload(monkeypatch):
    app_module.jobs.clear()
    configured_ai(monkeypatch)
    queue = AsyncQueue()
    monkeypatch.setattr(app_module, "job_queue", queue)

    source_url = "https://www.youtube.com/watch?v=source123"
    response = TestClient(app_module.app).post(
        "/api/process",
        files={"file": ("source.mp4", b"video-bytes", "video/mp4")},
        data={"source_url": source_url, "acknowledged": "true"},
    )

    assert response.status_code == 200
    job = app_module.jobs[response.json()["job_id"]]
    command = job["cmd"]
    assert command[command.index("--source-url") + 1] == source_url
    assert job["attestation"]["source_url"] == source_url
    assert "--direct-url" not in command


def test_process_rejects_non_https_or_unsupported_original_source_url(monkeypatch):
    configured_ai(monkeypatch)

    for source_url in ("http://www.twitch.tv/videos/123", "https://example.com/video/123"):
        response = TestClient(app_module.app).post(
            "/api/process",
            json={
                "url": "http://localhost:9000/openshorts-media/source.mp4",
                "source_url": source_url,
                "acknowledged": True,
            },
        )

        assert response.status_code == 400
        assert response.json()["detail"] == "Original source URL must be an HTTPS YouTube or Twitch URL"


def test_process_rejects_non_http_url(monkeypatch):
    configured_ai(monkeypatch)

    response = TestClient(app_module.app).post(
        "/api/process",
        json={"url": "file:///tmp/source.mp4", "acknowledged": True},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Video URL must use http:// or https://"


def test_legacy_ytdlp_helper_remains_available():
    assert callable(main.download_youtube_video)
