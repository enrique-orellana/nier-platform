"""Decode incoming audio to the mono 16 kHz waveform expected by YAMNet."""

from __future__ import annotations

import subprocess

import numpy as np


SAMPLE_RATE = 16_000


class AudioDecodeError(ValueError):
    """Raised when an uploaded file cannot be decoded as audio."""


def decode_audio(payload: bytes) -> tuple[np.ndarray, float]:
    import imageio_ffmpeg

    if not payload:
        raise AudioDecodeError("audio file is empty")

    try:
        result = subprocess.run(
            [
                imageio_ffmpeg.get_ffmpeg_exe(),
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                "pipe:0",
                "-vn",
                "-ac",
                "1",
                "-ar",
                str(SAMPLE_RATE),
                "-f",
                "f32le",
                "pipe:1",
            ],
            input=payload,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            timeout=300,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise AudioDecodeError("audio decoding failed") from exc

    if result.returncode != 0:
        raise AudioDecodeError("audio decoding failed")

    waveform = np.frombuffer(result.stdout, dtype=np.float32)
    if waveform.size == 0:
        raise AudioDecodeError("audio file contains no decodable samples")
    if not np.isfinite(waveform).all():
        raise AudioDecodeError("audio file contains invalid samples")
    return waveform, waveform.size / SAMPLE_RATE
