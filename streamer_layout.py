"""Layout and frame-composition helpers for streamer-style vertical clips."""

from dataclasses import dataclass
from collections.abc import Mapping, Sequence
import math

import cv2
import numpy as np


STANDARD_LAYOUT = "standard"
STREAMER_STACK_LAYOUT = "streamer_stack"
FACECAM_HEIGHT_RATIOS = {
    "small": 0.30,
    "medium": 0.38,
    "large": 0.46,
}
GAMEPLAY_ZOOM_MIN = 0.6
GAMEPLAY_ZOOM_MAX = 2.0
WEBCAM_SHARPEN_SIGMA = 1.0
WEBCAM_SHARPEN_AMOUNT = 0.28


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


def normalize_webcam_region(region: Mapping[str, object] | None) -> dict[str, float]:
    """Validate and normalize a source-frame webcam rectangle."""

    if not isinstance(region, Mapping):
        raise ValueError("webcam_region must be an object")

    values: dict[str, float] = {}
    for key in ("x", "y", "width", "height"):
        value = region.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"webcam_region.{key} must be a finite number")
        numeric_value = float(value)
        if not math.isfinite(numeric_value):
            raise ValueError(f"webcam_region.{key} must be a finite number")
        values[key] = numeric_value

    if values["width"] <= 0 or values["height"] <= 0:
        raise ValueError("webcam_region width and height must be positive")
    if values["x"] < 0 or values["y"] < 0:
        raise ValueError("webcam_region x and y must be non-negative")
    if values["x"] + values["width"] > 1 or values["y"] + values["height"] > 1:
        raise ValueError("webcam_region must fit inside the source frame")
    return values


def normalize_gameplay_region(region: Mapping[str, object] | None) -> dict[str, float]:
    """Validate and normalize a source-frame gameplay rectangle."""

    if not isinstance(region, Mapping):
        raise ValueError("gameplay_region must be an object")

    values: dict[str, float] = {}
    for key in ("x", "y", "width", "height"):
        value = region.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"gameplay_region.{key} must be a finite number")
        numeric_value = float(value)
        if not math.isfinite(numeric_value):
            raise ValueError(f"gameplay_region.{key} must be a finite number")
        values[key] = numeric_value

    if values["width"] <= 0 or values["height"] <= 0:
        raise ValueError("gameplay_region width and height must be positive")
    if values["x"] < 0 or values["y"] < 0:
        raise ValueError("gameplay_region x and y must be non-negative")
    if values["x"] + values["width"] > 1 or values["y"] + values["height"] > 1:
        raise ValueError("gameplay_region must fit inside the source frame")
    return values


def normalize_gameplay_zoom(value: object | None) -> float:
    """Validate the saved gameplay framing zoom used during final rendering."""

    if value is None or isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("gameplay_zoom must be a finite number")
    normalized = float(value)
    if not math.isfinite(normalized):
        raise ValueError("gameplay_zoom must be a finite number")
    if normalized < GAMEPLAY_ZOOM_MIN or normalized > GAMEPLAY_ZOOM_MAX:
        raise ValueError(
            f"gameplay_zoom must be between {GAMEPLAY_ZOOM_MIN} and {GAMEPLAY_ZOOM_MAX}"
        )
    return normalized


def webcam_region_pixel_bounds(
    region: Mapping[str, object], frame_width: int, frame_height: int
) -> tuple[int, int, int, int]:
    """Convert a normalized region into clamped ``left, top, right, bottom`` pixels."""

    if frame_width <= 0 or frame_height <= 0:
        raise ValueError("frame dimensions must be positive")
    normalized = normalize_webcam_region(region)
    left = max(0, min(frame_width - 1, int(round(normalized["x"] * frame_width))))
    top = max(0, min(frame_height - 1, int(round(normalized["y"] * frame_height))))
    right = max(left + 1, min(frame_width, int(round((normalized["x"] + normalized["width"]) * frame_width))))
    bottom = max(top + 1, min(frame_height, int(round((normalized["y"] + normalized["height"]) * frame_height))))
    return left, top, right, bottom


def enhance_webcam_crop(
    crop: np.ndarray,
    target_width: int,
    target_height: int,
) -> np.ndarray:
    """Upscale and lightly sharpen a webcam crop without AI reconstruction."""

    if target_width <= 0 or target_height <= 0:
        raise ValueError("target dimensions must be positive")

    source_width = crop.shape[1]
    interpolation = (
        cv2.INTER_LANCZOS4
        if target_width > source_width or target_height > crop.shape[0]
        else cv2.INTER_AREA
    )
    resized = cv2.resize(crop, (target_width, target_height), interpolation=interpolation)
    blurred = cv2.GaussianBlur(resized, (0, 0), sigmaX=WEBCAM_SHARPEN_SIGMA)
    return cv2.addWeighted(
        resized,
        1.0 + WEBCAM_SHARPEN_AMOUNT,
        blurred,
        -WEBCAM_SHARPEN_AMOUNT,
        0,
    )


def crop_webcam_region(
    frame: np.ndarray,
    region: Mapping[str, object],
    target_width: int,
    target_height: int,
) -> np.ndarray:
    """Crop the selected source region to a panel aspect without stretching it."""

    if target_width <= 0 or target_height <= 0:
        raise ValueError("target dimensions must be positive")
    left, top, right, bottom = webcam_region_pixel_bounds(
        region, frame.shape[1], frame.shape[0]
    )
    selected = frame[top:bottom, left:right]
    selected_height, selected_width = selected.shape[:2]
    target_aspect = target_width / target_height
    selected_aspect = selected_width / selected_height

    if selected_aspect >= target_aspect:
        crop_height = selected_height
        crop_width = max(1, min(selected_width, int(round(crop_height * target_aspect))))
    else:
        crop_width = selected_width
        crop_height = max(1, min(selected_height, int(round(crop_width / target_aspect))))

    crop_left = max(0, (selected_width - crop_width) // 2)
    crop_top = max(0, (selected_height - crop_height) // 2)
    cropped = selected[crop_top:crop_top + crop_height, crop_left:crop_left + crop_width]
    return enhance_webcam_crop(cropped, target_width, target_height)


def gameplay_region_pixel_bounds(
    region: Mapping[str, object], frame_width: int, frame_height: int
) -> tuple[int, int, int, int]:
    """Convert a normalized gameplay region into clamped pixel bounds."""

    if frame_width <= 0 or frame_height <= 0:
        raise ValueError("frame dimensions must be positive")
    normalized = normalize_gameplay_region(region)
    left = max(0, min(frame_width - 1, int(round(normalized["x"] * frame_width))))
    top = max(0, min(frame_height - 1, int(round(normalized["y"] * frame_height))))
    right = max(left + 1, min(frame_width, int(round((normalized["x"] + normalized["width"]) * frame_width))))
    bottom = max(top + 1, min(frame_height, int(round((normalized["y"] + normalized["height"]) * frame_height))))
    return left, top, right, bottom


def clamp_focus_to_region(
    focus: tuple[float, float] | None,
    region: Mapping[str, object],
) -> tuple[float, float] | None:
    """Clamp a global normalized focus point to a normalized gameplay region."""

    if focus is None:
        return None
    normalized = normalize_gameplay_region(region)
    focus_x = max(normalized["x"], min(normalized["x"] + normalized["width"], float(focus[0])))
    focus_y = max(normalized["y"], min(normalized["y"] + normalized["height"], float(focus[1])))
    return focus_x, focus_y


def crop_gameplay_region(
    frame: np.ndarray,
    region: Mapping[str, object],
    target_width: int,
    target_height: int,
    focus: tuple[float, float] | None = None,
    gameplay_zoom: float = 1.0,
) -> np.ndarray:
    """Crop a selected gameplay region to a panel aspect without letterboxing."""

    if target_width <= 0 or target_height <= 0:
        raise ValueError("target dimensions must be positive")
    normalized = normalize_gameplay_region(region)
    left, top, right, bottom = gameplay_region_pixel_bounds(
        normalized, frame.shape[1], frame.shape[0]
    )
    selected = frame[top:bottom, left:right]
    selected_focus = clamp_focus_to_region(focus, normalized)
    relative_focus = None
    if selected_focus is not None:
        relative_focus = (
            (selected_focus[0] - normalized["x"]) / normalized["width"],
            (selected_focus[1] - normalized["y"]) / normalized["height"],
        )
    cropped = _crop_to_aspect(
        selected,
        target_width,
        target_height,
        focus=relative_focus,
        zoom=normalize_gameplay_zoom(gameplay_zoom),
    )
    return cv2.resize(cropped, (target_width, target_height), interpolation=cv2.INTER_AREA)


def filter_candidates_outside_webcam_region(
    candidates: Sequence[Mapping[str, object]],
    region: Mapping[str, object],
    frame_width: int,
    frame_height: int,
) -> list[Mapping[str, object]]:
    """Keep only detection candidates that do not touch the selected webcam area."""

    left, top, right, bottom = webcam_region_pixel_bounds(
        region, frame_width, frame_height
    )
    retained: list[Mapping[str, object]] = []
    for candidate in candidates:
        box = candidate.get("box") if isinstance(candidate, Mapping) else None
        if not isinstance(box, Sequence) or isinstance(box, (str, bytes)) or len(box) < 4:
            retained.append(candidate)
            continue
        try:
            box_left = float(box[0])
            box_top = float(box[1])
            box_right = box_left + float(box[2])
            box_bottom = box_top + float(box[3])
        except (TypeError, ValueError):
            retained.append(candidate)
            continue
        touches_region = not (
            box_right < left
            or box_left > right
            or box_bottom < top
            or box_top > bottom
        )
        if not touches_region:
            retained.append(candidate)
    return retained


def filter_candidates_inside_gameplay_region(
    candidates: Sequence[Mapping[str, object]],
    region: Mapping[str, object],
    frame_width: int,
    frame_height: int,
) -> list[Mapping[str, object]]:
    """Keep only detection candidates fully contained by the gameplay area."""

    left, top, right, bottom = gameplay_region_pixel_bounds(
        region, frame_width, frame_height
    )
    retained: list[Mapping[str, object]] = []
    for candidate in candidates:
        box = candidate.get("box") if isinstance(candidate, Mapping) else None
        if not isinstance(box, Sequence) or isinstance(box, (str, bytes)) or len(box) < 4:
            continue
        try:
            box_left = float(box[0])
            box_top = float(box[1])
            box_right = box_left + float(box[2])
            box_bottom = box_top + float(box[3])
        except (TypeError, ValueError):
            continue
        if box_left >= left and box_top >= top and box_right <= right and box_bottom <= bottom:
            retained.append(candidate)
    return retained


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

    zoom = max(GAMEPLAY_ZOOM_MIN, min(GAMEPLAY_ZOOM_MAX, float(zoom)))
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
    webcam_region: Mapping[str, object] | None = None,
    gameplay_region: Mapping[str, object] | None = None,
    gameplay_focus: tuple[float, float] | None = None,
    gameplay_zoom: float = 1.0,
) -> np.ndarray:
    """Create a facecam-over-gameplay frame from one source recording."""

    facecam_height, gameplay_height = streamer_panel_heights(
        output_width, output_height, facecam_size
    )
    if webcam_region is not None:
        facecam = crop_webcam_region(
            frame,
            webcam_region,
            target_width=output_width,
            target_height=facecam_height,
        )
    else:
        facecam = _crop_to_aspect(
            frame,
            output_width,
            facecam_height,
            face_focus,
            zoom=1.6,
        )
    if gameplay_region is not None:
        gameplay = crop_gameplay_region(
            frame,
            gameplay_region,
            target_width=output_width,
            target_height=gameplay_height,
            focus=gameplay_focus,
            gameplay_zoom=gameplay_zoom,
        )
    else:
        gameplay = _crop_to_aspect(
            frame,
            output_width,
            gameplay_height,
            focus=gameplay_focus or (0.5, 0.58),
            # A bounded zoom gives the lower-biased focus room to move on
            # landscape sources, where an unzoomed portrait crop uses full height.
            zoom=1.12,
        )
    facecam = cv2.resize(facecam, (output_width, facecam_height), interpolation=cv2.INTER_AREA)
    gameplay = cv2.resize(
        gameplay, (output_width, gameplay_height), interpolation=cv2.INTER_AREA
    )
    return np.vstack((facecam, gameplay))
