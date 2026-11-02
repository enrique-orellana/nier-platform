from services.local_audio_events.app.detector import (
    DetectorRegistry,
    YamNetAudioEventDetector,
)


class FakeModel:
    def __init__(self, scores):
        self.scores = scores
        self.waveform = None

    def __call__(self, waveform):
        self.waveform = waveform
        return self.scores, None, None


def test_yamnet_detector_groups_target_labels_into_timed_events():
    model = FakeModel(
        [
            [0.1, 0.0, 0.9],
            [0.82, 0.0, 0.1],
            [0.76, 0.0, 0.1],
            [0.1, 0.0, 0.1],
            [0.0, 0.88, 0.0],
        ]
    )
    detector = YamNetAudioEventDetector(
        model,
        ["Laughter", "Applause", "Speech"],
        min_confidence=0.6,
        frame_hop_seconds=0.5,
        frame_window_seconds=1.0,
    )

    events = detector.detect([0.0] * 16000, duration_seconds=2.2)

    assert events == [
        {"start": 0.5, "end": 2.0, "label": "Laughter", "confidence": 0.82},
        {"start": 2.0, "end": 2.2, "label": "Applause", "confidence": 0.88},
    ]
    assert model.waveform == [0.0] * 16000


def test_yamnet_detector_combines_synonyms_and_ignores_low_confidence_frames():
    detector = YamNetAudioEventDetector(
        FakeModel([[0.7, 0.3], [0.2, 0.8], [0.1, 0.1]]),
        ["Laughter", "Giggle"],
        min_confidence=0.5,
        frame_hop_seconds=0.5,
        frame_window_seconds=0.5,
    )

    events = detector.detect([0.0], duration_seconds=1.5)

    assert events == [
        {"start": 0.0, "end": 1.0, "label": "Laughter", "confidence": 0.8}
    ]


def test_detector_registry_requires_an_explicit_registered_detector():
    registry = DetectorRegistry()
    instance = object()
    registry.register("example", lambda: instance)

    assert registry.create("example") is instance

    try:
        registry.create("unknown")
    except ValueError as error:
        assert "unknown" in str(error)
    else:
        raise AssertionError("unregistered detector unexpectedly selected a fallback")
