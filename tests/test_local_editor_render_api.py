import json

import httpx
import app as app_module
from fastapi.testclient import TestClient


class FakeRenderResponse:
    status_code = 202

    def raise_for_status(self):
        return None

    def json(self):
        return {"renderId": "render-local-1", "status": "queued"}


class FakeRenderClient:
    request_body = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    async def post(self, _url, json=None):
        FakeRenderClient.request_body = json
        return FakeRenderResponse()


def test_local_editor_render_uploads_source_and_starts_backend_render(monkeypatch, tmp_path):
    monkeypatch.setattr(app_module, "OUTPUT_DIR", str(tmp_path))
    monkeypatch.setattr(httpx, "AsyncClient", lambda **_kwargs: FakeRenderClient())

    props = {
        "durationInFrames": 150,
        "fps": 25,
        "width": 608,
        "height": 1080,
        "subtitles": None,
        "hook": None,
        "effects": None,
    }
    response = TestClient(app_module.app).post(
        "/api/local-editor/render",
        files={"file": ("source.mp4", b"video-bytes", "video/mp4")},
        data={"props": json.dumps(props)},
    )

    assert response.status_code == 202
    payload = response.json()
    assert payload["renderId"] == "render-local-1"
    assert payload["jobId"].startswith("local-editor-")
    assert FakeRenderClient.request_body["props"]["videoUrl"].startswith(f"/videos/{payload['jobId']}/")
    assert (tmp_path / payload["jobId"] / "source.mp4").read_bytes() == b"video-bytes"
