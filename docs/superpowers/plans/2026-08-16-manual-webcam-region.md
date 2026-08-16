# Manual Webcam Region Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user select one webcam rectangle per discovered Streamer Stack clip, persist it, and make face/person analysis operate only on the inverse gameplay area before rendering.

**Architecture:** Keep discovery lightweight and unchanged. Add a normalized per-clip `webcam_region` contract to the persisted clip metadata. The Projects UI edits that contract through a focused PATCH endpoint. Deferred rendering copies the saved region into the child render job and Python uses it for the upper facecam crop while excluding intersecting detections from gameplay tracking. Standard 9:16 clips retain their current behavior and do not require a webcam region.

**Tech Stack:** React, React Testing Library, Vitest, Go `net/http`, the existing job store and metadata sidecar, Python, OpenCV, NumPy, pytest, FFmpeg, GitNexus impact/detect-changes checks.

---

## Contract and invariants

The persisted field is optional during discovery and required only when a Streamer Stack clip is sent to deferred rendering:

```json
{
  "webcam_region": {
    "x": 0.02,
    "y": 0.18,
    "width": 0.23,
    "height": 0.43
  }
}
```

All four values are finite numbers in `[0, 1]`; `width` and `height` are greater than zero; and `x + width <= 1`, `y + height <= 1`. Coordinates are relative to the original source frame, not to the 9:16 output and not to a letterboxed preview.

The UI must show the entire source frame with `object-contain`, translate pointer coordinates through the actual displayed media rectangle, and save normalized coordinates. The saved rectangle is static for the whole clip in this version. The inverse region is the only region eligible for gameplay face/person detection. A candidate whose pixel bounding box intersects the webcam rectangle is ignored, including the fallback person detector.

## Implementation tasks

### 1. Add tested Python webcam-region primitives

- [ ] Before editing any existing symbol, run GitNexus impact analysis for `compose_streamer_stack_frame`, `process_video_to_vertical`, `render_deferred_clip`, `render_clip_plan`, `persist_discovered_clip_plan`, and `_write_clip_manifest`. Record the direct callers and risk level; stop and warn if any result is HIGH or CRITICAL.
- [ ] Add pure helpers in `streamer_layout.py` for validating normalized regions, converting a normalized region to source pixels, cropping that region to a target panel aspect without stretching, and rejecting detection boxes that intersect it. Keep the helpers deterministic and independent of video I/O.
- [ ] Add red tests to `tests/test_streamer_layout.py` covering:
  - valid regions at the edges and rejection of zero/negative dimensions, NaN/infinite values, out-of-bounds coordinates, and non-mapping input;
  - conversion from normalized coordinates to pixel bounds with clamping at the frame edge;
  - a selected region whose aspect differs from the facecam panel being center-cropped inside the selected area;
  - boxes fully outside the webcam region being retained and boxes touching/intersecting the region being rejected;
  - legacy `compose_streamer_stack_frame` calls without a region continuing to produce the expected dimensions.
- [ ] Run `python -m pytest tests/test_streamer_layout.py -q` from the repository root and confirm the new tests fail before implementation and pass after implementation.
- [ ] Refactor only if the helpers remain small and the tests continue to describe the coordinate contract directly.

### 2. Integrate the region into Streamer Stack rendering

- [ ] Update the existing Python symbols after the impact check: `compose_streamer_stack_frame`, `process_video_to_vertical`, `_write_clip_manifest`, `persist_discovered_clip_plan`, `render_deferred_clip`, and `render_clip_plan`.
- [ ] Extend `compose_streamer_stack_frame` with optional `webcam_region` and `gameplay_focus` inputs while preserving the existing `face_focus` compatibility path for callers/tests that do not provide a region. When a region is present, crop the upper panel from that region; crop the lower gameplay panel from `gameplay_focus` or the existing lower-biased fallback.
- [ ] Extend `process_video_to_vertical` with an optional webcam-region argument. For Streamer Stack rendering, normalize it once before opening the frame loop and raise a clear `ValueError` if it is missing or invalid. Leave Standard rendering independent of the field.
- [ ] In the Streamer Stack branch, filter both `detect_face_candidates(frame)` and `detect_person_yolo(frame)` results through the inverse-region helper. Store the selected target as gameplay focus rather than using it to drive the facecam crop. Keep the existing every-other-frame detection cadence and `SpeakerTracker` behavior.
- [ ] Carry `clip.get("webcam_region")` from `render_deferred_clip` into `render_clip_plan`, then into `process_video_to_vertical`. Preserve the saved region on the clip dictionary while changing only render status and output fields during rendering.
- [ ] Add the region to `_write_clip_manifest` under `layers.layout.webcam_region` and to the export policy so a rendered clip manifest describes the exact source selection used. Keep schema version `1` because this is an optional additive field.
- [ ] Keep `persist_discovered_clip_plan` discovery-only: do not run face detection, do not invent a region, and do not block discovery when `layout_format` is `streamer_stack`.
- [ ] Add or update tests in `tests/test_main_generation_pipeline.py` for:
  - deferred Streamer Stack rendering forwarding a saved region;
  - missing Streamer Stack region failing before expensive frame processing;
  - manifest persistence of the region;
  - Standard rendering continuing without a region;
  - a frame containing a webcam-region person plus a gameplay person selecting only the gameplay candidate.
- [ ] Run `python -m pytest tests/test_streamer_layout.py tests/test_main_generation_pipeline.py -q` and inspect the output for warnings or skipped tests.

### 3. Persist the region and propagate it through Go deferred jobs

- [ ] Run GitNexus impact analysis for `clipRenderRoute`, `decorateDeferredClipResult`, the project clip result handler used by `/api/projects/clips/{job_id}`, and the existing clip metadata update helpers before editing them. Warn before proceeding if any impact is HIGH or CRITICAL.
- [ ] Add a PATCH branch for `/api/jobs/{job_id}/clips/{clip_index}/webcam-region` in the deferred clip route handling. Validate the parent is a deferred clip-generation job in `clips-ready` or `completed` state, validate the index, parse the normalized contract, and return `400` for malformed or out-of-bounds values.
- [ ] Persist the validated region in both places used by the application:
  - update the selected clip in the parent job result with `store.SetResult` so the next project-clips response includes it immediately;
  - update the matching `shorts[clip_index]` object in the job metadata sidecar, using an atomic temporary file plus rename in the existing output directory so Python’s deferred worker reads the same value.
- [ ] Return the saved `clip_index` and `webcam_region` in the PATCH response. Do not alter neighboring clips or their render statuses.
- [ ] When the POST render route creates a child job, copy the selected clip’s `webcam_region` into child metadata alongside `layout_format` and `facecam_size`. If the parent clip is Streamer Stack and the region is absent, return `409` with an actionable message before creating a child job.
- [ ] Add Go tests in `backend-go/internal/httpapi/server_test.go` for:
  - valid PATCH response and persistence to both the in-memory result and metadata sidecar;
  - invalid coordinates and missing fields returning `400`;
  - a saved region being copied into child render metadata;
  - Streamer Stack render without a saved region returning `409` and creating no child job;
  - Standard render remaining valid without a region.
- [ ] Run `go test ./internal/httpapi` from `backend-go` and confirm all existing deferred-render tests still pass.

### 4. Build the per-clip selector UI

- [ ] Add `dashboard/src/components/ResultCard/WebcamRegionSelector.jsx` as a focused modal/editor. It receives the source video URL, clip start time, existing normalized region, `onSave`, `onClose`, and saving/error state.
- [ ] Render the source in an `object-contain` media stage with a fixed overlay layer. On metadata load, seek the preview to the clip start when a finite start value exists; this is only a visual aid and never changes the source coordinates.
- [ ] Implement pointer interactions for drawing a new rectangle, moving the existing rectangle, and resizing from its corners/edges. Clamp the rectangle to the source content bounds, use a minimum visible size, and convert the content-space rectangle to normalized coordinates on save.
- [ ] Make the selected rectangle visibly red and shade the inverse detection area so the user can see that detection will ignore the webcam box. Display normalized values in a small readout for troubleshooting without requiring the user to edit numbers.
- [ ] Restore the saved rectangle when reopening the selector. Do not silently save a default rectangle: if no valid rectangle has been drawn, keep Save disabled and explain that the webcam area must be selected.
- [ ] Add `dashboard/src/components/ResultCard/WebcamRegionSelector.test.jsx` covering initial saved-region restoration, object-contain coordinate conversion, save payload normalization, clamping, close-without-save, and the validation-disabled state. Use React Testing Library pointer events or the project’s existing pointer-event test helpers.
- [ ] Run `npm test -- --run src/components/ResultCard/WebcamRegionSelector.test.jsx` from `dashboard` and fix accessibility/test warnings before integration.

### 5. Connect selector, API save, and Analyze & Render gating

- [ ] Run GitNexus impact analysis for `ResultCard`, `ProjectLibrary`, `ClipRenderControls`, and `normalizeClipForResultCard` before editing those existing symbols. Report the blast radius and risk before proceeding.
- [ ] Extend `ResultCard` with local selector-open state and the selector modal. Show the selector action only for `clip.layout_format === "streamer_stack"`; label it `Select Webcam Area` when absent and `Edit Webcam Area` when saved.
- [ ] Extend `ClipRenderControls` so a Streamer Stack clip without a valid region cannot submit `Analyze & Render`. Show the selector action and a concise instruction. Once a region is saved, enable Analyze & Render. Keep queued/analyzing/rendering/ready/failed states unchanged and keep Standard clips ungated.
- [ ] In `ProjectLibrary`, add per-clip saving state and `handleSaveWebcamRegion`. PATCH `/api/jobs/{job_id}/clips/{clip_index}/webcam-region` with `{webcam_region: region}`, update only the matching clip from the response, and surface an inline error while restoring the prior value on failure.
- [ ] Pass the region, save callback, and saving/error state to each `ResultCard`. Preserve it through `normalizeClipForResultCard` and project reloads. Do not use a global selector state: two clips must be independently editable.
- [ ] Update `dashboard/src/components/ProjectLibrary.test.jsx` to verify that a Streamer Stack card initially offers selection and does not queue render, that saving sends the correct PATCH body and then enables Analyze & Render, that each clip keeps its own region, and that Standard clips still queue render directly.
- [ ] Add or update `dashboard/src/components/ClipRenderControls.test.jsx` if that component already has focused tests; otherwise cover its gating through the ProjectLibrary test.
- [ ] Run focused frontend tests:
  `npm test -- --run src/components/ResultCard/WebcamRegionSelector.test.jsx src/components/ProjectLibrary.test.jsx`

### 6. Verify the integrated change

- [ ] Run the complete relevant test suites:
  - `python -m pytest tests/test_streamer_layout.py tests/test_main_generation_pipeline.py tests/test_python_worker.py -q`
  - `go test ./...` from `backend-go`
  - `npm test -- --run --no-file-parallelism` from `dashboard`
  - `npm run build` from `dashboard`
- [ ] Review the diff for accidental changes to discovery behavior, Standard layout behavior, source preview URLs, or unrelated working-tree files. Run `git diff --check`.
- [ ] If the implementation is staged for a later commit, run GitNexus `detect_changes({ repo: "openshorts", scope: "staged" })` and confirm only the expected webcam-region symbols and execution flows changed. Do not commit, push, restart services, or deploy as part of this feature unless the user explicitly requests that next.
- [ ] Report the exact test/build results, the API path, the UI entry point, and any remaining limitations: one static region per clip, no animated webcam box, and no GPU dependency added by this feature.

## Completion criteria

- [ ] A discovered Streamer Stack clip exposes `Select Webcam Area` and keeps `Analyze & Render` disabled until a valid region is saved.
- [ ] Saving one clip’s region does not change any other clip.
- [ ] Refreshing the project restores the saved region.
- [ ] The deferred child job contains the saved region and Python uses it for the upper facecam crop.
- [ ] Face/person candidates intersecting the selected webcam region are excluded from gameplay tracking.
- [ ] A Streamer Stack render without a region fails before expensive processing with a clear message.
- [ ] Standard 9:16 clips remain renderable without a webcam selection.
- [ ] Existing tests and the dashboard production build pass.
