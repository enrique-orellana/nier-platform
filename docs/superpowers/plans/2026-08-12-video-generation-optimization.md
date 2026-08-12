# Video Generation Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce long-video clip-generation time and compute cost by analyzing each source once and rendering only each requested clip range, while preserving current crop, tracking, audio, and export quality.

**Architecture:** Add a serializable `SourceAnalysis` value containing source metadata, scene boundaries, and scene strategies. Build or load it once per job, pass it to every clip render, seek the decoder to each clip’s frame range, and extract audio with direct start/duration seeking. Add output validation and stage metrics before considering a clip ready or uploading it.

**Tech Stack:** Python 3.11, OpenCV, PySceneDetect, MediaPipe, Ultralytics YOLO, FFmpeg, FastAPI subprocess jobs, `unittest`, existing `media_probe.py` and `clip_timeline.py` utilities.

---

## File map

- Create: `video_analysis.py` — `SourceAnalysis` data model, source fingerprint, JSON cache serialization, and cache load/build orchestration.
- Create: `video_rendering.py` — decoder seek helper, clip render metrics, and direct-seek audio command construction.
- Create: `video_output_validation.py` — final MP4 validation against the existing master export policy.
- Modify: `main.py:380-850, 1260-1335` — build source analysis once, pass it into clip rendering, seek decoder ranges, use direct audio extraction, and emit metrics.
- Modify: `app.py:520-625` — expose only validated clip artifacts in partial and completed job results.
- Modify: `clip_timeline.py:27-62` — retain frame-aligned trim semantics and expose the duration values needed by direct audio extraction.
- Modify: `s3_uploader.py:541-560` — upload only validated final artifacts and retain temporary-file exclusions.
- Test: `tests/test_video_analysis.py` — source-analysis serialization, cache hits, cache invalidation, and one-time analysis callbacks.
- Test: `tests/test_video_rendering.py` — decoder seeking, frame accounting, and direct audio command construction.
- Test: `tests/test_video_output_validation.py` — valid/invalid output behavior and policy checks.
- Test: `tests/test_main_generation_pipeline.py` — shared source-analysis object is passed to all clips and analysis callbacks run once.
- Test: `tests/test_video_artifact_readiness.py` — policy-backed and legacy artifact readiness checks.
- Test: `tests/test_s3_clip_urls.py` — existing artifact upload behavior remains protected.

## Task 1: Add the source-analysis model and cache tests

**Files:**
- Create: `tests/test_video_analysis.py`
- Create: `video_analysis.py`

- [ ] **Step 1: Write failing tests for `SourceAnalysis` serialization.**

Add tests that create an analysis with the fields below, serialize it, deserialize it, and assert equality:

```python
analysis = SourceAnalysis(
    source_fingerprint={"size": 123, "mtime_ns": 456, "codec": "h264"},
    source_fps=30.0,
    total_frames=900,
    width=1080,
    height=1920,
    scene_boundaries=[(0, 300), (300, 900)],
    scene_strategies=["GENERAL", "TRACK"],
    analysis_version=1,
)
restored = SourceAnalysis.from_dict(analysis.to_dict())
assert restored == analysis
```

- [ ] **Step 2: Run the focused test and verify it fails for the missing module.**

Run:

```powershell
python -m unittest tests.test_video_analysis -v
```

Expected: import failure because `video_analysis.py` and `SourceAnalysis` do not exist yet.

- [ ] **Step 3: Write failing tests for cache hit and cache invalidation.**

Use callback counters so the tests prove the expensive analysis functions are not repeated:

```python
def test_load_or_build_reuses_matching_cache(tmp_path):
    calls = {"scenes": 0, "strategies": 0}

    def build_scenes():
        calls["scenes"] += 1
        return [(0, 100), (100, 200)]

    def build_strategies(_scenes):
        calls["strategies"] += 1
        return ["TRACK", "GENERAL"]

    first = load_or_build_source_analysis(
        cache_path=tmp_path / "source_analysis.json",
        source_fingerprint={"size": 10, "mtime_ns": 20, "codec": "h264"},
        source_fps=30.0,
        total_frames=200,
        width=1920,
        height=1080,
        scene_builder=build_scenes,
        strategy_builder=build_strategies,
    )
    second = load_or_build_source_analysis(
        cache_path=tmp_path / "source_analysis.json",
        source_fingerprint={"size": 10, "mtime_ns": 20, "codec": "h264"},
        source_fps=30.0,
        total_frames=200,
        width=1920,
        height=1080,
        scene_builder=build_scenes,
        strategy_builder=build_strategies,
    )

    assert first == second
    assert calls == {"scenes": 1, "strategies": 1}
```

Add a second test changing `mtime_ns` and assert both callbacks execute again.

- [ ] **Step 4: Run the cache tests and verify the expected failures.**

Run:

```powershell
python -m unittest tests.test_video_analysis -v
```

Expected: failures for the missing cache API and missing invalidation behavior.

- [ ] **Step 5: Implement `video_analysis.py`.**

Implement the following public API:

```python
ANALYSIS_VERSION = 1

@dataclass(frozen=True)
class SourceAnalysis:
    source_fingerprint: dict[str, object]
    source_fps: float
    total_frames: int
    width: int
    height: int
    scene_boundaries: list[tuple[int, int]]
    scene_strategies: list[str]
    analysis_version: int = ANALYSIS_VERSION

    def to_dict(self) -> dict[str, object]: ...

    @classmethod
    def from_dict(cls, payload: dict[str, object]) -> "SourceAnalysis": ...


def load_or_build_source_analysis(
    *,
    cache_path: Path,
    source_fingerprint: dict[str, object],
    source_fps: float,
    total_frames: int,
    width: int,
    height: int,
    scene_builder: Callable[[], list[tuple[int, int]]],
    strategy_builder: Callable[[list[tuple[int, int]]], list[str]],
) -> SourceAnalysis: ...
```

The cache is valid only when `analysis_version`, fingerprint, FPS, frame count, width, and height all match. Write JSON atomically with a sibling temporary file and `os.replace`. If the cache is missing, malformed, or mismatched, rebuild it. Normalize scene boundaries and strategies to JSON-safe primitive values.

- [ ] **Step 6: Run the focused tests and verify they pass.**

Run:

```powershell
python -m unittest tests.test_video_analysis -v
```

Expected: all source-analysis serialization, cache-hit, and cache-invalidation tests pass.

- [ ] **Step 7: Commit the isolated source-analysis unit.**

```powershell
git add video_analysis.py tests/test_video_analysis.py
git commit -m "refactor: cache source video analysis"
```

## Task 2: Add direct-seek rendering helpers and tests

**Files:**
- Create: `tests/test_video_rendering.py`
- Create: `video_rendering.py`
- Modify: `clip_timeline.py:18-24`

- [ ] **Step 1: Write failing tests for direct audio command construction.**

Add a test using an existing `ClipFrameRange`:

```python
trim = ClipFrameRange(
    start_frame=600,
    end_frame=1800,
    start_sec=20.0,
    end_sec=60.0,
)
command = build_audio_extract_command("source.mp4", "audio.m4a", trim)

assert command[:5] == ["ffmpeg", "-y", "-ss", "20.000000", "-i"]
assert command[command.index("-t") + 1] == "40.000000"
assert command[-1] == "audio.m4a"
```

- [ ] **Step 2: Write failing tests for decoder seek accounting.**

Create a fake capture object with `set`, `get`, and `read` methods. Assert that `seek_capture_to_frame(fake, 120)` positions at or before frame 120, discards only preroll frames, and returns frame index 120 for the first processable frame. Add a test that raises a clear `RuntimeError` when the capture cannot seek or read the requested range.

- [ ] **Step 3: Run the focused tests and verify they fail.**

Run:

```powershell
python -m unittest tests.test_video_rendering -v
```

Expected: import/API failures because `video_rendering.py` and the command builder do not exist.

- [ ] **Step 4: Implement `video_rendering.py`.**

Implement:

```python
def seek_capture_to_frame(capture, target_frame: int) -> tuple[int, int]:
    """Seek a capture and return (first_frame_index, discarded_preroll_frames)."""


def build_audio_extract_command(input_path: str, output_path: str, trim: ClipFrameRange) -> list[str]:
    """Use fast input seeking plus exact clip duration and existing AAC settings."""
```

`seek_capture_to_frame` must call `capture.set(cv2.CAP_PROP_POS_FRAMES, target_frame)`, inspect the resulting position, and discard frames until the first returned frame is the requested frame. It must never silently start after the requested frame. Return metrics for decoded/discarded frames so the caller can report keyframe overhead.

`build_audio_extract_command` must use `-ss <trim.start_sec>` before `-i`, `-t <trim.duration_sec>`, `-vn`, the existing `master_audio_encode_args()`, and the existing timestamp-resetting filter. Do not change the AAC sample rate or bitrate in this task.

- [ ] **Step 5: Run the focused tests and verify they pass.**

Run:

```powershell
python -m unittest tests.test_video_rendering -v
```

Expected: all direct-seek and audio-command tests pass.

- [ ] **Step 6: Commit the rendering-helper unit.**

```powershell
git add video_rendering.py tests/test_video_rendering.py clip_timeline.py
git commit -m "perf: add direct clip seek helpers"
```

## Task 3: Add output validation before readiness and upload

**Files:**
- Create: `tests/test_video_output_validation.py`
- Create: `video_output_validation.py`

- [ ] **Step 1: Write failing tests for output validation.**

Mock `probe_media` with valid and invalid `MediaProbe` values. Cover:

```python
def test_validate_clip_output_accepts_matching_h264_output(): ...
def test_validate_clip_output_rejects_missing_video_stream(): ...
def test_validate_clip_output_rejects_zero_duration_or_frames(): ...
def test_validate_clip_output_rejects_wrong_dimensions(): ...
def test_validate_clip_output_requires_audio_when_source_has_audio(): ...
```

The tests must assert the exception message identifies the failed property, not merely that a generic exception occurred.

- [ ] **Step 2: Run the focused tests and verify they fail.**

Run:

```powershell
python -m unittest tests.test_video_output_validation -v
```

Expected: import failure because `video_output_validation.py` does not exist.

- [ ] **Step 3: Implement `validate_clip_output`.**

Implement:

```python
def validate_clip_output(
    output_path: str | Path,
    *,
    expected_width: int,
    expected_height: int,
    expected_fps: float,
    source_has_audio: bool,
) -> MediaProbe: ...
```

Use `probe_media`, require H.264 video, positive duration, positive size, and a valid audio stream when `source_has_audio` is true. Permit small FPS representation differences using a relative tolerance of `1e-3`. Return the probe on success and raise `ValueError` with a specific failure reason otherwise.

- [ ] **Step 4: Run the focused tests and verify they pass.**

Run:

```powershell
python -m unittest tests.test_video_output_validation -v
```

Expected: all validation tests pass.

- [ ] **Step 5: Commit the validation unit.**

```powershell
git add video_output_validation.py tests/test_video_output_validation.py
git commit -m "fix: validate generated clip outputs"
```

## Task 4: Integrate one-time analysis and direct clip rendering

**Files:**
- Create: `tests/test_main_generation_pipeline.py`
- Modify: `main.py:389-441, 620-850, 1280-1325`
- Modify: `s3_uploader.py:541-560`

- [ ] **Step 1: Write failing integration tests for one-time analysis.**

Extract a small orchestration helper from `main.py` with this contract:

```python
def render_clip_plan(
    *,
    input_video: str,
    output_dir: str,
    video_title: str,
    clips: list[dict],
    source_analysis: SourceAnalysis,
    transcript: dict,
    source_asset: dict,
    source_media: MediaProbe,
) -> list[dict]: ...
```

Test with a mocked `process_video_to_vertical` and assert:

- It is called once per requested clip.
- Every call receives the exact same `source_analysis` object.
- `detect_scenes` and `analyze_scenes_strategy` are not called by the per-clip renderer.
- The returned clip metadata uses canonical final filenames only.

Add a second test around `build_source_analysis_for_job` that counts scene and strategy callbacks and asserts one call for a 15-clip plan.

- [ ] **Step 2: Run the integration tests and verify they fail.**

Run:

```powershell
python -m unittest tests.test_main_generation_pipeline -v
```

Expected: failures because the orchestration helper and shared-analysis parameters do not exist.

- [ ] **Step 3: Implement source-analysis construction in `main.py`.**

Add a helper that:

1. Probes the working input.
2. Builds a fingerprint from resolved path, size, mtime, codec, FPS, frame count, width, and height.
3. Calls `detect_scenes` once.
4. Converts scene timecodes to primitive `(start_frame, end_frame)` boundaries.
5. Calls `analyze_scenes_strategy` once using the raw scene list.
6. Writes/loads the cache through `load_or_build_source_analysis`.

When no scenes are detected, create one boundary covering the source and use the existing fallback strategy behavior.

- [ ] **Step 4: Refactor `process_video_to_vertical` to consume shared analysis.**

Change the function signature to accept `source_analysis: SourceAnalysis` and remove per-call `detect_scenes`, source frame-count probing, and `analyze_scenes_strategy` calls. Use:

```python
source_fps = source_analysis.source_fps
total_frames = source_analysis.total_frames
scene_boundaries = source_analysis.scene_boundaries
scene_strategies = source_analysis.scene_strategies
trim = resolve_clip_frame_range(start_sec, end_sec, source_fps=source_fps, total_frames=total_frames)
```

Keep the existing frame processing branch unchanged after the decoder is positioned. Replace the initial `VideoCapture` read-from-zero behavior with `seek_capture_to_frame`, set `frame_number` to the requested frame, and stop at `trim.end_frame`. Count discarded preroll frames separately from processable frames.

- [ ] **Step 5: Extract the direct audio command and validate the final output.**

Replace the current full-source audio command with `build_audio_extract_command`. After merging video and audio, call `validate_clip_output` before logging the clip as ready. If validation fails, remove the final output and return failure.

- [ ] **Step 6: Build analysis once in the main job entry point.**

After `prepare_opencv_video` and `_prepare_manifest_source`, build or load one `SourceAnalysis` for `processing_video`. Pass it into every call in the clip loop. Do not alter the current transcript, AI planning, manifest, or output policy behavior.

- [ ] **Step 7: Ensure readiness and upload use validated final files.**

Update the job completion path so a clip is included in `jobs[job_id]['result']` only when its final file passes validation. Keep `_temp_video.mp4`, `_temp_audio.m4a`, and other temporary artifacts excluded from `upload_job_artifacts`. Do not upload a file merely because it exists and has nonzero bytes.

- [ ] **Step 8: Run the integration tests and verify they pass.**

Run:

```powershell
python -m unittest tests.test_main_generation_pipeline tests.test_video_analysis tests.test_video_rendering tests.test_video_output_validation -v
```

Expected: all focused tests pass, including proof that expensive analysis executes once.

- [ ] **Step 9: Commit the integrated optimization.**

```powershell
git add main.py s3_uploader.py tests/test_main_generation_pipeline.py
git commit -m "perf: render clips from shared source analysis"
```

## Task 5: Add stage-level metrics and benchmark harness

**Files:**
- Create: `tests/test_video_metrics.py`
- Create: `video_metrics.py`
- Modify: `main.py:620-850, 1280-1325`
- Modify: `docs/superpowers/specs/2026-08-12-video-generation-optimization-design.md` only if measured acceptance criteria need a concrete update

- [ ] **Step 1: Write failing tests for metrics aggregation.**

Test a metrics object that records named durations and counters:

```python
metrics = JobVideoMetrics()
metrics.add_duration("scene_analysis", 2.5)
metrics.increment("decoded_frames", 120)
metrics.increment("output_frames", 60)
payload = metrics.to_dict()

assert payload["durations"]["scene_analysis"] == 2.5
assert payload["counters"]["decoded_frames"] == 120
assert payload["counters"]["output_frames"] == 60
```

- [ ] **Step 2: Run the focused metrics test and verify it fails.**

Run:

```powershell
python -m unittest tests.test_video_metrics -v
```

Expected: import failure because `video_metrics.py` does not exist.

- [ ] **Step 3: Implement the metrics object.**

Implement `JobVideoMetrics` with monotonic-clock helpers, named duration accumulation, integer counters, cache status, and JSON serialization. Use the existing job log mechanism for human-readable stage summaries and store the structured payload beside job metadata as `generation_metrics.json`.

- [ ] **Step 4: Add metrics to the source and clip paths.**

Record source preparation, transcription, AI planning, scene analysis, seek/preroll, frame processing, encode, audio, validation, upload, decoded frames, output frames, output bytes, and cache hit/miss. Metrics must not alter rendering behavior.

- [ ] **Step 5: Run focused metrics tests and the full Python suite.**

Run:

```powershell
python -m unittest tests.test_video_metrics tests.test_main_generation_pipeline -v
python -m unittest discover -s tests -p 'test_*.py'
python -m py_compile main.py video_analysis.py video_rendering.py video_output_validation.py video_metrics.py
```

Expected: all tests pass and compilation exits with code 0.

- [ ] **Step 6: Commit metrics instrumentation.**

```powershell
git add video_metrics.py tests/test_video_metrics.py main.py
git commit -m "perf: instrument video generation stages"
```

## Task 6: Benchmark, compare quality, and verify deployment readiness

**Files:**
- Create: `tests/fixtures/` only if a small existing fixture is unavailable; do not commit large source videos.
- Create: `docs/superpowers/benchmarks/2026-08-12-video-generation-optimization.md`

- [ ] **Step 1: Run baseline measurements without changing code.**

Use the affected project’s source metadata and a representative 3-clip or 15-clip plan. Record:

- Total wall-clock time.
- CPU time if available.
- Scene-analysis call count.
- Decoded frames.
- Output frames.
- Output bytes.
- Per-stage durations.
- Invalid or missing outputs.

- [ ] **Step 2: Run the optimized pipeline on the same source and clip plan.**

Use identical source, timestamps, AI plan, output policy, and backend resource limits. Record the same metrics. Confirm scene detection and scene strategy each execute once.

- [ ] **Step 3: Validate output media independently.**

For every generated clip, run `ffprobe` and assert:

```powershell
ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height,avg_frame_rate,nb_frames -show_entries format=duration,size -of json <clip>.mp4
```

Confirm H.264 video, expected dimensions, positive frame count, expected duration tolerance, and AAC audio when the source has audio.

- [ ] **Step 4: Compare visual quality on representative cases.**

Review at least one clip from each category: single speaker, multiple people, no detectable face, and late-source timestamp. Confirm crop framing, scene transitions, subtitles/manifests, audio sync, and playback are not worse than the baseline.

- [ ] **Step 5: Record benchmark results and acceptance decision.**

Create `docs/superpowers/benchmarks/2026-08-12-video-generation-optimization.md` with baseline, optimized metrics, quality observations, and any remaining bottleneck. Do not change the encoder preset or add parallelism unless the benchmark demonstrates that the shared-analysis/direct-seek path is correct.

- [ ] **Step 6: Run final verification.**

Run:

```powershell
python -m unittest discover -s tests -p 'test_*.py'
python -m py_compile main.py video_analysis.py video_rendering.py video_output_validation.py video_metrics.py
git diff --check
```

Expected: all tests pass, compilation succeeds, and no whitespace errors are reported.

- [ ] **Step 7: Commit the benchmark evidence.**

```powershell
git add docs/superpowers/benchmarks/2026-08-12-video-generation-optimization.md
git commit -m "docs: benchmark video generation optimization"
```

## Deferred follow-up: bounded parallel rendering and encoder benchmark

Only after Task 6 passes should a separate plan evaluate:

- Two bounded clip workers on the four-CPU backend.
- `slow` or `fast` H.264 preset at the same CRF.
- Hardware encoding if the deployment exposes a supported accelerator.

These changes must be measured separately because they affect CPU contention, output size, and compression efficiency.
