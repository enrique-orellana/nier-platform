"""Helpers for making source video decodable by the OpenCV processing path."""

from __future__ import annotations


OPENCV_INCOMPATIBLE_CODECS = frozenset({"av1", "av01"})


def requires_decode_compatibility(codec: str | None) -> bool:
    return str(codec or "").strip().lower() in OPENCV_INCOMPATIBLE_CODECS


def build_decode_compatibility_command(input_path: str, output_path: str) -> list[str]:
    return [
        "ffmpeg",
        "-y",
        "-i",
        input_path,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-c:v",
        "libx264",
        "-profile:v",
        "high",
        "-preset",
        "fast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-ar",
        "48000",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        output_path,
    ]
