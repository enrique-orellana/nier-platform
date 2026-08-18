from fastapi.testclient import TestClient

import app as app_module


def test_local_editor_transcription_returns_segments(tmp_path, monkeypatch):
    monkeypatch.setattr(app_module, "UPLOAD_DIR", str(tmp_path))
    monkeypatch.setattr(app_module, "transcribe_audio", lambda path, headers=None: {
        "language": "it",
        "segments": [
            {
                "start": 0.0,
                "end": 3.9,
                "text": " Adesso ti faccio vedere un altro esercizio per bloccare i muscoli. ",
                "words": [
                    {"word": "Adesso", "start": 0.0, "end": 0.3},
                    {"word": "ti", "start": 0.3, "end": 0.6},
                    {"word": "faccio", "start": 0.6, "end": 0.9},
                    {"word": "vedere", "start": 0.9, "end": 1.2},
                    {"word": "un", "start": 1.2, "end": 1.5},
                    {"word": "altro", "start": 1.5, "end": 1.8},
                    {"word": "esercizio", "start": 1.8, "end": 2.4},
                    {"word": "per", "start": 2.4, "end": 2.7},
                    {"word": "bloccare", "start": 2.7, "end": 3.2},
                    {"word": "i", "start": 3.2, "end": 3.4},
                    {"word": "muscoli.", "start": 3.4, "end": 3.9},
                ],
            },
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
        "captions": [
            {"text": "Adesso", "startMs": 0, "endMs": 300},
            {"text": "ti", "startMs": 300, "endMs": 600},
            {"text": "faccio", "startMs": 600, "endMs": 900},
            {"text": "vedere", "startMs": 900, "endMs": 1200},
            {"text": "un", "startMs": 1200, "endMs": 1500},
            {"text": "altro", "startMs": 1500, "endMs": 1800},
            {"text": "esercizio", "startMs": 1800, "endMs": 2400},
            {"text": "per", "startMs": 2400, "endMs": 2700},
            {"text": "bloccare", "startMs": 2700, "endMs": 3200},
            {"text": "i", "startMs": 3200, "endMs": 3400},
            {"text": "muscoli.", "startMs": 3400, "endMs": 3900},
        ],
        "segments": [
            {"start": 0.0, "end": 0.9, "text": "Adesso ti faccio"},
            {"start": 0.9, "end": 1.8, "text": "vedere un altro"},
            {"start": 1.8, "end": 2.7, "text": "esercizio per"},
            {"start": 2.7, "end": 3.9, "text": "bloccare i muscoli."},
        ],
    }
    assert list(tmp_path.iterdir()) == []


def test_local_editor_transcription_forwards_ai_headers(tmp_path, monkeypatch):
    monkeypatch.setattr(app_module, "UPLOAD_DIR", str(tmp_path))
    captured = {}

    def fake_transcribe_audio(path, headers=None):
        captured["headers"] = headers
        return {
            "language": "en",
            "segments": [{"start": 0.0, "end": 1.0, "text": "Hello", "words": []}],
        }

    monkeypatch.setattr(app_module, "transcribe_audio", fake_transcribe_audio)

    response = TestClient(app_module.app).post(
        "/api/local-editor/transcribe",
        headers={
            "X-AI-Transcription-OpenRouter-Provider": "deepinfra",
        },
        files={"file": ("demo.mp4", b"video-bytes", "video/mp4")},
    )

    assert response.status_code == 200
    assert captured["headers"]["x-ai-transcription-openrouter-provider"] == "deepinfra"


def test_local_editor_transcription_rejects_non_video_upload(tmp_path, monkeypatch):
    monkeypatch.setattr(app_module, "UPLOAD_DIR", str(tmp_path))

    response = TestClient(app_module.app).post(
        "/api/local-editor/transcribe",
        files={"file": ("captions.srt", b"1", "application/x-subrip")},
    )

    assert response.status_code == 400
    assert "video" in response.json()["detail"].lower()
    assert list(tmp_path.iterdir()) == []
