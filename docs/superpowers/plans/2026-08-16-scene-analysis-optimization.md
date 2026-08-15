# Scene Analysis Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce scene-analysis CPU time by skipping PySceneDetect frames and downscaling only face-analysis samples while preserving the existing strategy rules and render pipeline.

**Architecture:** Resolve one validated scene-analysis configuration per job. Pass its `frame_skip` to PySceneDetect, resize only the three strategy samples per scene, and include both settings in the existing source-analysis fingerprint. Record detector and strategy timings separately; do not modify clip rendering.

**Tech Stack:** Python 3.11, OpenCV, PySceneDetect 0.7, MediaPipe, `unittest`, existing `SourceAnalysis` cache, `JobVideoMetrics`.

---

### Task 1: Write failing tests for configuration and sampling

**Files:** `tests/test_main_generation_pipeline.py`, `tests/test_video_analysis.py`

- [ ] Add a test for the configuration helper:

```python
def test_scene_frame_skip_configuration_accepts_zero_and_rejects_invalid_values(self):
    with patch.dict(main.os.environ, {"SCENE_DETECTION_FRAME_SKIP": "0"}, clear=False):
        self.assertEqual(main.scene_detection_frame_skip(), 0)
    with patch.dict(main.os.environ, {"SCENE_DETECTION_FRAME_SKIP": "bad"}, clear=False):
        self.assertEqual(main.scene_detection_frame_skip(), 2)
    with patch.dict(main.os.environ, {"SCENE_DETECTION_FRAME_SKIP": "-1"}, clear=False):
        self.assertEqual(main.scene_detection_frame_skip(), 2)
```

- [ ] Add a test that patches `scenedetect.SceneManager` and asserts `detect_scenes("source.mp4", frame_skip=2)` calls `scene_manager.detect_scenes(video=video, frame_skip=2)`.

- [ ] Add a test with a 1920×1080 fake frame and patched `detect_face_candidates`; call `analyze_scenes_strategy("source.mp4", [(0, 90)])` and assert the face detector receives a frame whose longest side is `640`.

- [ ] Extend the cache test so identical source metadata with `scene_frame_skip=2` hits the cache, while a subsequent call with `scene_frame_skip=0` rebuilds both builders.

- [ ] Run the red suite:

```powershell
python -m unittest tests.test_main_generation_pipeline tests.test_video_analysis -v
```

Expected: failures for the missing helper, detector argument, resize behavior, and cache setting.

- [ ] Commit the red tests:

```powershell
git add tests/test_main_generation_pipeline.py tests/test_video_analysis.py
git commit -m "test: define faster scene analysis behavior"
```

### Task 2: Implement frame skipping and bounded strategy samples

**Files:** `main.py:75-77`, `main.py:336-364`, `main.py:441-504`

- [ ] Add these constants and helper near the existing generation constants:

```python
DEFAULT_SCENE_FRAME_SKIP = 2
SCENE_STRATEGY_MAX_DIMENSION = 640


def scene_detection_frame_skip() -> int:
    raw_value = os.environ.get("SCENE_DETECTION_FRAME_SKIP", str(DEFAULT_SCENE_FRAME_SKIP))
    try:
        value = int(raw_value)
    except (TypeError, ValueError):
        return DEFAULT_SCENE_FRAME_SKIP
    return value if value >= 0 else DEFAULT_SCENE_FRAME_SKIP
```

- [ ] Add `resize_scene_strategy_frame(frame, max_dimension=640)`. Return the original frame when its longest side is already within the cap; otherwise preserve aspect ratio and call `cv2.resize(..., interpolation=cv2.INTER_AREA)` with dimensions clamped to at least one pixel.

- [ ] Change `detect_scenes` to accept keyword-only `frame_skip=None`, resolve the helper when omitted, and call:

```python
scene_manager.detect_scenes(video=video, frame_skip=frame_skip)
```

Keep the detector, returned scene list, and FPS behavior unchanged.

- [ ] Change `analyze_scenes_strategy` to accept keyword-only `max_dimension=640`. Resize each successfully decoded sample before `detect_face_candidates`; keep all three sample positions, thresholds, and fallback logic unchanged.

- [ ] Run `python -m unittest tests.test_main_generation_pipeline -v` and confirm all focused pipeline tests pass.

- [ ] Commit:

```powershell
git add main.py tests/test_main_generation_pipeline.py
git commit -m "perf: skip frames during scene analysis"
```

### Task 3: Invalidate cached analysis when settings change

**Files:** `video_analysis.py:14`, `main.py:544-605`, `tests/test_video_analysis.py`

- [ ] Add the failing cache-setting test described in Task 1 and run it alone. Expected failure: the cache still treats changed scene settings as a hit.

- [ ] Change `ANALYSIS_VERSION` from `1` to `2` in `video_analysis.py`.

- [ ] In `build_source_analysis_for_job`, resolve `scene_frame_skip = scene_detection_frame_skip()` and `scene_strategy_max_dimension = SCENE_STRATEGY_MAX_DIMENSION`. Add both values to `source_fingerprint`.

- [ ] Call `detect_scenes(str(source_path), frame_skip=scene_frame_skip)` and `analyze_scenes_strategy(str(source_path), scenes, max_dimension=scene_strategy_max_dimension)` through the existing cache builders. Do not change `load_or_build_source_analysis`'s public API; its existing fingerprint comparison must handle invalidation.

- [ ] Run:

```powershell
python -m unittest tests.test_video_analysis tests.test_main_generation_pipeline -v
```

Expected: all cache-hit, cache-mismatch, empty-scene, and pipeline tests pass.

- [ ] Commit:

```powershell
git add main.py video_analysis.py tests/test_video_analysis.py
git commit -m "perf: invalidate scene cache when settings change"
```

### Task 4: Add separate scene-analysis metrics

**Files:** `main.py:441-504`, `main.py:580-605`, `tests/test_main_generation_pipeline.py`

- [ ] Add a failing test that passes `JobVideoMetrics` to `build_source_analysis_for_job` and asserts `to_dict()` contains `scene_detection`, `scene_strategy`, `scene_frame_skip == 2`, and `scene_strategy_samples == 3` for one three-sample scene.

- [ ] Run the test alone and confirm it fails because the scene-specific metrics do not exist.

- [ ] Time the detector and strategy builder callbacks separately with the existing `JobVideoMetrics` methods. Record the configured skip once per cache build and increment `scene_strategy_samples` for each successfully decoded sample. Do not increment expensive-stage metrics on cache hits.

- [ ] Run:

```powershell
python -m unittest tests.test_main_generation_pipeline tests.test_video_analysis tests.test_video_metrics -v
```

Expected: all tests pass.

- [ ] Commit:

```powershell
git add main.py tests/test_main_generation_pipeline.py
git commit -m "perf: measure scene analysis stages"
```

### Task 5: Verify the complete focused change

- [ ] Run the full focused Python suite:

```powershell
python -m unittest tests.test_main_generation_pipeline tests.test_video_analysis tests.test_video_rendering tests.test_video_output_validation tests.test_video_metrics -v
```

Expected: exit code `0` with no failures.

- [ ] Run syntax validation:

```powershell
python -m py_compile main.py video_analysis.py video_metrics.py
```

Expected: exit code `0`.

- [ ] Run GitNexus `impact` upstream for `detect_scenes`, `analyze_scenes_strategy`, and `build_source_analysis_for_job`; review direct callers and affected flows, warning before proceeding if risk is HIGH or CRITICAL.

- [ ] Run GitNexus `detect_changes()` and confirm only planned scene-analysis, cache, metrics, and test symbols are affected.

- [ ] Run `git diff --check` and `git status --short`; inspect the final diff before reporting results.

