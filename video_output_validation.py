"""Validation for final clips before they become job artifacts."""

from __future__ import annotations

import math
import struct
import subprocess
from pathlib import Path

from media_probe import MediaProbe, probe_media


def validate_clip_output(
    output_path: str | Path,
    *,
    expected_width: int,
    expected_height: int,
    expected_fps: float,
    source_has_audio: bool,
) -> MediaProbe:
    """Probe and validate a generated clip against the master export contract."""
    try:
        media = probe_media(output_path)
    except Exception as error:
        raise ValueError(f"clip output has no valid video stream: {error}") from error

    if media.codec.lower() != "h264":
        raise ValueError(f"clip output codec must be h264, got {media.codec!r}")
    if media.profile.lower() != "high":
        raise ValueError(f"clip output H.264 profile must be High, got {media.profile!r}")
    if media.pixel_format != "yuv420p":
        raise ValueError(f"clip output pixel format must be yuv420p, got {media.pixel_format!r}")
    if (media.width, media.height) != (int(expected_width), int(expected_height)):
        raise ValueError(
            "clip output dimensions do not match expected dimensions: "
            f"got {media.width}x{media.height}, "
            f"expected {int(expected_width)}x{int(expected_height)}"
        )
    if media.duration_seconds <= 0:
        raise ValueError("clip output duration must be positive")
    if media.frame_count is not None and media.frame_count <= 0:
        raise ValueError("clip output frame count must be positive")
    if media.fps <= 0 or not math.isclose(
        media.fps,
        float(expected_fps),
        rel_tol=1e-3,
        abs_tol=1e-6,
    ):
        raise ValueError(
            f"clip output FPS does not match expected FPS: got {media.fps}, "
            f"expected {float(expected_fps)}"
        )
    if media.size_bytes <= 0:
        raise ValueError("clip output size must be positive")
    if media.rotation not in (0,):
        raise ValueError("clip output must not rely on rotation metadata")
    if media.sample_aspect_ratio not in {"1:1", "1/1"}:
        raise ValueError("clip output must use square pixels (SAR 1:1)")
    if media.color_range not in {"tv", "mpeg"}:
        raise ValueError("clip output must use limited/video color range")
    if media.color_space != "bt709" or media.color_transfer != "bt709" or media.color_primaries != "bt709":
        raise ValueError("clip output must carry BT.709 SDR color metadata")

    if source_has_audio:
        if media.audio is None:
            raise ValueError("clip output is missing the required audio stream")
        if media.audio.sample_rate <= 0 or media.audio.channels <= 0:
            raise ValueError("clip output audio stream has invalid parameters")
        if media.audio.codec.lower() != "aac":
            raise ValueError("clip output audio must be AAC")
        if media.audio.sample_rate != 48000 or media.audio.channels != 2:
            raise ValueError("clip output audio must be stereo 48 kHz")
        if media.audio.bitrate <= 0:
            raise ValueError("clip output audio bitrate must be positive")
        if media.audio.duration_seconds is not None and abs(media.audio.duration_seconds - media.duration_seconds) > (1 / expected_fps) + 0.02:
            raise ValueError("clip output audio duration does not match the video timeline")

    output_path = Path(media.path)
    if output_path.exists():
        if not _has_faststart_mp4(output_path):
            raise ValueError("clip output MP4 is not fast-start (moov atom is after mdat)")
        _assert_decodable(output_path)

    return media


def _has_faststart_mp4(path: Path) -> bool:
    """Return whether the top-level moov box precedes mdat."""
    moov_offset = None
    mdat_offset = None
    with path.open("rb") as handle:
        offset = 0
        while True:
            header = handle.read(8)
            if len(header) < 8:
                break
            size, box_type = struct.unpack(">I4s", header)
            header_size = 8
            if size == 1:
                extended = handle.read(8)
                if len(extended) < 8:
                    return False
                size = struct.unpack(">Q", extended)[0]
                header_size = 16
            elif size == 0:
                size = path.stat().st_size - offset
            if size < header_size:
                return False
            if box_type == b"moov" and moov_offset is None:
                moov_offset = offset
            if box_type == b"mdat" and mdat_offset is None:
                mdat_offset = offset
            handle.seek(offset + size)
            offset += size
            if offset >= path.stat().st_size:
                break
    return moov_offset is not None and (mdat_offset is None or moov_offset < mdat_offset)


def _assert_decodable(path: Path) -> None:
    result = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-f", "null", "-"],
        capture_output=True,
        text=True,
    )
    if result.returncode:
        raise ValueError(f"clip output contains decode errors: {result.stderr.strip()}")
