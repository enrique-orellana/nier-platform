# Scene Analysis Optimization Design

**Date:** 2026-08-16  
**Status:** Approved for planning  
**Scope:** PySceneDetect and scene strategy analysis in `main.py`

## Goal

Reduce the time spent analyzing scenes during long-video clip generation while keeping the existing scene strategy behavior and final render quality as stable as possible.

## Current cost

The source-analysis path scans the entire source with PySceneDetect. It then opens the source again and seeks three frames per detected scene, running MediaPipe face detection on each full-resolution frame. Large sources and videos with many cuts therefore pay for a full decode plus many high-resolution face-inference calls before any clip is rendered.

## Recommended design

### 1. Skip frames during scene detection

Pass a configurable `frame_skip` value to PySceneDetect's `SceneManager.detect_scenes`. The default will be `2`, meaning the detector examines approximately every third frame. A value of `0` will preserve the current full-frame behavior.

The setting will be read once from `SCENE_DETECTION_FRAME_SKIP`, validated as a non-negative integer, and included in the source-analysis cache identity. Invalid values will use the safe default rather than failing a generation job.

Scene boundaries will continue to be normalized into source-frame coordinates and used by the existing renderer. Because skipped frames can move a detected cut by up to the sampling interval, this is an intentional speed/precision tradeoff for the scene-analysis stage.

### 2. Downscale strategy-analysis samples

Before `detect_face_candidates` processes each of the existing three samples per scene, resize the sample so its longest side is at most 640 pixels. Face counts—not bounding-box coordinates—are used by `analyze_scenes_strategy`, so the resized frame is sufficient and does not affect crop coordinates in the final renderer.

Frames already at or below the cap will be passed through unchanged. The resize helper will preserve aspect ratio and avoid creating zero-sized dimensions.

### 3. Preserve classification and caching behavior

Keep the current three sample positions, face-count thresholds, `TRACK`/`GENERAL` decisions, and YOLO fallback behavior unchanged in this first pass. Bump the analysis cache version and include the skip/cap settings in the source fingerprint so old full-resolution results cannot be reused silently.

### 4. Add measurement

Keep the existing `scene_analysis` timing and add separate counters/timings for detector frame skipping and strategy sample count. This makes it possible to compare cache misses before and after the change without attributing render time to scene analysis.

## Alternatives rejected

- One sample per scene: faster, but more likely to misclassify a scene when the speaker or group composition changes.
- Sequential one-pass face analysis: avoids random seeks but requires coupling face sampling to the scene detector's decode loop and risks changing PySceneDetect behavior.
- Replacing PySceneDetect with a custom detector: larger correctness and maintenance risk than this focused optimization.

## Correctness and failure handling

- If PySceneDetect rejects the configured argument, generation must fail with a clear error rather than silently producing invalid scenes.
- If scene detection returns no scenes, retain the existing one-full-source-scene fallback.
- If a sampled frame cannot be decoded, retain the current behavior of using the available samples and classifying from their average face count.
- Final clip rendering, frame tracking, output dimensions, audio, and encoding policy remain unchanged.

## Testing and acceptance criteria

Tests will be written before implementation and will verify:

- `SceneManager.detect_scenes` receives the configured `frame_skip` value.
- The default skip is `2`, while `0` is accepted for exact full-frame analysis.
- Invalid skip values fall back safely.
- Strategy samples passed to face detection are capped at 640 pixels on the longest side.
- Existing face-count thresholds and no-sample fallback behavior remain unchanged.
- Cache entries are invalidated when scene-analysis settings change.
- Existing source-analysis cache hits still avoid both expensive builders.

Benchmark acceptance for a representative source:

- Scene-analysis wall-clock time decreases on a cache miss.
- Scene count and strategy output remain within the expected tolerance for the selected skip value.
- Existing focused tests pass.
- Final render behavior and output validation are unchanged because the renderer is outside this scope.

