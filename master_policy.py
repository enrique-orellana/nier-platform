"""Mandatory master export policy and honest output-size calculation."""

from __future__ import annotations

import json
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path

from media_probe import MediaProbe


POLICY_PATH = Path(__file__).with_name("master-export-policy.json")


def load_master_policy() -> dict:
    with POLICY_PATH.open("r", encoding="utf-8") as handle:
        return json.load(handle)


@dataclass(frozen=True)
class MasterSpec:
    width: int
    height: int
    fps: float
    codec: str
    profile: str
    crf: int
    preset: str
    pixel_format: str
    audio_codec: str
    audio_sample_rate: int
    audio_bitrate: str
    faststart: bool
    tone_map_to_sdr: bool


def _even(value: int) -> int:
    value = max(2, int(value))
    return value if value % 2 == 0 else value - 1


def _output_dimensions(media: MediaProbe, strategy: str, policy: dict) -> tuple[int, int]:
    max_width = int(policy["max_width"])
    max_height = int(policy["max_height"])
    source_width = min(media.display_width, max_width)
    source_height = min(media.display_height, max_height)
    aspect = Fraction(9, 16)

    if strategy == "crop" and media.display_width > media.display_height:
        usable_width = round(media.display_height * float(aspect))
        width = min(source_width, usable_width)
        height = min(source_height, round(width / float(aspect)))
    elif media.display_width * 16 == media.display_height * 9:
        width, height = source_width, source_height
    else:
        height = source_height
        width = min(source_width, round(height * float(aspect)))

    return _even(width), _even(height)


def choose_master_spec(media: MediaProbe, strategy: str = "crop") -> MasterSpec:
    policy = load_master_policy()
    width, height = _output_dimensions(media, strategy, policy)
    transfer = media.color_transfer.lower()
    return MasterSpec(
        width=width,
        height=height,
        fps=min(float(policy["max_fps"]), media.fps),
        codec=str(policy["codec"]),
        profile=str(policy["profile"]),
        crf=int(policy["crf"]),
        preset=str(policy["preset"]),
        pixel_format=str(policy["pixel_format"]),
        audio_codec=str(policy["audio_codec"]),
        audio_sample_rate=int(policy["audio_sample_rate"]),
        audio_bitrate=str(policy["audio_bitrate"]),
        faststart=bool(policy["faststart"]),
        tone_map_to_sdr=transfer in {"smpte2084", "arib-std-b67", "hlg"},
    )


def master_video_encode_args(include_audio: bool = True) -> list[str]:
    """Return the single mandatory H.264/MP4 encode contract for FFmpeg paths."""
    policy = load_master_policy()
    args = [
        "-c:v", "libx264",
        "-profile:v", str(policy["profile"]),
        "-preset", str(policy["preset"]),
        "-crf", str(policy["crf"]),
        "-pix_fmt", str(policy["pixel_format"]),
    ]
    if include_audio:
        args.extend([
            "-c:a", str(policy["audio_codec"]),
            "-ar", str(policy["audio_sample_rate"]),
            "-b:a", str(policy["audio_bitrate"]),
        ])
    if policy.get("faststart"):
        args.extend(["-movflags", "+faststart"])
    return args
