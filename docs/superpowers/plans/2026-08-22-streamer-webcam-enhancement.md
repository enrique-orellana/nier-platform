# Streamer Stack Traditional Webcam Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the perceived sharpness of the Streamer Stack upper webcam panel with deterministic, non-AI image processing.

**Architecture:** Keep region selection and aspect cropping in `streamer_layout.py`, then route only the webcam crop through a focused enhancement helper. Use linear interpolation for enlargement and a very mild Gaussian unsharp mask to avoid ringing; leave gameplay, metadata, tracking, and panel geometry untouched.

**Tech Stack:** Python, NumPy, OpenCV, pytest.

---

### Task 1: Add the failing webcam enhancement tests

**Files:**
- Modify: `tests/test_streamer_layout.py`
- Test: `tests/test_streamer_layout.py`

- [ ] **Step 1: Add the helper import and a dimension test**

Add `enhance_webcam_crop` to the existing `streamer_layout` import list and add:

```python
def test_enhance_webcam_crop_returns_requested_dimensions():
    source = np.zeros((12, 16, 3), dtype=np.uint8)

    result = enhance_webcam_crop(source, target_width=64, target_height=48)

    assert result.shape == (48, 64, 3)
    assert result.dtype == source.dtype
```

- [ ] **Step 2: Add a behavior test against the old area-upscale baseline**

Add this deterministic synthetic edge test:

```python
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
```

The assertions express the user-visible contract: an enlarged webcam edge
should gain intermediate detail without creating values outside the original
area-upscaled range, which would appear as a halo.

- [ ] **Step 3: Run only the new tests and verify they fail for the missing behavior**

Run:

```powershell
python -m pytest tests/test_streamer_layout.py -k "avoids_halos_when_upscaling" -q
```

Expected: the halo regression fails because the existing implementation
produces values outside the area-upscaled range. Fix test syntax/import issues
if needed, but do not add production code before observing the expected red
result.

### Task 2: Implement the focused traditional enhancement

**Files:**
- Modify: `streamer_layout.py:around crop_webcam_region`
- Test: `tests/test_streamer_layout.py`

- [ ] **Step 1: Add the helper with conservative constants**

Define the helper near the webcam crop functions:

```python
WEBCAM_SHARPEN_SIGMA = 1.0
WEBCAM_SHARPEN_AMOUNT = 0.02


def enhance_webcam_crop(
    crop: np.ndarray,
    target_width: int,
    target_height: int,
) -> np.ndarray:
    """Upscale and lightly sharpen a webcam crop without AI reconstruction."""

    if target_width <= 0 or target_height <= 0:
        raise ValueError("target dimensions must be positive")

    source_height, source_width = crop.shape[:2]
    interpolation = (
        cv2.INTER_LINEAR
        if target_width > source_width or target_height > source_height
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
```

- [ ] **Step 2: Route only the webcam crop through the helper**

In `crop_webcam_region()`, replace the final area resize:

```python
return cv2.resize(cropped, (target_width, target_height), interpolation=cv2.INTER_AREA)
```

with:

```python
return enhance_webcam_crop(cropped, target_width, target_height)
```

Do not change `crop_gameplay_region()` or the final gameplay resize in
`compose_streamer_stack_frame()`.

- [ ] **Step 3: Run the focused tests and verify they pass**

Run:

```powershell
python -m pytest tests/test_streamer_layout.py -k "avoids_halos_when_upscaling" -q
```

Expected: both tests pass.

### Task 3: Regression verification and impact review

**Files:**
- Modify: none
- Test: `tests/test_streamer_layout.py`, the repository's existing Python and dashboard suites as applicable

- [ ] **Step 1: Run the complete Streamer Stack layout suite**

Run:

```powershell
pytest tests/test_streamer_layout.py -q
```

Expected: all layout tests pass.

- [ ] **Step 2: Run related Python regression tests**

Run:

```powershell
pytest tests/test_main_generation_pipeline.py tests/test_python_worker.py -q
```

Expected: all related pipeline and worker tests pass.

- [ ] **Step 3: Run GitNexus change-impact detection**

Run the GitNexus `detect_changes` check with the current working tree and
confirm only the intended webcam crop/composition symbols and their known
tests are affected. If the result reports unexpected flows, inspect the diff
and adjust before claiming completion.

- [ ] **Step 4: Inspect the final diff and report verification evidence**

Run:

```powershell
git diff -- streamer_layout.py tests/test_streamer_layout.py
git status --short
```

Confirm that unrelated pre-existing working-tree changes remain untouched and
that the final summary explicitly states that this is perceptual enhancement,
not recovered source detail.
