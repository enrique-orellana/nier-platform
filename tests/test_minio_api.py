from fastapi.testclient import TestClient

import app as app_module


def test_minio_objects_endpoint_returns_source_objects(monkeypatch):
    monkeypatch.setattr(
        app_module,
        "list_source_objects",
        lambda search, limit, continuation_token: {
            "bucket": "youtube-downloads",
            "objects": [{
                "key": "videos/source.bin",
                "name": "source.bin",
                "size": 12,
                "last_modified": "2026-08-13T00:00:00+00:00",
            }],
            "next_continuation_token": None,
        },
    )

    response = TestClient(app_module.app).get("/api/minio/objects?search=source&limit=10")

    assert response.status_code == 200
    assert response.json()["bucket"] == "youtube-downloads"
    assert response.json()["objects"][0]["key"] == "videos/source.bin"


def test_minio_objects_endpoint_returns_service_unavailable(monkeypatch):
    def unavailable(*_args, **_kwargs):
        raise RuntimeError("MinIO credentials are not configured")

    monkeypatch.setattr(app_module, "list_source_objects", unavailable)

    response = TestClient(app_module.app).get("/api/minio/objects")

    assert response.status_code == 503
    assert "MinIO" in response.json()["detail"]
