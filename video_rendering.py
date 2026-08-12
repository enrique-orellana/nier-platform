"""Low-level helpers for frame- and time-aligned clip rendering."""

from __future__ import annotations

import math
from typing import Any

import cv2

from clip_timeline import ClipFrameRange, build_audio_seek_filter
from master_policy import master_audio_encode_args


def _capture_frame_position(capture: Any) -> int:
    position = capture.get(cv2.CAP_PROP_POS_FRAMES)
    try:
        position = float(position)
    except (TypeError, ValueError) as error:
        raise RuntimeError("video capture returned an invalid frame position") from error
    if not math.isfinite(position) or position < 0:
        raise RuntimeError("video capture returned an invalid frame position")
    return int(round(position))


def seek_capture_to_frame(capture: Any, target_frame: int) -> tuple[int, int]:
    """Position a capture before the requested frame without skipping it.

    The returned frame index is the frame that the caller should read next.
    The second value counts frames decoded and discarded while advancing from
    the decoder's keyframe/preroll position to that requested frame.
    """
    target_frame = int(target_frame)
    if target_frame < 0:
        raise ValueError("target_frame must not be negative")

    if not capture.set(cv2.CAP_PROP_POS_FRAMES, target_frame):
        raise RuntimeError(f"video capture could not seek to frame {target_frame}")

    current_frame = _capture_frame_position(capture)
    if current_frame > target_frame:
        raise RuntimeError(
            f"video capture seek landed after requested frame {target_frame}: {current_frame}"
        )

    discarded_frames = 0
    while current_frame < target_frame:
        ret, _ = capture.read()
        if not ret:
            raise RuntimeError(
                f"video capture could not decode preroll before frame {target_frame}"
            )
        discarded_frames += 1
        next_frame = _capture_frame_position(capture)
        if next_frame <= current_frame:
            raise RuntimeError("video capture did not advance while decoding preroll")
        if next_frame > target_frame:
            raise RuntimeError(
                f"video capture skipped requested frame {target_frame}: {next_frame}"
            )
        current_frame = next_frame

    return target_frame, discarded_frames


def build_audio_extract_command(
    input_path: str,
    output_path: str,
    trim: ClipFrameRange,
) -> list[str]:
    """Build a fast-seeked audio extraction command for a frame-aligned trim."""
    return [
        "ffmpeg",
        "-y",
        "-ss",
        f"{trim.start_sec:.6f}",
        "-i",
        input_path,
        "-t",
        f"{trim.duration_sec:.6f}",
        "-vn",
        "-af",
        build_audio_seek_filter(trim),
        *master_audio_encode_args(),
        output_path,
    ]
