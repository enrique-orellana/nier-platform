# Master-Quality Video Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace chained video encodes in every OpenShorts workflow with a manifest-driven, immutable-source pipeline that performs one validated H.264/MP4 master render.

**Architecture:** Python owns source registration, media probing, crop analysis, manifest persistence, and workflow orchestration. The Node render service validates a manifest-derived render request, renders original assets through Remotion, and atomically publishes a CRF 14 H.264 master after ffprobe validation. The dashboard previews manifest state and requests masters; it never promotes a preview or previous export to source media.

**Tech Stack:** Python 3.11, FastAPI, OpenCV, ffprobe/FFmpeg, pytest/unittest, TypeScript, Zod, Remotion 4, React 18, Vitest.

---

## File Structure

### New Python modules

- `media_probe.py` — canonical ffprobe parsing and immutable media facts.
- `master_policy.py` — deterministic resolution, FPS, color, video, and audio export policy.
- `master-export-policy.json` — single codec/audio policy contract consumed by Python and Node.
- `render_manifest.py` — versioned manifest models, checksum verification, persistence, revision hashing, and stale-master detection.
- `crop_track.py` — serializable crop/general-layout tracks and interpolation helpers.
- `tests/test_media_probe.py` — probe parsing tests.
- `tests/test_master_policy.py` — resolution, FPS, and encoder policy tests.
- `tests/test_render_manifest.py` — manifest validation, checksums, persistence, and revision tests.
- `tests/test_crop_track.py` — crop bounds, hard cuts, and interpolation tests.

### New renderer files

- `render-service/src/master-policy.ts` — renderer-side fixed codec settings and preflight helpers.
- `render-service/src/output-validation.ts` — ffprobe validation and atomic publication.
- `render-service/src/master-policy.test.ts` — Vitest policy tests.
- `render-service/src/output-validation.test.ts` — output-probe validation tests.
- `dashboard/src/remotion/compositions/ManifestVideo.tsx` — composition for trimmed immutable assets, crop tracks, layouts, scenes, and layers.
- `dashboard/src/remotion/compositions/ManifestVideo.test.tsx` — composition transform and source-timing tests.
- `dashboard/src/remotion/lib/manifest.ts` — shared TypeScript/Zod manifest render types.
- `dashboard/src/remotion/lib/manifest.test.ts` — schema and crop interpolation tests.
- `remotion/src/compositions/ManifestVideo.tsx` — server-rendered counterpart of the browser preview composition.
- `remotion/src/lib/manifest.ts` — server-rendered counterpart of the manifest schema and interpolation logic.

### Existing files to modify

- `main.py` — preserve sources, generate crop tracks/manifests, and stop generating encoded vertical clips.
- `app.py` — manifest endpoints, master-export proxy, edit-state persistence, legacy migration, publication gating, and removal of quality re-encode.
- `saasshorts.py` — register generated assets and build a manifest instead of running the final FFmpeg compositor.
- `render-service/src/server.ts` — accept manifest render requests and expose robust status.
- `render-service/src/render-worker.ts` — preflight, fixed master render, validation, and atomic publication.
- `render-service/package.json` — add Vitest test script.
- `dashboard/src/remotion/compositions/ShortVideo.tsx` — become a compatibility wrapper around `ManifestVideo`.
- `dashboard/src/remotion/lib/types.ts` — re-export manifest-backed render types.
- `dashboard/src/components/RemotionPreview.jsx` — preview immutable sources with trim/crop state.
- `dashboard/src/components/ResultCard.jsx` — load/update manifests and request current-revision masters.
- `dashboard/src/components/ResultCard/CardActions.jsx` — remove Improve Quality and make Download/Post ensure a current master.
- `dashboard/src/components/ResultCard/VideoPreview.jsx` — label proxy preview and source limitations.
- `dashboard/src/components/SaaShortsTab.jsx` — consume manifest render status for SaaS output.
- `tests/test_improve_quality.py` — remove obsolete behavior and replace it with endpoint-removal coverage.
- `docker-compose.yml`, `k8s/openshorts.yaml` — renderer probe/temporary-output configuration and source retention settings.

## Task 1: Canonical Media Probe

**Files:**
- Create: `media_probe.py`
- Create: `tests/test_media_probe.py`

- [ ] **Step 1: Write failing probe-parser tests**

```python
# tests/test_media_probe.py
import unittest

from media_probe import parse_probe_payload


class MediaProbeTests(unittest.TestCase):
    def test_parses_rotation_rational_fps_color_and_audio(self):
        payload = {
            "streams": [
                {
                    "index": 0,
                    "codec_type": "video",
                    "codec_name": "h264",
                    "profile": "High",
                    "width": 3840,
                    "height": 2160,
                    "sample_aspect_ratio": "1:1",
                    "r_frame_rate": "60000/1001",
                    "avg_frame_rate": "60000/1001",
                    "pix_fmt": "yuv420p",
                    "color_range": "tv",
                    "color_space": "bt709",
                    "color_transfer": "bt709",
                    "color_primaries": "bt709",
                    "tags": {"rotate": "90"},
                },
                {
                    "index": 1,
                    "codec_type": "audio",
                    "codec_name": "aac",
                    "sample_rate": "48000",
                    "channels": 2,
                    "channel_layout": "stereo",
                },
            ],
            "format": {"duration": "12.512", "size": "1234567"},
        }

        media = parse_probe_payload(payload)

        self.assertEqual((media.display_width, media.display_height), (2160, 3840))
        self.assertAlmostEqual(media.fps, 59.94005994)
        self.assertEqual(media.color_transfer, "bt709")
        self.assertEqual(media.audio.sample_rate, 48000)
        self.assertEqual(media.duration_seconds, 12.512)

    def test_rejects_payload_without_video(self):
        with self.assertRaisesRegex(ValueError, "video stream"):
            parse_probe_payload({"streams": [], "format": {}})

    def test_uses_average_rate_when_nominal_rate_is_invalid(self):
        media = parse_probe_payload({
            "streams": [{
                "codec_type": "video",
                "width": 1080,
                "height": 1920,
                "r_frame_rate": "0/0",
                "avg_frame_rate": "25/1",
            }],
            "format": {"duration": "1"},
        })
        self.assertEqual(media.fps, 25.0)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the tests and confirm the missing-module failure**

Run: `python -m unittest tests.test_media_probe -v`

Expected: `ModuleNotFoundError: No module named 'media_probe'`.

- [ ] **Step 3: Implement canonical probing**

Create frozen dataclasses `AudioProbe` and `MediaProbe`, `_parse_rate()`, `parse_probe_payload()`, and `probe_media(path)`. `probe_media()` must run:

```python
[
    "ffprobe", "-v", "error",
    "-show_streams", "-show_format",
    "-of", "json",
    os.fspath(path),
]
```

It must use `subprocess.run(command, check=True, capture_output=True, text=True)`, parse JSON, apply 90/270-degree rotation to display dimensions, prefer `avg_frame_rate` when valid, fall back to `r_frame_rate`, and reject nonpositive width, height, duration, or FPS. Preserve the exact rational rate string as `fps_fraction`.

- [ ] **Step 4: Run probe tests**

Run: `python -m unittest tests.test_media_probe -v`

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```powershell
git add media_probe.py tests/test_media_probe.py
git commit -m "feat: add canonical media probing"
```

## Task 2: Fixed Master Export Policy

**Files:**
- Create: `master-export-policy.json`
- Create: `master_policy.py`
- Create: `tests/test_master_policy.py`

- [ ] **Step 1: Write failing policy tests**

```python
# tests/test_master_policy.py
import unittest

from master_policy import choose_master_spec
from media_probe import MediaProbe


def video(width, height, fps, transfer="bt709"):
    return MediaProbe(
        path="fixture.mp4",
        width=width,
        height=height,
        display_width=width,
        display_height=height,
        duration_seconds=10.0,
        fps=fps,
        fps_fraction=f"{fps}/1",
        codec="h264",
        profile="High",
        pixel_format="yuv420p",
        color_range="tv",
        color_space="bt709",
        color_transfer=transfer,
        color_primaries="bt709",
        rotation=0,
        size_bytes=1,
        audio=None,
    )


class MasterPolicyTests(unittest.TestCase):
    def test_landscape_crop_is_not_upscaled(self):
        spec = choose_master_spec(video(1920, 1080, 30), strategy="crop")
        self.assertEqual((spec.width, spec.height), (608, 1080))

    def test_native_portrait_4k_is_preserved(self):
        spec = choose_master_spec(video(2160, 3840, 60), strategy="crop")
        self.assertEqual((spec.width, spec.height), (2160, 3840))
        self.assertEqual(spec.fps, 60)

    def test_fps_is_preserved_and_capped(self):
        self.assertEqual(choose_master_spec(video(1080, 1920, 25), "crop").fps, 25)
        self.assertEqual(choose_master_spec(video(1080, 1920, 120), "crop").fps, 60)

    def test_hdr_requests_tone_mapping(self):
        spec = choose_master_spec(video(2160, 3840, 30, "smpte2084"), "crop")
        self.assertTrue(spec.tone_map_to_sdr)

    def test_encoder_contract_is_fixed(self):
        spec = choose_master_spec(video(1080, 1920, 30), "crop")
        self.assertEqual(spec.codec, "h264")
        self.assertEqual(spec.crf, 14)
        self.assertEqual(spec.preset, "veryslow")
        self.assertEqual(spec.pixel_format, "yuv420p")
        self.assertEqual(spec.audio_bitrate, "320k")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the tests and confirm failure**

Run: `python -m unittest tests.test_master_policy -v`

Expected: missing `master_policy`.

- [ ] **Step 3: Add the single shared policy contract**

Create:

```json
{
  "version": 1,
  "container": "mp4",
  "codec": "h264",
  "profile": "high",
  "crf": 14,
  "preset": "veryslow",
  "pixel_format": "yuv420p",
  "max_width": 2160,
  "max_height": 3840,
  "max_fps": 60,
  "audio_codec": "aac",
  "audio_sample_rate": 48000,
  "audio_bitrate": "320k",
  "faststart": true
}
```

Both Python and the render service must load this file. Neither implementation may duplicate these values as independent production constants.

- [ ] **Step 4: Implement the policy**

Create frozen `MasterSpec`, `load_master_policy()`, and `choose_master_spec(media, strategy)`. Load the codec, size cap, FPS cap, and audio settings from `master-export-policy.json`. Use `Fraction(9, 16)`, round dimensions to even integers, and never choose a dimension larger than the usable source crop. For landscape crop, calculate `crop_width = floor(display_height * 9 / 16)` and use the largest even width not exceeding it.

Treat `smpte2084`, `arib-std-b67`, and `hlg` transfers as HDR requiring SDR tone mapping.

- [ ] **Step 5: Run policy tests**

Run: `python -m unittest tests.test_master_policy -v`

Expected: 5 tests pass.

- [ ] **Step 6: Commit**

```powershell
git add master-export-policy.json master_policy.py tests/test_master_policy.py
git commit -m "feat: define mandatory master export policy"
```

## Task 3: Versioned Immutable-Source Manifest

**Files:**
- Create: `render_manifest.py`
- Create: `tests/test_render_manifest.py`

- [ ] **Step 1: Write failing manifest tests**

Test these concrete behaviors:

```python
def test_register_asset_hashes_file_and_stores_relative_path(tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"source-bytes")
    asset = register_asset(source, tmp_path, probe=fixture_probe())
    assert asset["sha256"] == hashlib.sha256(b"source-bytes").hexdigest()
    assert asset["relative_path"] == "source.mp4"


def test_revision_ignores_export_result():
    manifest = fixture_manifest()
    before = calculate_revision(manifest)
    manifest["master"] = {"revision": before, "video_url": "/videos/job/master.mp4"}
    assert calculate_revision(manifest) == before


def test_previous_export_becomes_stale_after_layer_change():
    manifest = fixture_manifest()
    revision = calculate_revision(manifest)
    manifest["master"] = {"revision": revision, "video_url": "/videos/job/master.mp4"}
    assert master_is_current(manifest)
    manifest["layers"]["hook"] = {"text": "New hook"}
    assert not master_is_current(manifest)


def test_verify_assets_rejects_modified_source(tmp_path):
    manifest_path, manifest = write_fixture_manifest(tmp_path)
    (tmp_path / "source.mp4").write_bytes(b"changed")
    with pytest.raises(ValueError, match="checksum"):
        verify_manifest_assets(manifest, tmp_path)
```

- [ ] **Step 2: Run the tests and confirm failure**

Run: `python -m pytest tests/test_render_manifest.py -q`

Expected: missing `render_manifest`.

- [ ] **Step 3: Implement manifest persistence**

Set `MANIFEST_SCHEMA_VERSION = 1` and implement these public functions with the exact signatures: `sha256_file(path: Path, chunk_size: int = 1024 * 1024) -> str`, `register_asset(path: Path, project_dir: Path, probe: MediaProbe) -> dict`, `calculate_revision(manifest: dict) -> str`, `master_is_current(manifest: dict) -> bool`, `verify_manifest_assets(manifest: dict, project_dir: Path) -> None`, `load_manifest(path: Path) -> dict`, and `save_manifest_atomic(path: Path, manifest: dict) -> str`.

`calculate_revision()` must canonicalize JSON with sorted keys after removing `master`, `updated_at`, and transient render status. `save_manifest_atomic()` writes UTF-8 JSON to a sibling `.tmp`, flushes and `os.fsync()`s it, then uses `os.replace()`. Reject absolute asset paths and relative paths escaping the project directory.

The schema must contain `schema_version`, `project_id`, `workflow`, `assets`, `timeline`, `layers`, `export_policy`, and optional `master`.

- [ ] **Step 4: Run manifest tests**

Run: `python -m pytest tests/test_render_manifest.py -q`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add render_manifest.py tests/test_render_manifest.py
git commit -m "feat: add immutable render manifests"
```

## Task 4: Serializable Crop Tracks

**Files:**
- Create: `crop_track.py`
- Create: `tests/test_crop_track.py`
- Modify: `main.py`

- [ ] **Step 1: Write failing crop-track tests**

Cover:

- normalized rectangles remain inside `[0, 1]`;
- a scene boundary selects the new rectangle without interpolation;
- movement within a scene linearly interpolates between keyframes;
- a landscape 1920x1080 tracked rectangle retains a 9:16 shape;
- general-layout entries contain no rasterized frame path.

Use this public interface:

```python
track = CropTrack.from_dict(payload)
rect = track.rectangle_at(1.5)
serialized = track.to_dict()
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `python -m unittest tests.test_crop_track -v`

Expected: missing `crop_track`.

- [ ] **Step 3: Implement crop-track types**

Implement frozen `CropRect`, `CropKeyframe`, `CropScene`, and `CropTrack`. A scene has `start_sec`, `end_sec`, `strategy`, and keyframes. `strategy` is exactly `TRACK` or `GENERAL`. Validate monotonic times, positive rectangles, bounds, and nonoverlapping scenes.

- [ ] **Step 4: Refactor analysis in `main.py`**

Extract the analysis portion of `process_video_to_vertical()` into:

```python
def analyze_crop_track(input_video: str, start_sec: float, end_sec: float) -> dict:
    """Return declarative TRACK/GENERAL scenes against the original source timeline."""
```

Reuse `detect_scenes`, `analyze_scenes_strategy`, `SpeakerTracker`, and `SmoothedCameraman`. Sample tracking coordinates at a maximum interval of 100 ms and at every scene boundary. Convert crop rectangles to normalized source coordinates. Do not call `cv2.resize()` and do not open an FFmpeg encoder in this function.

Retain `process_video_to_vertical()` temporarily for legacy migration only and mark it as such in its docstring.

- [ ] **Step 5: Run crop and existing tests**

Run:

```powershell
python -m unittest tests.test_crop_track -v
python -m pytest tests -q
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```powershell
git add crop_track.py main.py tests/test_crop_track.py
git commit -m "feat: emit declarative crop tracks"
```

## Task 5: Long-Video Workflow Creates Manifests, Not Encoded Clips

**Files:**
- Modify: `main.py`
- Modify: `app.py`
- Create: `tests/test_long_video_manifest.py`

- [ ] **Step 1: Write a failing orchestration test**

Mock transcription, clip selection, crop analysis, and probing. Run the long-video orchestration with one selected clip and assert:

```python
assert manifest["workflow"] == "long_video"
assert manifest["timeline"]["source_asset_id"] == "source"
assert manifest["timeline"]["trim"] == {"start_sec": 12.25, "end_sec": 42.25}
assert manifest["timeline"]["crop_track"]["scenes"]
assert not list(output_dir.glob("temp_*clip*.mp4"))
assert not list(output_dir.glob("*_clip_1.mp4"))
```

Patch `subprocess.run` and fail the test if a command contains `libx264`.

- [ ] **Step 2: Run the test and prove current chained encoding**

Run: `python -m pytest tests/test_long_video_manifest.py -q`

Expected: failure because the current workflow invokes the CRF-18 cut and CRF-23 vertical encoders.

- [ ] **Step 3: Replace clip rendering with manifest creation**

In `main.py`:

- probe and register the original source once;
- keep downloaded originals inside the job directory;
- add `--keep-original` behavior as the default for managed job output;
- for each selected clip, call `analyze_crop_track(input_video, start, end)`;
- write one manifest per clip under `output/<job>/manifests/clip_<index>.json`;
- add `manifest_path`, `source_video_url`, `source_start_sec`, `source_end_sec`, and `preview_only: true` to clip metadata;
- remove the preliminary cut command and call to `process_video_to_vertical()` from the new-project path.

In `app.py`, extend partial and final job result hydration to use manifest-backed clips even when no `<title>_clip_N.mp4` exists. Serve the immutable source from `/videos/<job>/<source filename>`.

- [ ] **Step 4: Run tests**

Run:

```powershell
python -m pytest tests/test_long_video_manifest.py -q
python -m pytest tests -q
```

Expected: all tests pass and the orchestration test observes no H.264 encode.

- [ ] **Step 5: Commit**

```powershell
git add main.py app.py tests/test_long_video_manifest.py
git commit -m "feat: create long-video render manifests"
```

## Task 6: Shared Manifest Types and Remotion Composition

**Files:**
- Create: `dashboard/src/remotion/lib/manifest.ts`
- Create: `dashboard/src/remotion/lib/manifest.test.ts`
- Create: `dashboard/src/remotion/compositions/ManifestVideo.tsx`
- Create: `dashboard/src/remotion/compositions/ManifestVideo.test.tsx`
- Modify: `dashboard/src/remotion/compositions/ShortVideo.tsx`
- Modify: `dashboard/src/remotion/lib/types.ts`
- Create: `remotion/src/lib/manifest.ts`
- Create: `remotion/src/compositions/ManifestVideo.tsx`
- Modify: `remotion/src/compositions/ShortVideo.tsx`
- Modify: `remotion/src/lib/types.ts`
- Modify: `remotion/src/Root.tsx`

- [ ] **Step 1: Write failing schema and interpolation tests**

Define tests proving:

- schema version 1 accepts a long-video manifest;
- an absolute or escaping asset path is rejected;
- crop interpolation uses a hard cut between scenes;
- a source trim at 12.25 seconds maps composition frame zero to the correct source time;
- general layout yields a blurred cover background and contained foreground;
- a scene asset is selected at the correct SaaS timeline time.

- [ ] **Step 2: Run dashboard tests**

Run: `npm test -- --run src/remotion/lib/manifest.test.ts src/remotion/compositions/ManifestVideo.test.tsx`

Working directory: `dashboard`

Expected: missing modules/components.

- [ ] **Step 3: Add shared Zod types**

Create `renderManifestSchema` with schema version literal `1`, assets, timeline variants for `long_video` and `saas`, crop scenes, layer schemas, and an export spec supplied by the backend. Export inferred TypeScript types and:

```typescript
export const cropRectAt = (
  scenes: CropScene[],
  sourceTimeSec: number,
): CropRect => { /* validated interpolation */ };
```

The function must return the first keyframe of a new scene at its start time and interpolate only between keyframes belonging to the same scene.

Implement the same schema and pure interpolation module in `remotion/src/lib/manifest.ts`, which is the renderer bundle's isolated source tree. Add a dashboard test that reads both source files and asserts their exported schema version and crop interpolation fixtures return identical results. This prevents browser preview and server render behavior from drifting while preserving the repository's existing separate dashboard/remotion build contexts.

- [ ] **Step 4: Implement `ManifestVideo`**

Use `useCurrentFrame()` and `useVideoConfig()` to calculate composition time and source time. For tracked scenes, render the immutable `<Video>` with absolute positioning and a transform derived from the normalized crop rectangle. For general scenes, render:

1. a cover layer with blur and slight scale to avoid blurred edges;
2. a contained foreground layer preserving the full source.

Use `startFrom`/`endAt` or the Remotion media equivalent calculated from probed source FPS. Apply `VideoEffects`, `Subtitles`, and `HookOverlay` outside the source-framing layer. Implement SaaS scene selection with `<Sequence>` and use the timeline's original audio/mix instructions rather than chaining exported MP4s.

Mirror this composition in `remotion/src/compositions/ManifestVideo.tsx` using the renderer tree's existing effect, subtitle, and hook components. The fixture tests must assert identical transform values from both implementations.

- [ ] **Step 5: Make `ShortVideo` a compatibility wrapper**

Legacy props are converted in memory to a one-asset manifest and passed to `ManifestVideo`. New calls use `ManifestVideo` directly. Register a `MasterVideo` composition in `remotion/src/Root.tsx` with dimensions, FPS, and duration supplied by backend-selected composition metadata.

- [ ] **Step 6: Run dashboard tests and build**

Run:

```powershell
npm test -- --run
npm run build
```

Working directory: `dashboard`

Expected: tests and Vite build pass.

- [ ] **Step 7: Commit**

```powershell
git add dashboard/src/remotion remotion/src
git commit -m "feat: render video manifests in Remotion"
```

## Task 7: Renderer Preflight, Master Encode, and Atomic Validation

**Files:**
- Create: `render-service/src/master-policy.ts`
- Create: `render-service/src/master-policy.test.ts`
- Create: `render-service/src/output-validation.ts`
- Create: `render-service/src/output-validation.test.ts`
- Modify: `render-service/src/server.ts`
- Modify: `render-service/src/render-worker.ts`
- Modify: `render-service/package.json`
- Modify: `render-service/package-lock.json`

- [ ] **Step 1: Add Vitest and failing renderer tests**

Add:

```json
"test": "vitest run"
```

and `vitest` as a development dependency.

Test that `buildRenderOptions()` reads `master-export-policy.json` and produces:

```typescript
{
  codec: "h264",
  crf: 14,
  x264Preset: "veryslow",
  pixelFormat: "yuv420p",
  audioCodec: "aac",
  audioBitrate: "320k",
}
```

Test output validation rejection for wrong codec, dimensions, FPS, pixel format, duration tolerance greater than one frame, missing audio when required, and HDR transfer metadata remaining in an SDR output.

- [ ] **Step 2: Run renderer tests and confirm failure**

Run: `npm test`

Working directory: `render-service`

Expected: missing policy/validation modules.

- [ ] **Step 3: Implement renderer policy and validation**

`master-policy.ts` loads and validates the repository-root `master-export-policy.json`, exports a frozen policy, and exports `buildRenderOptions()`. `output-validation.ts` runs ffprobe with `spawn()` argument arrays, parses JSON, and compares output to the request's backend-selected spec.

Validation tolerances:

- dimensions: exact;
- FPS: within `0.001`;
- duration: within one output frame plus 10 ms;
- audio duration: within 50 ms of video;
- required codec/pixel format: exact;
- SDR transfer: `bt709`.

Before starting, preflight estimates temporary storage as `width * height * 4 * duration_seconds * min(fps, 30) * 0.02`, adds the combined source size, applies a 2x safety factor, and compares it with free space in `MASTER_RENDER_TEMP_DIR`. It rejects the render before creating output when the estimate exceeds free space.

- [ ] **Step 4: Change the render API contract**

Replace browser-authored `props.width`, `props.height`, and `props.fps` with:

```typescript
{
  jobId: string;
  clipIndex: number;
  manifestPath: string;
  manifestRevision: string;
}
```

The server resolves `manifestPath` only beneath `/output/<jobId>/manifests`, reads and validates it, verifies the requested revision, and constructs renderer props from the manifest and its backend-calculated export spec.

Add `DELETE /render/:renderId`. Each job owns an `AbortController`; deletion marks the job `cancelled`, aborts `renderMedia`, removes its temporary output, and preserves any previously published master.

- [ ] **Step 5: Render to a temporary file and publish atomically**

In `render-worker.ts`:

- render composition ID `MasterVideo`;
- pass the fixed master policy;
- write `<name>.<renderId>.tmp.mp4`;
- for HDR sources, create a temporary lossless FFV1/BT.709 tone-mapped source with FFmpeg `zscale` and `tonemap` before composition, then delete it after the final render;
- validate the temporary file;
- rename it to `master_clip_<index>_<revision-prefix>.mp4`;
- update job status with `outputUrl`, `manifestRevision`, validation summary, and source limitations;
- delete the temporary file on cancellation or error.

Never delete or overwrite a prior valid master on failure.

- [ ] **Step 6: Run renderer tests and TypeScript build**

Run:

```powershell
npm test
npm run build
```

Working directory: `render-service`

Expected: tests and TypeScript build pass.

- [ ] **Step 7: Commit**

```powershell
git add render-service
git commit -m "feat: validate and publish master renders"
```

## Task 8: FastAPI Manifest and Master Endpoints

**Files:**
- Modify: `app.py`
- Create: `tests/test_manifest_api.py`

- [ ] **Step 1: Write failing API tests**

Test:

- `GET /api/clip/{job}/{index}/manifest` returns the persisted manifest and revision;
- `PATCH` accepts only `layers` changes and saves atomically;
- patching a layer makes the previous master stale;
- `POST /api/clip/{job}/{index}/master` forwards only manifest path/revision to the renderer;
- path traversal and job/manifest mismatches return 400;
- a completed renderer response persists master metadata only for the same revision;
- the old `/quality` endpoint returns 404.

- [ ] **Step 2: Run API tests**

Run: `python -m pytest tests/test_manifest_api.py -q`

Expected: endpoint failures.

- [ ] **Step 3: Add safe manifest resolution**

Implement:

```python
def _clip_manifest_path(job_id: str, clip_index: int) -> Path:
    job_dir = Path(OUTPUT_DIR, job_id).resolve()
    path = (job_dir / "manifests" / f"clip_{clip_index}.json").resolve()
    if job_dir not in path.parents:
        raise HTTPException(status_code=400, detail="Invalid manifest path")
    return path
```

Add GET/PATCH/master-start/master-status endpoints. Before forwarding a render, call `verify_manifest_assets()` and re-probe the sources. Calculate the export spec server-side and persist it into a revisioned render snapshot without accepting codec, resolution, or FPS from the browser.

- [ ] **Step 4: Remove false quality improvement**

Delete `_build_quality_ffmpeg_command`, `_reencode_clip_for_quality`, `ImproveClipQualityRequest`, and `/api/clip/{job_id}/{clip_index}/quality`. Replace `tests/test_improve_quality.py` with a test asserting that no quality endpoint is registered.

- [ ] **Step 5: Run backend tests**

Run: `python -m pytest tests -q`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```powershell
git add app.py tests/test_manifest_api.py tests/test_improve_quality.py
git commit -m "feat: expose manifest-backed master exports"
```

## Task 9: Dashboard Uses Manifests and Removes Chained Renders

**Files:**
- Modify: `dashboard/src/components/RemotionPreview.jsx`
- Modify: `dashboard/src/components/ResultCard.jsx`
- Modify: `dashboard/src/components/ResultCard/CardActions.jsx`
- Modify: `dashboard/src/components/ResultCard/VideoPreview.jsx`
- Create: `dashboard/src/components/ResultCard.test.jsx`

- [ ] **Step 1: Write failing ResultCard tests**

Test that:

- opening a result fetches its manifest;
- subtitle/hook/effect changes PATCH layers rather than submitting a video URL as a source;
- no request is sent to `/quality`;
- Download requests a master when none exists or revision is stale;
- Download reuses a current master;
- Post is disabled or waits while the current master renders;
- preview shows `Source-limited: 608x1080` when reported;
- preview shows `Proxy preview — export uses original source`.

- [ ] **Step 2: Run tests and confirm current behavior fails**

Run: `npm test -- --run src/components/ResultCard.test.jsx`

Working directory: `dashboard`

- [ ] **Step 3: Replace local chained-video state**

In `ResultCard.jsx`, replace `persistedVideoUrl` as an editing source with:

```javascript
const [manifest, setManifest] = useState(null);
const [manifestRevision, setManifestRevision] = useState('');
const [master, setMaster] = useState(null);
```

Add `patchLayers(nextLayers)` and `ensureCurrentMaster()`. All Remotion-compatible edit handlers PATCH the manifest. Legacy FFmpeg edit fallbacks are not used for new manifests. Translation registers the returned immutable audio asset and patches audio instructions.

- [ ] **Step 4: Make preview manifest-driven**

Pass `manifest`, composition width/FPS, and proxy asset URLs to `RemotionPreview`. Do not set the last master as `videoUrl` for subsequent edits. Render source limitations and proxy labeling in `VideoPreview`.

- [ ] **Step 5: Remove Improve Quality UI**

Remove the button, handler, state, props, and `Sparkles` import associated with Improve Quality. Change Download and Post to call `ensureCurrentMaster()` and use the validated returned URL.

- [ ] **Step 6: Run dashboard verification**

Run:

```powershell
npm test -- --run
npm run lint
npm run build
```

Working directory: `dashboard`

Expected: tests, lint, and build pass.

- [ ] **Step 7: Commit**

```powershell
git add dashboard/src/components
git commit -m "feat: edit and export from immutable manifests"
```

## Task 10: Move All Editing Operations to Manifest State

**Files:**
- Modify: `app.py`
- Modify: `editor.py`
- Modify: `subtitles.py`
- Modify: `hooks.py`
- Modify: `translate.py`
- Create: `tests/test_manifest_edits.py`

- [ ] **Step 1: Write failing edit-lineage tests**

For effects, subtitles, hooks, and translations, assert:

- the endpoint resolves the immutable asset ID;
- it updates only the relevant manifest section;
- it does not call FFmpeg to encode video;
- three sequential edits keep the same source checksum;
- the prior master becomes stale after each edit;
- translation creates a new audio asset but no replacement video.

- [ ] **Step 2: Run the lineage tests**

Run: `python -m pytest tests/test_manifest_edits.py -q`

Expected: failures showing legacy encode calls.

- [ ] **Step 3: Split analysis from rasterization**

Keep model calls and subtitle/caption generation, but return declarative layer JSON:

- `editor.py` returns `EffectsConfig`;
- `subtitles.py` returns word-caption timing and style;
- `hooks.py` returns hook text/style/timing;
- translation returns a registered immutable audio asset plus timing metadata.

FastAPI endpoints persist those results into the manifest. Legacy rasterizing functions remain callable only for legacy projects without a manifest and must never update a new manifest's source asset.

- [ ] **Step 4: Run backend tests**

Run: `python -m pytest tests -q`

Expected: all tests pass and no manifest edit invokes an H.264 encoder.

- [ ] **Step 5: Commit**

```powershell
git add app.py editor.py subtitles.py hooks.py translate.py tests/test_manifest_edits.py
git commit -m "feat: persist video edits as manifest layers"
```

## Task 11: Migrate SaaS Shorts to the Shared Exporter

**Files:**
- Modify: `saasshorts.py`
- Modify: `app.py`
- Modify: `dashboard/src/components/SaaShortsTab.jsx`
- Create: `tests/test_saasshorts_manifest.py`
- Create: `dashboard/src/components/SaaShortsTab.test.jsx`

- [ ] **Step 1: Write failing SaaS pipeline tests**

Mock external image/video/voice providers and assert:

```python
assert result["manifest_path"].endswith("manifest.json")
assert result["master_required"] is True
assert manifest["workflow"] == "saas"
assert {asset["role"] for asset in manifest["assets"].values()} >= {
    "talking_head", "voice"
}
assert not final_path.exists()
```

Patch `subprocess.run` and fail if `generate_full_video()` invokes the old `composite_video()` H.264 command.

- [ ] **Step 2: Run tests and prove current final compositor is used**

Run: `python -m pytest tests/test_saasshorts_manifest.py -q`

Expected: failure because `composite_video()` writes CRF-22 output.

- [ ] **Step 3: Build SaaS manifests**

After provider assets are generated:

- probe and register talking head, b-roll, voice, music, and image assets;
- convert subtitle timing into the shared layer schema;
- represent b-roll replacement ranges as timeline scenes;
- store voice/music mix instructions;
- choose output resolution from the primary visual without upscaling;
- write `output/saas_<job>/manifests/manifest.json`;
- return manifest metadata instead of claiming generation is complete.

Keep `composite_video()` only for legacy retry compatibility and do not call it for new jobs.

- [ ] **Step 4: Route SaaS generation through the master renderer**

In `app.py`, start a master render after manifest creation, mirror renderer progress into `saas_jobs`, and mark the SaaS job complete only after validated publication. Store the manifest revision and master URL in the gallery metadata.

- [ ] **Step 5: Update SaaS dashboard status**

Show separate `Generating assets`, `Rendering master`, and `Validating master` phases. The final Download/Post controls appear only for a validated current master.

- [ ] **Step 6: Run SaaS and full test suites**

Run:

```powershell
python -m pytest tests -q
Set-Location dashboard
npm test -- --run
npm run build
```

Expected: all tests and build pass.

- [ ] **Step 7: Commit**

```powershell
git add saasshorts.py app.py tests/test_saasshorts_manifest.py dashboard/src/components/SaaShortsTab.jsx dashboard/src/components/SaaShortsTab.test.jsx
git commit -m "feat: render SaaS Shorts from immutable assets"
```

## Task 12: Legacy Migration, Retention, and Publication Gating

**Files:**
- Modify: `app.py`
- Modify: `s3_uploader.py`
- Modify: `dashboard/src/components/ProjectLibrary.jsx`
- Create: `tests/test_legacy_manifest_migration.py`
- Create: `tests/test_source_retention.py`

- [ ] **Step 1: Write failing migration and retention tests**

Cover:

- existing original source produces a normal manifest;
- only processed clip produces `source_quality: "legacy_processed"`;
- legacy projects never claim recovered resolution;
- cleanup removes temporary renders but retains assets referenced by a live manifest;
- S3 upload includes source assets and manifests;
- publish rejects a stale or unvalidated master with HTTP 409.

- [ ] **Step 2: Implement lazy migration**

When loading a project without a manifest:

1. locate original upload/download using persisted metadata and safe filename matching;
2. register it when available;
3. otherwise register the best processed clip with `source_quality: "legacy_processed"`;
4. convert known trims and layers;
5. save a version-1 manifest;
6. expose a source-quality warning in project API responses.

- [ ] **Step 3: Make retention reference-aware**

Before cleanup, collect all asset relative paths referenced by live manifests. Delete only unreferenced temporary files and expired projects. S3 artifact upload/download must include manifest JSON and its immutable assets. Never delete a project source merely because a master exists.

- [ ] **Step 4: Gate social publication**

All publishing endpoints call `master_is_current()` and require post-render validation metadata. Return HTTP 409 with `Current master required` when the manifest changed or render validation is absent.

- [ ] **Step 5: Display legacy limitations**

`ProjectLibrary.jsx` and result cards show `Legacy processed source — original detail unavailable` and offer a rerender only when the source asset exists.

- [ ] **Step 6: Run tests**

Run:

```powershell
python -m pytest tests/test_legacy_manifest_migration.py tests/test_source_retention.py -q
python -m pytest tests -q
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```powershell
git add app.py s3_uploader.py dashboard/src/components/ProjectLibrary.jsx tests/test_legacy_manifest_migration.py tests/test_source_retention.py
git commit -m "feat: migrate and retain immutable project sources"
```

## Task 13: Deployment Configuration and End-to-End Quality Gate

**Files:**
- Modify: `docker-compose.yml`
- Modify: `k8s/openshorts.yaml`
- Modify: `render-service/Dockerfile`
- Create: `tests/fixtures/media/README.md`
- Create: `tests/test_master_pipeline_integration.py`
- Modify: `CHANGELOG_FROM_ORIGINAL.md`

- [ ] **Step 1: Add deterministic fixture instructions**

Document commands that generate small local fixtures with FFmpeg's `testsrc2` and `sine` filters for:

- 1920x1080 at 24 fps;
- 1080x1920 at 25 fps;
- 2160x3840 at 60 fps;
- variable-frame-rate input;
- rotated input;
- silent input;
- HDR-tagged input;
- mixed-resolution SaaS scenes.

Generated binary fixtures remain ignored; tests generate them in a temporary directory.

- [ ] **Step 2: Write the end-to-end integration test**

The test creates a source, a manifest with crop/layers, runs the renderer when `RUN_VIDEO_INTEGRATION=1`, and asserts with ffprobe:

- MP4/H.264 High/yuv420p;
- honest output dimensions;
- preserved FPS;
- AAC 48 kHz;
- duration within one frame;
- SDR color after HDR input;
- validated master metadata;
- no intermediate H.264 files.

Add an edit-lineage scenario: export, change a hook, export again, and compare logs/checksums to prove both renders read the same immutable source.

- [ ] **Step 3: Add objective quality checks**

For the 1080p landscape fixture, create a direct reference crop and compare the master with FFmpeg `libvmaf` and `ssim`. Establish initial thresholds of VMAF >= 95 and SSIM >= 0.98. If the installed FFmpeg lacks libvmaf, skip VMAF with an explicit test skip but still require SSIM.

- [ ] **Step 4: Configure runtime**

Ensure the renderer image includes ffprobe and FFmpeg. Add:

```text
MASTER_RENDER_TEMP_DIR=/output/.render-tmp
MASTER_SOURCE_RETENTION_SECONDS=2592000
```

to Docker Compose and Kubernetes configuration. Mount the shared output volume read/write in the renderer and backend. Keep the dashboard unable to write source or master files directly.

Add `COPY master-export-policy.json /app/master-export-policy.json` to `render-service/Dockerfile` so the container loads the same policy contract used by Python.

- [ ] **Step 5: Run complete verification**

Run:

```powershell
python -m pytest tests -q
Set-Location dashboard
npm test -- --run
npm run lint
npm run build
Set-Location ..\render-service
npm test
npm run build
Set-Location ..
$env:RUN_VIDEO_INTEGRATION='1'
python -m pytest tests/test_master_pipeline_integration.py -v
Remove-Item Env:RUN_VIDEO_INTEGRATION
git diff --check
```

Expected: all unit, integration, lint, and build checks pass; `git diff --check` is silent.

- [ ] **Step 6: Update changelog**

Document immutable sources, honest adaptive resolution, FPS preservation, one master encode, mandatory H.264 settings, HDR-to-SDR behavior, removed Improve Quality action, legacy limitations, and increased render-time/storage expectations.

- [ ] **Step 7: Commit**

```powershell
git add docker-compose.yml k8s/openshorts.yaml render-service/Dockerfile tests/fixtures/media/README.md tests/test_master_pipeline_integration.py CHANGELOG_FROM_ORIGINAL.md
git commit -m "test: verify master video quality end to end"
```

## Final Verification

- [ ] Confirm the working tree contains only intended changes:

Run: `git status --short`

- [ ] Inspect the commit sequence:

Run: `git log --oneline -15`

- [ ] Verify no production video path retains forced low-quality settings:

Run:

```powershell
rg -n --glob '!docs/**' --glob '!tests/**' --glob '!node_modules/**' 'crf.?[=:, ]+(18|22|23)|preset.?[=:, ]+(fast|medium)|fps.?[=:, ]+30|1080.?[x:, ]+1920|Improve Quality|/quality' .
```

Expected: no active new-project export path matches. Any legacy-only match must be guarded by an explicit legacy-source condition and documented.

- [ ] Run all verification commands from Task 13 once more and record the results in the final handoff.
