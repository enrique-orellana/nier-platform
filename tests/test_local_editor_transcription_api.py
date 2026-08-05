from fastapi.testclient import TestClient

import app as app_module


def test_local_editor_transcription_returns_segments(tmp_path, monkeypatch):
    monkeypatch.setattr(app_module, "UPLOAD_DIR", str(tmp_path))
    monkeypatch.setattr(app_module, "transcribe_audio", lambda path: {
        "language": "it",
        "segments": [
            {"start": 0.25, "end": 1.4, "text": " Ciao mondo "},
            {"start": 1.4, "end": 1.4, "text": "empty duration"},
        ],
    })

    response = TestClient(app_module.app).post(
        "/api/local-editor/transcribe",
        files={"file": ("demo.mp4", b"video-bytes", "video/mp4")},
    )

    assert response.status_code == 200
    assert response.json() == {
        "language": "it",
        "segments": [
            {"start": 0.25, "end": 1.4, "text": " Ciao mondo "},
            {"start": 1.4, "end": 1.4, "text": "empty duration"},
        ],
    }
    assert list(tmp_path.iterdir()) == []


def test_local_editor_transcription_rejects_non_video_upload(tmp_path, monkeypatch):
    monkeypatch.setattr(app_module, "UPLOAD_DIR", str(tmp_path))

    response = TestClient(app_module.app).post(
        "/api/local-editor/transcribe",
        files={"file": ("captions.srt", b"1", "application/x-subrip")},
    )

    assert response.status_code == 400
    assert "video" in response.json()["detail"].lower()
    assert list(tmp_path.iterdir()) == []
