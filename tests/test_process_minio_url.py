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
