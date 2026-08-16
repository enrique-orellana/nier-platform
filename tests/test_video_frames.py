import io
from fractions import Fraction
from unittest.mock import patch

import numpy as np

from video_frames import FFmpegVideoStream


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


def _frame_payload(*values):
    return b"".join(np.full((1, 2, 3), value, dtype=np.uint8).tobytes() for value in values)


def test_ffmpeg_stream_reads_bgr_frames_without_a_video_encoder():
    process = FakeProcess(_frame_payload(10, 20))

    with patch("video_frames.subprocess.Popen", return_value=process) as popen:
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

    with patch("video_frames.subprocess.Popen", return_value=process):
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

    with patch("video_frames.subprocess.Popen", return_value=process) as popen:
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
