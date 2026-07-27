import json

from fastapi.testclient import TestClient

import app as app_module


class FakeResponse:
    status_code = 202

    def json(self):
        return {"translationId": "translation-1", "status": "queued"}


class FakeAsyncClient:
    def __init__(self, **kwargs):
        self.kwargs = kwargs

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def post(self, url, **kwargs):
        assert url.endswith("/translate")
        assert kwargs["json"]["target_language"] == "es"
        assert kwargs["headers"]["X-AI-Api-Key"] == "test-key"
        return FakeResponse()


def setup_version(tmp_path, monkeypatch):
    monkeypatch.setattr(app_module, "OUTPUT_DIR", str(tmp_path))
    job_id = "job"
    output_dir = tmp_path / job_id
    output_dir.mkdir()
    metadata = {"shorts": [{"video_url": "/videos/job/source.mp4", "start": 0, "end": 2}]}
    (output_dir / "job_metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
    app_module.jobs.clear()
    app_module.jobs[job_id] = {"result": {"clips": [dict(metadata["shorts"][0])]}}
    client = TestClient(app_module.app)
    initial = client.get(f"/api/clip/{job_id}/0/versions").json()["versions"][0]
    manifest = client.get(
        f"/api/clip/{job_id}/0/versions/{initial['version_id']}"
    ).json()["manifest"]
    manifest["subtitle_tracks"] = [{
        "id": "original",
        "language": "en",
        "label": "Original",
        "origin": "original",
        "captions": [
            {"text": "Hello", "startMs": 0, "endMs": 500},
            {"text": "world", "startMs": 500, "endMs": 1000},
        ],
    }]
    created = client.post(
        f"/api/clip/{job_id}/0/versions",
        json={"manifest": manifest, "parent_version_id": initial["version_id"]},
    ).json()["version"]
    return client, job_id, created["version_id"]


def test_translate_subtitles_adds_track_without_mutating_original(tmp_path, monkeypatch):
    client, job_id, version_id = setup_version(tmp_path, monkeypatch)
    import httpx

    monkeypatch.setattr(httpx, "AsyncClient", FakeAsyncClient)

    response = client.post(
        f"/api/clip/{job_id}/0/versions/{version_id}/subtitle-tracks/translate",
        json={"target_language": "es", "source_track_id": "original"},
        headers={"X-AI-Api-Key": "test-key"},
    )

    assert response.status_code == 202
    payload = response.json()
    assert payload == {"translationId": "translation-1", "status": "queued"}
