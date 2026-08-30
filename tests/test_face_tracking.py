import json
from types import SimpleNamespace

import pytest

import main
from crop_track import CropTrack


class FakeStream:
    def __init__(self, *_args, **kwargs):
        self.frame_number = kwargs.get("start_frame", 0)
        self._frames = {}

    def seek(self, frame_number):
        self.frame_number = int(frame_number)

    def read(self):
        frame = self._frames.get(self.frame_number)
        self.frame_number += 1
        return frame

    def close(self):
        return None


def test_analyze_face_tracking_emits_normalized_interpolatable_track(monkeypatch, tmp_path):
    frames = {
        10: object(),
        25: object(),
        40: object(),
    }
    stream = FakeStream(start_frame=10)
    stream._frames = frames
    source_path = tmp_path / "master.mp4"
    source_path.touch()
    monkeypatch.setattr(
        main,
        "probe_media",
        lambda _path: SimpleNamespace(
            width=1920,
            height=1080,
            fps=30.0,
            duration_seconds=4.0,
            frame_count=120,
        ),
    )
    monkeypatch.setattr(main, "FFmpegVideoStream", lambda *args, **kwargs: stream)
    monkeypatch.setattr(
        main,
        "detect_face_candidates",
        lambda frame: [{"box": [100 if frame is frames[10] else 140, 20, 240, 180], "score": 1}],
    )
    monkeypatch.setattr(main, "detect_person_yolo", lambda _frame: None)

    result = main.analyze_face_tracking(
        str(source_path),
        start_seconds=10 / 30,
        end_seconds=50 / 30,
        sample_interval_seconds=0.5,
    )

    assert result["algorithm_version"] == main.FACE_TRACKING_ALGORITHM_VERSION
    track = CropTrack.from_dict(result["track"])
    assert len(track.scenes) == 1
    assert track.scenes[0].start_sec == 0
    assert track.scenes[0].end_sec == pytest.approx(40 / 30)
    assert len(track.scenes[0].keyframes) >= 2
    for keyframe in track.scenes[0].keyframes:
        rect = keyframe.rect
        assert 0 <= rect.x <= 1
        assert 0 < rect.width <= 1
        assert rect.x + rect.width <= 1


def test_analyze_face_tracking_uses_person_fallback_and_center_when_missing(monkeypatch, tmp_path):
    stream = FakeStream(start_frame=0)
    stream._frames = {0: object(), 15: object()}
    source_path = tmp_path / "master.mp4"
    source_path.touch()
    monkeypatch.setattr(
        main,
        "probe_media",
        lambda _path: SimpleNamespace(
            width=1280,
            height=720,
            fps=30.0,
            duration_seconds=1.0,
            frame_count=30,
        ),
    )
    monkeypatch.setattr(main, "FFmpegVideoStream", lambda *args, **kwargs: stream)
    monkeypatch.setattr(main, "detect_face_candidates", lambda _frame: [])
    monkeypatch.setattr(main, "detect_person_yolo", lambda _frame: [300, 0, 400, 300])

    result = main.analyze_face_tracking(
        str(source_path), start_seconds=0, end_seconds=1, sample_interval_seconds=0.5
    )
    track = CropTrack.from_dict(result["track"])
    assert track.rectangle_at(0).x > 0

    monkeypatch.setattr(main, "detect_person_yolo", lambda _frame: None)
    centered = main.analyze_face_tracking(
        str(source_path), start_seconds=0, end_seconds=1, sample_interval_seconds=0.5
    )
    centered_track = CropTrack.from_dict(centered["track"])
    rect = centered_track.rectangle_at(0)
    assert rect.x == pytest.approx((1 - rect.width) / 2, abs=0.001)


def test_analyze_face_tracking_rejects_invalid_ranges(monkeypatch, tmp_path):
    source_path = tmp_path / "master.mp4"
    source_path.touch()
    monkeypatch.setattr(
        main,
        "probe_media",
        lambda _path: SimpleNamespace(
            width=1280,
            height=720,
            fps=30.0,
            duration_seconds=1.0,
            frame_count=30,
        ),
    )
    with pytest.raises(ValueError, match="face tracking range"):
        main.analyze_face_tracking(str(source_path), start_seconds=1, end_seconds=1)


def test_worker_accepts_face_tracking_operation(monkeypatch, capsys, tmp_path):
    source_path = tmp_path / "master.mp4"
    source_path.touch()
    monkeypatch.setattr(
        main,
        "analyze_face_tracking",
        lambda *_args, **_kwargs: {
            "algorithm_version": main.FACE_TRACKING_ALGORITHM_VERSION,
            "source_start_seconds": 2,
            "source_end_seconds": 4,
            "source_width": 1920,
            "source_height": 1080,
            "source_fingerprint": "test",
            "track": {"scenes": []},
        },
    )
    from python_worker import handle_request

    handle_request(
        {
            "id": "track-1",
            "operation": "face_tracking",
            "payload": {
                "source_path": str(source_path),
                "start_seconds": 2,
                "end_seconds": 4,
                "source_width": 1920,
                "source_height": 1080,
            },
        }
    )
    event = json.loads(capsys.readouterr().out.strip())
    assert event["result"]["algorithm_version"] == main.FACE_TRACKING_ALGORITHM_VERSION
