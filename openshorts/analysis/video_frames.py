"""Decode video frames through FFmpeg without creating an intermediate video."""

from __future__ import annotations

from fractions import Fraction
import os
import subprocess
from typing import Any

import numpy as np


def _even(value: int) -> int:
    value = max(2, int(value))
    return value if value % 2 == 0 else value - 1


def _scaled_dimensions(width: int, height: int, max_dimension: int | None) -> tuple[int, int]:
    width = int(width)
    height = int(height)
    if width <= 0 or height <= 0:
        raise ValueError("video dimensions must be positive")
    if not max_dimension or max(width, height) <= int(max_dimension):
        return width, height

    max_dimension = int(max_dimension)
    if width >= height:
        output_width = max_dimension
        output_height = round(height * max_dimension / width)
    else:
        output_height = max_dimension
        output_width = round(width * max_dimension / height)
    return _even(output_width), _even(output_height)


class FFmpegVideoStream:
    """A PySceneDetect-compatible stream backed by FFmpeg rawvideo output."""

    BACKEND_NAME = "ffmpeg-pipe"

    def __init__(
        self,
        video_path: str | os.PathLike[str],
        *,
        width: int,
        height: int,
        fps: float | Fraction,
        total_frames: int | None = None,
        start_frame: int = 0,
        end_frame: int | None = None,
        max_dimension: int | None = None,
        ffmpeg_binary: str = "ffmpeg",
    ) -> None:
        self._path = os.fspath(video_path)
        self._source_width = int(width)
        self._source_height = int(height)
        self._frame_rate = Fraction(fps)
        if self._frame_rate <= 0:
            raise ValueError("fps must be positive")
        self._total_frames = int(total_frames) if total_frames is not None else None
        self._start_frame = int(start_frame)
        self._end_frame = int(end_frame) if end_frame is not None else None
        if self._start_frame < 0:
            raise ValueError("start_frame must not be negative")
        if self._end_frame is not None and self._end_frame < self._start_frame:
            raise ValueError("end_frame must not be before start_frame")
        if self._total_frames is not None and self._end_frame is not None:
            self._end_frame = min(self._end_frame, self._total_frames)
        self._width, self._height = _scaled_dimensions(
            self._source_width, self._source_height, max_dimension
        )
        self._max_dimension = max_dimension
        self._ffmpeg_binary = ffmpeg_binary
        self._frame_bytes = self._width * self._height * 3
        self._frame_number = self._start_frame
        self._process: subprocess.Popen[bytes] | None = None
        self._start_process(self._start_frame)

    @property
    def path(self) -> str:
        return self._path

    @property
    def name(self) -> str:
        return os.path.splitext(os.path.basename(self._path))[0]

    @property
    def is_seekable(self) -> bool:
        return True

    @property
    def frame_rate(self) -> Fraction:
        return self._frame_rate

    @property
    def duration(self):
        if self._total_frames is None:
            return None
        from scenedetect.common import FrameTimecode

        return FrameTimecode(self._total_frames, self._frame_rate)

    @property
    def frame_size(self) -> tuple[int, int]:
        return self._width, self._height

    @property
    def aspect_ratio(self) -> float:
        return self._width / self._height

    @property
    def base_timecode(self):
        from scenedetect.common import FrameTimecode

        return FrameTimecode(0, self._frame_rate)

    @property
    def position(self):
        from scenedetect.common import FrameTimecode

        return FrameTimecode(max(0, self._frame_number - 1), self._frame_rate)

    @property
    def position_ms(self) -> float:
        return (max(0, self._frame_number - 1) / float(self._frame_rate)) * 1000.0

    @property
    def frame_number(self) -> int:
        return self._frame_number

    def _command(self, start_frame: int) -> list[str]:
        command = [self._ffmpeg_binary, "-hide_banner", "-loglevel", "error", "-nostdin"]
        if start_frame > 0:
            command.extend(["-ss", f"{start_frame / float(self._frame_rate):.6f}"])
        command.extend([
            "-i",
            self._path,
            "-an",
            "-sn",
            "-dn",
        ])
        if self._max_dimension:
            command.extend(["-vf", f"scale={self._width}:{self._height}"])
        command.extend([
            "-fps_mode",
            "passthrough",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "bgr24",
        ])
        if self._end_frame is not None:
            command.extend(["-frames:v", str(max(0, self._end_frame - start_frame))])
        command.append("pipe:1")
        return command

    def _start_process(self, start_frame: int) -> None:
        self._process = subprocess.Popen(
            self._command(start_frame),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

    def _read_exact_frame(self) -> bytes | None:
        if self._process is None or self._process.stdout is None:
            return None
        if self._end_frame is not None and self._frame_number >= self._end_frame:
            return None
        if self._total_frames is not None and self._frame_number >= self._total_frames:
            return None

        payload = bytearray()
        while len(payload) < self._frame_bytes:
            chunk = self._process.stdout.read(self._frame_bytes - len(payload))
            if not chunk:
                break
            payload.extend(chunk)
        if not payload:
            returncode = self._process.wait()
            stderr = b""
            if self._process.stderr is not None:
                stderr = self._process.stderr.read() or b""
            if returncode != 0:
                detail = stderr.decode(errors="replace").strip()
                raise RuntimeError(
                    f"FFmpeg failed while decoding {self._path} (exit code {returncode})"
                    + (f": {detail}" if detail else "")
                )
            return None
        if len(payload) != self._frame_bytes:
            returncode = self._process.wait()
            stderr = b""
            if self._process.stderr is not None:
                stderr = self._process.stderr.read() or b""
            detail = stderr.decode(errors="replace").strip()
            raise RuntimeError(
                f"FFmpeg ended mid-frame while decoding {self._path}"
                + f" (exit code {returncode})"
                + (f": {detail}" if detail else "")
            )
        return bytes(payload)

    def read(self, decode: bool = True) -> np.ndarray | bool:
        payload = self._read_exact_frame()
        if payload is None:
            return False
        self._frame_number += 1
        if not decode:
            return True
        return np.frombuffer(payload, dtype=np.uint8).reshape(
            (self._height, self._width, 3)
        ).copy()

    def seek(self, target: Any) -> None:
        if hasattr(target, "frame_num"):
            target_frame = int(target.frame_num)
        elif isinstance(target, float):
            target_frame = round(target * float(self._frame_rate))
        else:
            target_frame = int(target)
        if target_frame < 0:
            raise ValueError("target frame must not be negative")
        self._close_process()
        self._frame_number = target_frame
        self._start_process(target_frame)

    def reset(self) -> None:
        self.seek(0)

    def _close_process(self) -> None:
        process = self._process
        self._process = None
        if process is None:
            return
        if process.stdout is not None:
            process.stdout.close()
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        if process.stderr is not None:
            process.stderr.close()

    def close(self) -> None:
        self._close_process()

    def __enter__(self) -> "FFmpegVideoStream":
        return self

    def __exit__(self, _exc_type, _exc_value, _traceback) -> None:
        self.close()
