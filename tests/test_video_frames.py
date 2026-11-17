import io
from fractions import Fraction
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
import pytest

from openshorts.analysis.video_frames import FFmpegVideoStream, sample_video_frames


class FakeProcess:
    def __init__(self, payload):
        self.stdout = io.BytesIO(payload)
        self.stderr = io.BytesIO()
        self.returncode = None
        self.terminated = False

    def poll(self):
        return self.returncode

    def wait(self, timeout=None):
        self.returncode = 0
        return self.returncode

    def terminate(self):
        self.terminated = True
        self.returncode = 0

    def kill(self):
        self.returncode = -9


class FailingProcess(FakeProcess):
    def __init__(self, error):
        super().__init__(b"")
        self.stderr = io.BytesIO(error)
        self.returncode = 1

    def wait(self, timeout=None):
        return self.returncode


def _frame_payload(*values):
    return b"".join(np.full((1, 2, 3), value, dtype=np.uint8).tobytes() for value in values)


def test_ffmpeg_stream_reads_bgr_frames_without_a_video_encoder():
    process = FakeProcess(_frame_payload(10, 20))

    with patch("openshorts.analysis.video_frames.subprocess.Popen", return_value=process) as popen:
        stream = FFmpegVideoStream(
            "source.av1.mp4",
            width=2,
            height=1,
            fps=Fraction(30, 1),
            total_frames=2,
        )
        frame = stream.read()
        stream.close()

    command = popen.call_args.args[0]
    assert frame.shape == (1, 2, 3)
    assert int(frame[0, 0, 0]) == 10
    assert "-f" in command and command[command.index("-f") + 1] == "rawvideo"
    assert "-pix_fmt" in command and command[command.index("-pix_fmt") + 1] == "bgr24"
    assert "-c:v" not in command
    assert command[-1] == "pipe:1"


def test_ffmpeg_stream_can_advance_without_materializing_a_frame():
    process = FakeProcess(_frame_payload(10, 20))

    with patch("openshorts.analysis.video_frames.subprocess.Popen", return_value=process):
        stream = FFmpegVideoStream(
            "source.mp4",
            width=2,
            height=1,
            fps=Fraction(30, 1),
            total_frames=2,
        )
        assert stream.read(decode=False) is True
        assert stream.frame_number == 1
        assert stream.read() is not False
        assert stream.frame_number == 2
        assert stream.read() is False
        stream.close()


def test_ffmpeg_stream_preserves_absolute_frame_numbers_for_bounded_ranges():
    process = FakeProcess(_frame_payload(10, 20))

    with patch("openshorts.analysis.video_frames.subprocess.Popen", return_value=process) as popen:
        stream = FFmpegVideoStream(
            "source.mp4",
            width=2,
            height=1,
            fps=Fraction(30, 1),
            total_frames=10,
            start_frame=4,
            end_frame=6,
        )
        assert stream.frame_number == 4
        assert stream.read() is not False
        assert stream.frame_number == 5
        assert stream.read() is not False
        assert stream.frame_number == 6
        assert stream.read() is False
        stream.close()

    command = popen.call_args.args[0]
    assert command[command.index("-ss") + 1] == "0.133333"
    assert command[command.index("-frames:v") + 1] == "2"


def test_ffmpeg_stream_surfaces_decoder_errors_instead_of_treating_them_as_eof():
    process = FailingProcess(b"invalid input")

    with patch("openshorts.analysis.video_frames.subprocess.Popen", return_value=process):
        stream = FFmpegVideoStream(
            "broken.av1.mp4",
            width=2,
            height=1,
            fps=Fraction(30, 1),
        )
        try:
            try:
                stream.read()
            except RuntimeError as error:
                assert "invalid input" in str(error)
            else:
                raise AssertionError("decoder failure was treated as EOF")
        finally:
            stream.close()


def test_sample_video_frames_caps_frame_count_and_scales_output():
    with patch(
        "openshorts.analysis.video_frames.subprocess.run",
        return_value=SimpleNamespace(stdout=b"jpeg-frame"),
    ) as run:
        frames = sample_video_frames("source.mp4", 10, 30, max_frames=20)

    assert len(frames) == 8
    assert frames[0][0] == 11.25
    assert frames[-1][0] == 28.75
    assert all(image == b"jpeg-frame" for _, image in frames)
    assert run.call_count == 8
    assert (
        "scale=768:768:force_original_aspect_ratio=decrease:force_divisible_by=2"
        in run.call_args.args[0]
    )


def test_sample_video_frames_samples_zero_span_once():
    with patch(
        "openshorts.analysis.video_frames.subprocess.run",
        return_value=SimpleNamespace(stdout=b"jpeg-frame"),
    ) as run:
        frames = sample_video_frames("source.mp4", 2, 2)

    assert frames == [(2.0, b"jpeg-frame")]
    assert run.call_count == 1


def test_sample_video_frames_rejects_invalid_max_dimension():
    with pytest.raises(ValueError, match="at least 2 pixels"):
        sample_video_frames("source.mp4", 0, 1, max_dimension=1)
