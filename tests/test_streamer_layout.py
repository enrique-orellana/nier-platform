import pytest
import cv2
import numpy as np

from streamer_layout import (
    ClipLayoutOptions,
    compose_streamer_stack_frame,
    clamp_focus_to_region,
    crop_gameplay_region,
    crop_webcam_region,
    enhance_webcam_crop,
    filter_candidates_inside_gameplay_region,
    filter_candidates_outside_webcam_region,
    normalize_clip_layout,
    normalize_gameplay_region,
    normalize_gameplay_zoom,
    normalize_webcam_region,
    streamer_panel_heights,
    webcam_region_pixel_bounds,
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


@pytest.mark.parametrize(
    "region",
    [
        {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0},
        {"x": 0.02, "y": 0.18, "width": 0.23, "height": 0.43},
    ],
)
def test_normalize_webcam_region_accepts_bounded_finite_values(region):
    assert normalize_webcam_region(region) == region


def test_normalize_gameplay_region_rejects_out_of_bounds_values():
    with pytest.raises(ValueError, match="gameplay_region must fit inside"):
        normalize_gameplay_region({"x": 0.8, "y": 0.1, "width": 0.3, "height": 0.2})


def test_normalize_gameplay_zoom_accepts_bounded_values():
    assert normalize_gameplay_zoom(0.6) == 0.6
    assert normalize_gameplay_zoom(1.25) == 1.25
    assert normalize_gameplay_zoom(2.0) == 2.0
    with pytest.raises(ValueError, match="gameplay_zoom"):
        normalize_gameplay_zoom(0.5)


def test_crop_gameplay_region_fills_panel_from_selected_rectangle():
    source = np.zeros((100, 200, 3), dtype=np.uint8)
    source[:, :, 0] = np.arange(200, dtype=np.uint8)
    region = {"x": 0.25, "y": 0.0, "width": 0.5, "height": 1.0}

    result = crop_gameplay_region(source, region, target_width=40, target_height=80)

    assert result.shape == (80, 40, 3)
    assert int(result[:, :, 0].min()) >= 50
    assert int(result[:, :, 0].max()) <= 150


def test_crop_gameplay_region_applies_saved_zoom():
    source = np.zeros((100, 400, 3), dtype=np.uint8)
    source[:, :, 0] = np.arange(400, dtype=np.uint8)
    region = {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0}

    result = crop_gameplay_region(
        source, region, target_width=40, target_height=80, gameplay_zoom=2.0
    )

    assert int(result[:, :, 0].min()) > 100
    assert int(result[:, :, 0].max()) < 220


def test_gameplay_focus_is_clamped_inside_selected_region():
    region = {"x": 0.25, "y": 0.2, "width": 0.5, "height": 0.6}

    assert clamp_focus_to_region((0.0, 1.0), region) == (0.25, 0.8)


def test_filter_candidates_keeps_only_boxes_inside_gameplay_region():
    region = {"x": 0.5, "y": 0.0, "width": 0.5, "height": 1.0}
    candidates = [
        {"box": [0, 0, 40, 40], "score": 1},
        {"box": [100, 25, 10, 30], "score": 2},
        {"box": [120, 40, 20, 40], "score": 3},
    ]

    retained = filter_candidates_inside_gameplay_region(
        candidates, region, frame_width=200, frame_height=100
    )

    assert [candidate["score"] for candidate in retained] == [2, 3]


def test_streamer_stack_manual_gameplay_region_composes_without_detection_focus():
    source = np.zeros((100, 200, 3), dtype=np.uint8)
    source[:, :100] = (0, 0, 255)
    source[:, 100:] = (0, 255, 0)

    result = compose_streamer_stack_frame(
        source,
        output_width=40,
        output_height=80,
        facecam_size="medium",
        webcam_region={"x": 0.0, "y": 0.0, "width": 0.25, "height": 1.0},
        gameplay_region={"x": 0.5, "y": 0.0, "width": 0.5, "height": 1.0},
    )

    _, gameplay_height = streamer_panel_heights(40, 80, "medium")
    assert result.shape == (80, 40, 3)
    assert result[-gameplay_height:, :, 1].mean() > result[-gameplay_height:, :, 2].mean()


def test_streamer_stack_passes_gameplay_zoom_to_final_composition():
    source = np.zeros((100, 400, 3), dtype=np.uint8)
    source[:, :, 0] = np.linspace(0, 255, 400, dtype=np.uint8)
    result = compose_streamer_stack_frame(
        source,
        output_width=40,
        output_height=80,
        webcam_region={"x": 0.0, "y": 0.0, "width": 0.2, "height": 1.0},
        gameplay_region={"x": 0.2, "y": 0.0, "width": 0.8, "height": 1.0},
        gameplay_zoom=2.0,
    )

    _, gameplay_height = streamer_panel_heights(40, 80, "medium")
    gameplay = result[-gameplay_height:]
    assert int(gameplay[:, :, 0].min()) > 120


@pytest.mark.parametrize(
    "region",
    [
        None,
        {},
        {"x": 0.0, "y": 0.0, "width": 0.0, "height": 0.5},
        {"x": 0.0, "y": 0.0, "width": -0.1, "height": 0.5},
        {"x": 0.8, "y": 0.0, "width": 0.3, "height": 0.5},
        {"x": 0.0, "y": 0.8, "width": 0.5, "height": 0.3},
        {"x": float("nan"), "y": 0.0, "width": 0.5, "height": 0.5},
        {"x": 0.0, "y": float("inf"), "width": 0.5, "height": 0.5},
        {"x": 0.0, "y": 0.0, "width": 0.5},
        [0.0, 0.0, 0.5, 0.5],
    ],
)
def test_normalize_webcam_region_rejects_invalid_values(region):
    with pytest.raises(ValueError, match="webcam_region"):
        normalize_webcam_region(region)


def test_webcam_region_converts_to_source_pixel_bounds():
    assert webcam_region_pixel_bounds(
        {"x": 0.25, "y": 0.1, "width": 0.5, "height": 0.6},
        frame_width=200,
        frame_height=100,
    ) == (50, 10, 150, 70)


def test_crop_webcam_region_preserves_selection_without_stretching():
    source = np.zeros((100, 200, 3), dtype=np.uint8)
    source[:, :, 0] = np.arange(200, dtype=np.uint8)
    region = {"x": 0.25, "y": 0.2, "width": 0.5, "height": 0.5}

    result = crop_webcam_region(source, region, target_width=40, target_height=40)

    assert result.shape == (40, 40, 3)
    assert 70 <= int(result[:, :, 0].mean()) <= 130


def test_crop_webcam_region_avoids_halos_when_upscaling():
    source = np.zeros((24, 32, 3), dtype=np.uint8)
    source[:, :16] = 72
    source[:, 16:] = 184
    region = {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0}

    result = crop_webcam_region(source, region, target_width=128, target_height=96)
    baseline = cv2.resize(source, (128, 96), interpolation=cv2.INTER_AREA)

    assert result.shape == baseline.shape
    assert int(result.min()) >= int(baseline.min())
    assert int(result.max()) <= int(baseline.max())
    assert np.unique(result[:, :, 0]).size > np.unique(baseline[:, :, 0]).size


def test_webcam_enhancement_stays_subtle_on_noisy_source():
    source = np.random.default_rng(7).integers(
        32, 224, size=(24, 32, 3), dtype=np.uint8
    )
    result = enhance_webcam_crop(source, target_width=128, target_height=96)
    baseline = cv2.resize(source, (128, 96), interpolation=cv2.INTER_LINEAR)
    difference = np.abs(result.astype(np.int16) - baseline.astype(np.int16))

    assert int(difference.max()) <= 1
    assert float(difference.mean()) < 0.01


def test_filter_candidates_rejects_webcam_region_and_touching_boxes():
    region = {"x": 0.25, "y": 0.25, "width": 0.25, "height": 0.5}
    candidates = [
        {"box": [0, 0, 40, 40], "score": 1},
        {"box": [50, 25, 10, 30], "score": 2},
        {"box": [60, 40, 20, 40], "score": 3},
        {"box": [120, 40, 20, 40], "score": 4},
    ]

    retained = filter_candidates_outside_webcam_region(
        candidates, region, frame_width=200, frame_height=100
    )

    assert [candidate["score"] for candidate in retained] == [1, 4]


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


def test_streamer_stack_gameplay_crop_is_lower_biased_for_landscape_source():
    gradient = np.linspace(0, 255, 1080, dtype=np.uint8)[:, None, None]
    source = np.repeat(np.repeat(gradient, 1920, axis=1), 3, axis=2)

    result = compose_streamer_stack_frame(
        source,
        output_width=1080,
        output_height=1920,
        facecam_size="medium",
    )
    facecam_height, gameplay_height = streamer_panel_heights(1080, 1920, "medium")
    gameplay = result[facecam_height:facecam_height + gameplay_height]

    assert int(gameplay[0].mean()) > 15
    assert int(gameplay[-1].mean()) > int(gameplay[0].mean())
