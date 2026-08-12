"""Frame-accurate source trim calculations shared by video and audio paths."""

from __future__ import annotations

from dataclasses import dataclass
import math


@dataclass(frozen=True)
class ClipFrameRange:
    """An inclusive-start/exclusive-end source frame interval and its clock."""

    start_frame: int
    end_frame: int
    start_sec: float
    end_sec: float

    @property
    def frame_count(self) -> int:
        return self.end_frame - self.start_frame

    @property
    def duration_sec(self) -> float:
        return self.end_sec - self.start_sec


def resolve_clip_frame_range(
    start_sec: float | None,
    end_sec: float | None,
    *,
    source_fps: float,
    total_frames: int,
) -> ClipFrameRange:
    """Convert source timestamps into one clamped, frame-aligned timeline.

    Both the video decoder and the audio trim must use the returned effective
    timestamps. This avoids the subtle offset introduced when a requested
    timestamp falls between source frames.
    """

    if not math.isfinite(float(source_fps)) or float(source_fps) <= 0:
        raise ValueError("source_fps must be a positive finite number")
    if int(total_frames) < 0:
        raise ValueError("total_frames must not be negative")

    frame_total = int(total_frames)
    requested_start = 0.0 if start_sec is None else float(start_sec)
    requested_end = frame_total / float(source_fps) if end_sec is None else float(end_sec)
    if not math.isfinite(requested_start) or not math.isfinite(requested_end):
        raise ValueError("clip timestamps must be finite numbers")

    start_frame = max(0, min(frame_total, int(round(requested_start * source_fps))))
    end_frame = max(0, min(frame_total, int(round(requested_end * source_fps))))
    if end_frame <= start_frame:
        raise ValueError("clip range must contain at least one source frame")

    return ClipFrameRange(
        start_frame=start_frame,
        end_frame=end_frame,
        start_sec=start_frame / float(source_fps),
        end_sec=end_frame / float(source_fps),
    )


def build_audio_trim_filter(trim: ClipFrameRange) -> str:
    """Build the PTS-resetting FFmpeg filter for the same frame-aligned range."""

    return (
        f"atrim=start={trim.start_sec:.6f}:end={trim.end_sec:.6f},"
        "asetpts=PTS-STARTPTS"
    )


def build_audio_seek_filter(trim: ClipFrameRange) -> str:
    """Build a PTS-resetting filter for audio already seeked to the clip start."""

    return (
        f"atrim=start=0:end={trim.duration_sec:.6f},"
        "asetpts=PTS-STARTPTS"
    )
