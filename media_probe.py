"""Canonical media metadata extraction used by all video workflows."""

from __future__ import annotations

import json
import os
import subprocess
from dataclasses import dataclass
from fractions import Fraction
from typing import Any, Mapping


def _parse_rate(value: Any) -> tuple[float, str]:
    text = str(value or "").strip()
    if not text or text in {"0/0", "N/A", "0"}:
        return 0.0, ""
    try:
        fraction = Fraction(text)
    except (ValueError, ZeroDivisionError):
        return 0.0, ""
    if fraction <= 0:
        return 0.0, ""
    return float(fraction), text


@dataclass(frozen=True)
class AudioProbe:
    codec: str
    sample_rate: int
    channels: int
    channel_layout: str
    duration_seconds: float | None = None


@dataclass(frozen=True)
class MediaProbe:
    path: str
    width: int
    height: int
    display_width: int
    display_height: int
    duration_seconds: float
    fps: float
    fps_fraction: str
    codec: str
    profile: str
    pixel_format: str
    color_range: str
    color_space: str
    color_transfer: str
    color_primaries: str
    rotation: int
    size_bytes: int
    audio: AudioProbe | None


def _number(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def parse_probe_payload(payload: Mapping[str, Any], path: str = "") -> MediaProbe:
    streams = payload.get("streams") or []
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    if not video:
        raise ValueError("ffprobe payload does not contain a video stream")

    width = _int(video.get("width"))
    height = _int(video.get("height"))
    if width <= 0 or height <= 0:
        raise ValueError("video stream has invalid dimensions")

    rotation = _int((video.get("tags") or {}).get("rotate")) % 360
    display_width, display_height = width, height
    if rotation in {90, 270}:
        display_width, display_height = height, width

    fps, fps_fraction = _parse_rate(video.get("avg_frame_rate"))
    if not fps:
        fps, fps_fraction = _parse_rate(video.get("r_frame_rate"))
    duration = _number(
        video.get("duration")
        if video.get("duration") not in (None, "N/A")
        else (payload.get("format") or {}).get("duration")
    )
    if duration <= 0 or fps <= 0:
        raise ValueError("video stream has invalid duration or frame rate")

    audio_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)
    audio = None
    if audio_stream:
        audio_duration = _number(audio_stream.get("duration"), duration)
        audio = AudioProbe(
            codec=str(audio_stream.get("codec_name") or "unknown"),
            sample_rate=_int(audio_stream.get("sample_rate")),
            channels=_int(audio_stream.get("channels")),
            channel_layout=str(audio_stream.get("channel_layout") or ""),
            duration_seconds=audio_duration if audio_duration > 0 else None,
        )

    return MediaProbe(
        path=path,
        width=width,
        height=height,
        display_width=display_width,
        display_height=display_height,
        duration_seconds=duration,
        fps=fps,
        fps_fraction=fps_fraction,
        codec=str(video.get("codec_name") or "unknown"),
        profile=str(video.get("profile") or ""),
        pixel_format=str(video.get("pix_fmt") or ""),
        color_range=str(video.get("color_range") or ""),
        color_space=str(video.get("color_space") or ""),
        color_transfer=str(video.get("color_transfer") or ""),
        color_primaries=str(video.get("color_primaries") or ""),
        rotation=rotation,
        size_bytes=_int((payload.get("format") or {}).get("size")),
        audio=audio,
    )


def probe_media(path: str | os.PathLike[str]) -> MediaProbe:
    command = [
        "ffprobe", "-v", "error", "-show_streams", "-show_format",
        "-of", "json", os.fspath(path),
    ]
    result = subprocess.run(command, check=True, capture_output=True, text=True)
    payload = json.loads(result.stdout)
    return parse_probe_payload(payload, os.fspath(path))
