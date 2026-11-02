import warnings

with warnings.catch_warnings():
    warnings.filterwarnings(
        "ignore",
        message=r"Using `httpx` with `starlette.testclient` is deprecated",
    )
    from fastapi.testclient import TestClient

from services.local_audio_events.app import main


class FakeDetector:
    identifier = "yamnet"

    def __init__(self):
        self.calls = []

    def detect(self, waveform, *, duration_seconds):
        self.calls.append((waveform, duration_seconds))
        return [
            {
                "start": 0.0,
                "end": duration_seconds,
                "label": "Laughter",
                "confidence": 0.9,
            }
        ]


def configure_test_service(monkeypatch):
    monkeypatch.setenv("AUDIO_EVENT_DETECTOR", "yamnet")
    monkeypatch.setenv("AUDIO_EVENT_MODEL", "yamnet")
    monkeypatch.setenv("AUDIO_EVENT_MAX_UPLOAD_BYTES", "1024")
    monkeypatch.setattr(main, "decode_audio", lambda _payload: ([0.0], 1.0))


def test_event_api_reports_health_and_returns_the_configured_detector_output(
    monkeypatch,
):
    configure_test_service(monkeypatch)
    detector = FakeDetector()
    app = main.create_app(lambda identifier: detector)

    with TestClient(app) as client:
        assert client.get("/health").json() == {
            "ok": True,
            "provider": "yamnet",
            "model": "yamnet",
        }
        response = client.post(
            "/v1/audio/events",
            data={"model": "yamnet"},
            files={"file": ("chunk.wav", b"audio", "audio/wav")},
        )

    assert response.status_code == 200
    assert response.json() == {
        "events": [
            {
                "start": 0.0,
                "end": 1.0,
                "label": "Laughter",
                "confidence": 0.9,
            }
        ]
    }
    assert detector.calls == [([0.0], 1.0)]


def test_event_api_rejects_unconfigured_models_without_running_inference(monkeypatch):
    configure_test_service(monkeypatch)
    detector = FakeDetector()
    app = main.create_app(lambda _identifier: detector)

    with TestClient(app) as client:
        response = client.post(
            "/v1/audio/events",
            data={"model": "other-model"},
            files={"file": ("chunk.wav", b"audio", "audio/wav")},
        )

    assert response.status_code == 422
    assert detector.calls == []


def test_event_api_rejects_audio_above_its_configured_limit(monkeypatch):
    configure_test_service(monkeypatch)
    detector = FakeDetector()
    app = main.create_app(lambda _identifier: detector)

    with TestClient(app) as client:
        response = client.post(
            "/v1/audio/events",
            data={"model": "yamnet"},
            files={"file": ("chunk.wav", b"x" * 1025, "audio/wav")},
        )

    assert response.status_code == 413
    assert detector.calls == []
