"""Layout and frame-composition helpers for streamer-style vertical clips."""

from dataclasses import dataclass

import cv2
import numpy as np


STANDARD_LAYOUT = "standard"
STREAMER_STACK_LAYOUT = "streamer_stack"
FACECAM_HEIGHT_RATIOS = {
    "small": 0.30,
    "medium": 0.38,
    "large": 0.46,
}


@dataclass(frozen=True)
class ClipLayoutOptions:
    layout_format: str = STANDARD_LAYOUT
    facecam_size: str = "medium"


def normalize_clip_layout(
    layout_format: str | None = STANDARD_LAYOUT,
    facecam_size: str | None = "medium",
) -> ClipLayoutOptions:
    normalized_layout = str(layout_format or STANDARD_LAYOUT).strip().lower()
    normalized_facecam_size = str(facecam_size or "medium").strip().lower()

    if normalized_layout not in {STANDARD_LAYOUT, STREAMER_STACK_LAYOUT}:
        raise ValueError(f"invalid layout_format: {layout_format}")
    if normalized_facecam_size not in FACECAM_HEIGHT_RATIOS:
        raise ValueError(f"invalid facecam_size: {facecam_size}")
    return ClipLayoutOptions(normalized_layout, normalized_facecam_size)


def streamer_panel_heights(
    output_width: int,
    output_height: int,
    facecam_size: str = "medium",
) -> tuple[int, int]:
    del output_width
    normalized = normalize_clip_layout(STREAMER_STACK_LAYOUT, facecam_size)
    facecam_height = int(output_height * FACECAM_HEIGHT_RATIOS[normalized.facecam_size])
    facecam_height = max(2, min(output_height - 2, facecam_height // 2 * 2))
    return facecam_height, output_height - facecam_height


def _clamp_focus(focus: tuple[float, float] | None) -> tuple[float, float]:
    if focus is None:
        return 0.5, 0.5
    return max(0.0, min(1.0, float(focus[0]))), max(0.0, min(1.0, float(focus[1])))


def _crop_to_aspect(
    frame: np.ndarray,
    target_width: int,
    target_height: int,
    focus: tuple[float, float] | None,
    zoom: float,
) -> np.ndarray:
    source_height, source_width = frame.shape[:2]
    target_aspect = target_width / target_height
    source_aspect = source_width / source_height

    if source_aspect >= target_aspect:
        crop_height = source_height
        crop_width = int(round(crop_height * target_aspect))
    else:
        crop_width = source_width
        crop_height = int(round(crop_width / target_aspect))

    zoom = max(1.0, float(zoom))
    crop_width = max(2, min(source_width, int(crop_width / zoom)))
    crop_height = max(2, min(source_height, int(crop_height / zoom)))
    focus_x, focus_y = _clamp_focus(focus)

    center_x = focus_x * source_width
    center_y = focus_y * source_height
    left = int(round(center_x - crop_width / 2))
    top = int(round(center_y - crop_height / 2))
    left = max(0, min(source_width - crop_width, left))
    top = max(0, min(source_height - crop_height, top))
    return frame[top : top + crop_height, left : left + crop_width]


def compose_streamer_stack_frame(
    frame: np.ndarray,
    output_width: int,
    output_height: int,
    facecam_size: str = "medium",
    face_focus: tuple[float, float] | None = None,
) -> np.ndarray:
    """Create a facecam-over-gameplay frame from one source recording."""

    facecam_height, gameplay_height = streamer_panel_heights(
        output_width, output_height, facecam_size
    )
    facecam = _crop_to_aspect(
        frame,
        output_width,
        facecam_height,
        face_focus,
        zoom=1.6,
    )
    gameplay = _crop_to_aspect(
        frame,
        output_width,
        gameplay_height,
        focus=(0.5, 0.58),
        zoom=1.0,
    )
    facecam = cv2.resize(facecam, (output_width, facecam_height), interpolation=cv2.INTER_AREA)
    gameplay = cv2.resize(
        gameplay, (output_width, gameplay_height), interpolation=cv2.INTER_AREA
    )
    return np.vstack((facecam, gameplay))
