import pytest
import numpy as np

from streamer_layout import (
    ClipLayoutOptions,
    compose_streamer_stack_frame,
    normalize_clip_layout,
    streamer_panel_heights,
)


def test_standard_is_the_legacy_default():
    assert normalize_clip_layout() == ClipLayoutOptions("standard", "medium")


def test_streamer_panel_heights_are_stable():
    assert streamer_panel_heights(1080, 1920, "small") == (576, 1344)
    assert streamer_panel_heights(1080, 1920, "medium") == (728, 1192)
    assert streamer_panel_heights(1080, 1920, "large") == (882, 1038)


def test_invalid_values_fail_before_rendering():
    with pytest.raises(ValueError, match="layout_format"):
        normalize_clip_layout("split_screen", "medium")
    with pytest.raises(ValueError, match="facecam_size"):
        normalize_clip_layout("streamer_stack", "huge")


def test_streamer_stack_composes_facecam_over_gameplay():
    source = np.zeros((1080, 1920, 3), dtype=np.uint8)
    source[:540, :] = (0, 0, 255)
    source[540:, :] = (0, 255, 0)

    result = compose_streamer_stack_frame(
        source,
        output_width=1080,
        output_height=1920,
        facecam_size="medium",
        face_focus=(0.5, 0.35),
    )

    assert result.shape == (1920, 1080, 3)
    assert result[300, 540, 2] > result[300, 540, 1]
    assert result[1600, 540, 1] > result[1600, 540, 2]


def test_streamer_stack_uses_centered_facecam_fallback():
    source = np.zeros((1080, 1920, 3), dtype=np.uint8)
    result = compose_streamer_stack_frame(
        source,
        output_width=1080,
        output_height=1920,
        facecam_size="small",
        face_focus=None,
    )

    assert result.shape == (1920, 1080, 3)
