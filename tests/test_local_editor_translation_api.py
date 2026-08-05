from fastapi.testclient import TestClient

import app as app_module


class FakeResponse:
    status_code = 202

    def json(self):
        return {"translationId": "local-translation-1", "status": "queued"}


class FakeAsyncClient:
    def __init__(self, **kwargs):
        self.kwargs = kwargs

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def post(self, url, **kwargs):
        assert url.endswith("/translate")
        assert kwargs["json"]["target_language"] == "it"
        assert kwargs["json"]["source_track_id"] == "original"
        assert kwargs["json"]["tracks"][0]["language"] == "en"
        assert kwargs["headers"]["X-AI-Api-Key"] == "test-key"
        return FakeResponse()


def test_local_editor_translation_forwards_track_and_ai_headers(monkeypatch):
    import httpx

    monkeypatch.setattr(httpx, "AsyncClient", FakeAsyncClient)
    client = TestClient(app_module.app)

    response = client.post(
        "/api/local-editor/translate",
        json={
            "target_language": "it",
            "source_track_id": "original",
            "tracks": [{
                "id": "original",
                "language": "en",
                "cues": [{"id": "cue-1", "text": "Hello", "startMs": 0, "endMs": 500}],
            }],
        },
        headers={"X-AI-Api-Key": "test-key"},
    )

    assert response.status_code == 202
    assert response.json() == {"translationId": "local-translation-1", "status": "queued"}
