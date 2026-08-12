"""Validation for final clips before they become job artifacts."""

from __future__ import annotations

import math
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

    if source_has_audio:
        if media.audio is None:
            raise ValueError("clip output is missing the required audio stream")
        if media.audio.sample_rate <= 0 or media.audio.channels <= 0:
            raise ValueError("clip output audio stream has invalid parameters")

    return media
