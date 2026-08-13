from fastapi.testclient import TestClient

import app as app_module


def test_generates_normalized_hashtags_from_clip_context(monkeypatch):
    seen = {}

    def fake_chat_json(config, prompt, **kwargs):
        seen["prompt"] = prompt
        return {"hashtags": ["#Gaming", "gaming", "#Juan Guarnizo", "#viral"] + [f"tag{i}" for i in range(20)]}

    monkeypatch.setattr(app_module, "chat_json", fake_chat_json)
    response = TestClient(app_module.app).post(
        "/api/local-editor/hashtags",
        headers={"X-AI-Provider": "lmstudio", "X-AI-Base-Url": "http://lmstudio.test"},
        json={
            "title": "Mi clip",
            "caption": "Una historia inesperada",
            "subtitle_text": "La conversación completa del clip",
            "source_context": {
                "who": ["Streamer"],
                "what": "Launch event",
                "where": "Rome",
                "source_summary": "Streamer discusses a launch event in Rome.",
            },
        },
    )

    assert response.status_code == 200
    tags = response.json()["hashtags"]
    assert tags[0] == "#Gaming"
    assert sum(tag.casefold() == "#gaming" for tag in tags) == 1
    assert "#JuanGuarnizo" in tags
    assert len(tags) == 12
    assert "Mi clip" in seen["prompt"]
    assert "La conversación completa del clip" in seen["prompt"]
    assert "ORIGINAL SOURCE CONTEXT" in seen["prompt"]
    assert "Streamer" in seen["prompt"]


def test_rejects_empty_clip_context(monkeypatch):
    calls = {"count": 0}

    def fake_chat_json(*args, **kwargs):
        calls["count"] += 1
        return {"hashtags": ["#unused"]}

    monkeypatch.setattr(app_module, "chat_json", fake_chat_json)
    response = TestClient(app_module.app).post(
        "/api/local-editor/hashtags",
        headers={"X-AI-Provider": "lmstudio", "X-AI-Base-Url": "http://lmstudio.test"},
        json={"title": "", "caption": "", "subtitle_text": ""},
    )

    assert response.status_code == 400
    assert "context" in response.json()["detail"].lower()
    assert calls["count"] == 0


def test_returns_provider_failure_as_safe_http_error(monkeypatch):
    def failing_chat_json(*args, **kwargs):
        raise ValueError("provider unavailable")

    monkeypatch.setattr(app_module, "chat_json", failing_chat_json)
    response = TestClient(app_module.app).post(
        "/api/local-editor/hashtags",
        headers={"X-AI-Provider": "lmstudio", "X-AI-Base-Url": "http://lmstudio.test"},
        json={"title": "Mi clip", "caption": "Caption", "subtitle_text": "Subtitle"},
    )

    assert response.status_code == 502
    assert "hashtag" in response.json()["detail"].lower()
