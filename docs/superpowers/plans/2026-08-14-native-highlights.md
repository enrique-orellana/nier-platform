# Native Highlights in OpenShorts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the existing 12–20 minute AI Highlights workflow into OpenShorts as a native sidebar tab using OpenShorts’ queue, worker, MinIO, AI-provider, logging, cancellation, and output infrastructure.

**Architecture:** Add a reusable long-form selection/render operation to the existing Python worker, expose it as a typed Go job kind with the existing durable store and scheduler, and add a React Highlights tab that reuses the existing MinIO picker and status API. Remove the mistaken iframe-only integration from `video-automation` without touching unrelated files.

**Tech Stack:** Go 1.26 control plane, PostgreSQL/in-memory job store, Python 3.11 worker, faster-whisper, existing `ai_client.chat_json`, FFmpeg, S3-compatible MinIO, React/Vite/Vitest.

---

### Task 1: Remove the mistaken Clipkeeper integration

**Files:**
- Modify: `D:/workspace/video-automation/.env.example`
- Modify: `D:/workspace/video-automation/compose.yaml`
- Modify: `D:/workspace/video-automation/app/src/config.ts`
- Modify: `D:/workspace/video-automation/app/src/server.ts`
- Modify: `D:/workspace/video-automation/app/public/index.html`
- Modify: `D:/workspace/video-automation/app/public/app.js`
- Modify: `D:/workspace/video-automation/app/public/styles.css`
- Modify: `D:/workspace/video-automation/app/test/tabs-ui.test.ts`
- Delete: `D:/workspace/video-automation/app/test/openshorts-server.test.ts`
- Delete: `D:/workspace/video-automation/docs/superpowers/plans/2026-08-14-openshorts-tab.md`

- [ ] **Step 1: Inspect the current diff and confirm only the prior integration is being removed**

Run `git -C D:\workspace\video-automation diff -- .env.example compose.yaml app/src/config.ts app/src/server.ts app/public/index.html app/public/app.js app/public/styles.css app/test/tabs-ui.test.ts` and inspect `git -C D:\workspace\video-automation status --short`. Preserve any unrelated edits.

- [ ] **Step 2: Remove only the `OPENSHORTS_URL`, `/api/openshorts/config`, iframe tab, CSS, test assertions, test file, and prior plan**

Use `apply_patch` to reverse the exact additions made by the previous iframe implementation. Do not use `git reset`, `git checkout`, or broad file replacement.

- [ ] **Step 3: Re-run the original Clipkeeper tests**

Run `npm test` from `D:\workspace\video-automation\app`. Expected: all pre-existing tests pass and no iframe-specific files remain.

### Task 2: Add reusable long-form highlight selection

**Files:**
- Create: `D:/workspace/openshorts/highlight_selection.py`
- Create: `D:/workspace/openshorts/tests/test_highlight_selection.py`

- [ ] **Step 1: Write failing Python tests for target normalization and selection**

Cover these exact behaviors:

```python
def test_normalize_target_defaults_to_twelve_minimum_and_twenty_ideal():
    target = normalize_target(1800, None, None)
    assert target == {"min_seconds": 720, "ideal_seconds": 1200, "source_duration_seconds": 1800}

def test_normalize_target_caps_ideal_at_source_duration():
    target = normalize_target(900, 12, 20)
    assert target["min_seconds"] == 720
    assert target["ideal_seconds"] == 900

def test_select_segments_prefers_score_and_restores_source_order():
    selection = select_segments(candidates, min_seconds=720, ideal_seconds=1200)
    assert selection["duration_seconds"] >= 720
    assert selection["segments"] == sorted(selection["segments"], key=lambda item: item["start"])
    assert selection["reached_minimum"] is True

def test_select_segments_does_not_fill_minimum_with_weak_candidates():
    selection = select_segments(weak_candidates, min_seconds=720, ideal_seconds=1200)
    assert selection["reached_minimum"] is False
    assert selection["warnings"]
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run `python -m pytest tests/test_highlight_selection.py -q` from `D:\workspace\openshorts`. Expected: import/attribute failures because the module is new.

- [ ] **Step 3: Implement bounded target normalization and quality-aware non-overlapping selection**

Expose `normalize_target(source_duration_seconds, min_minutes, ideal_minutes)` and `select_segments(candidates, min_seconds, ideal_seconds)`. Validate finite positive times, clamp to source duration, reject reversed ranges, merge/ignore overlaps, select highest scoring candidates without crossing the ideal unnecessarily, and return `segments`, `duration_seconds`, `reached_minimum`, and `warnings`.

- [ ] **Step 4: Run the focused tests and verify they pass**

Run `python -m pytest tests/test_highlight_selection.py -q`. Expected: all selection tests pass.

### Task 3: Add the Python highlight-generation worker operation

**Files:**
- Create: `D:/workspace/openshorts/highlight_generation.py`
- Modify: `D:/workspace/openshorts/python_worker.py`
- Modify: `D:/workspace/openshorts/main.py`
- Create: `D:/workspace/openshorts/tests/test_highlight_generation.py`
- Modify: `D:/workspace/openshorts/tests/test_python_worker.py`

- [ ] **Step 1: Write failing tests for the worker operation contract**

Test that a `highlight_generation` request validates `source_path`, `output_dir`, `min_minutes`, and `ideal_minutes`, emits stage logs, returns `output_url`, `manifest_url`, `selected_duration_seconds`, `output_duration_seconds`, provider/model metadata, and preserves cancellation/errors. Add a dispatch assertion in `test_python_worker.py` that the operation is accepted.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run `python -m pytest tests/test_highlight_generation.py tests/test_python_worker.py -q`. Expected: missing operation/module failures.

- [ ] **Step 3: Reuse OpenShorts transcription and AI provider code**

Expose a shared long-form ranking helper in `main.py` that calls the existing `transcribe_video` and `ai_client.chat_json` path. Use a dedicated prompt that requests 15–300 second coherent transcript windows, `start`, `end`, `score`, `reason`, and `text`, with no invented facts. Resolve the model/provider from `load_ai_config()` exactly as the existing Clip Generator does.

- [ ] **Step 4: Implement `highlight_generation.py` using existing media primitives**

Download/stage the selected source path through the existing worker request, probe duration with FFmpeg, transcribe, rank candidates, call `highlight_selection.select_segments`, trim selected windows with FFmpeg, concatenate them, probe the output, and write `manifest.json`. Emit these logs in order: `Staging source video`, `Transcribing source audio`, `Selecting interesting sections`, `Rendering highlight sections`, `Ready to open`.

Write the result as JSON with `output_url: /videos/{job_id}/highlights.mp4`, `manifest_url: /videos/{job_id}/manifest.json`, source metadata, target, transcript, selected segments, durations, method/model/provider, and warnings. Remove partial outputs on any error.

- [ ] **Step 5: Add worker dispatch and cancellation-safe subprocess handling**

Route `operation == "highlight_generation"` to the new function. Use the request context/process termination behavior already provided by `ExecProtocolRunner`; propagate `KeyboardInterrupt`/termination as a failed or cancelled operation without emitting a false completed result.

- [ ] **Step 6: Run the focused Python tests and the existing worker tests**

Run `python -m pytest tests/test_highlight_generation.py tests/test_python_worker.py tests/test_main_generation_pipeline.py -q`. Expected: PASS.

### Task 4: Add shared Go job cancellation and Highlight API routes

**Files:**
- Modify: `D:/workspace/openshorts/backend-go/internal/domain/job.go`
- Modify: `D:/workspace/openshorts/backend-go/internal/jobs/store.go`
- Modify: `D:/workspace/openshorts/backend-go/internal/jobs/postgres.go`
- Modify: `D:/workspace/openshorts/backend-go/internal/jobs/scheduler.go`
- Modify: `D:/workspace/openshorts/backend-go/internal/jobs/runner.go`
- Modify: `D:/workspace/openshorts/backend-go/internal/workers/protocol.go`
- Modify: `D:/workspace/openshorts/backend-go/internal/httpapi/server.go`
- Modify: `D:/workspace/openshorts/backend-go/internal/jobs/*_test.go`
- Modify: `D:/workspace/openshorts/backend-go/internal/httpapi/server_test.go`

- [ ] **Step 1: Write failing Go tests for cancellation and Highlight routes**

Cover `POST /api/highlights` creating a `highlight-generation` job from a valid MinIO object, rejecting missing acknowledgement/invalid targets, enforcing one active Highlight, returning status/log/result through `/api/status/{id}`, and cancelling queued/processing jobs with `DELETE /api/highlights/{id}`.

- [ ] **Step 2: Run focused Go tests and verify they fail**

Run `go test ./internal/jobs ./internal/httpapi` from `D:\workspace\openshorts\backend-go`. Expected: missing route/status/cancel behavior failures.

- [ ] **Step 3: Add a cancelled job status to the shared domain/store**

Add `JobStatusCancelled`, allow queued/processing → cancelled, persist the status in both MemoryStore and PostgresStore, and add a `ListByKind` store method for the Highlights history endpoint.

- [ ] **Step 4: Make scheduler cancellation generic**

Track active job cancel functions by ID, pass a per-job context into `Runner.RunOnce`, cancel queued jobs before claim, and cancel processing jobs through the stored context. Ensure the runner does not transition a cancelled job to completed and keeps the final status visible in the store.

- [ ] **Step 5: Add Highlight request/list/cancel handlers**

Register `/api/highlights` and `/api/highlights/` routes. Validate one MinIO source object, acknowledgement, positive target values, ideal ≥ minimum, and one active Highlight. Create `Kind: "highlight-generation"` jobs with target metadata, submit them to the existing scheduler, list Highlight jobs through the shared store, and return the generic status/result shape. Use the existing output static handler for result URLs.

- [ ] **Step 6: Run focused and full Go tests**

Run `go test ./internal/jobs ./internal/httpapi` followed by `go test ./...` from `D:\workspace\openshorts\backend-go`. Expected: PASS.

### Task 5: Add the native React Highlights tab

**Files:**
- Create: `D:/workspace/openshorts/dashboard/src/components/HighlightsTab.jsx`
- Create: `D:/workspace/openshorts/dashboard/src/components/HighlightsTab.test.jsx`
- Modify: `D:/workspace/openshorts/dashboard/src/App.jsx`
- Modify: `D:/workspace/openshorts/dashboard/src/routing.js`

- [ ] **Step 1: Write failing component tests**

Test that the Highlights tab renders the shared MinIO picker, defaults to 12/20 minute targets, requires the rights acknowledgement, starts one job, polls `/api/status/{id}`, renders live logs/stages, exposes Stop while active, and shows output/manifest links after completion.

- [ ] **Step 2: Run the focused dashboard test and verify it fails**

Run `npm test -- --run dashboard/src/components/HighlightsTab.test.jsx` from `D:\workspace\openshorts`. Expected: module/render failures because the component and route do not exist.

- [ ] **Step 3: Implement the tab using existing dashboard primitives**

Add `highlights: '/highlights'` to routing, add a Highlights sidebar button, and render `HighlightsTab` for that route. Use `MinioObjectPicker`, `getApiUrl`, the existing dark-panel classes, and a two-part layout with source/targets on the left and status/log/result on the right. Poll every two seconds and stop polling on terminal status/unmount.

- [ ] **Step 4: Run focused and full dashboard checks**

Run `npm test -- --run dashboard/src/components/HighlightsTab.test.jsx`, `npm run build`, and `npm test` from `D:\workspace\openshorts`. Expected: PASS.

### Task 6: End-to-end verification and cleanup

**Files:**
- No additional source files expected.

- [ ] **Step 1: Run all Python and Go tests**

Run `python -m pytest -q` from `D:\workspace\openshorts`, then `go test ./...` from `D:\workspace\openshorts\backend-go`, then `npm test` and `npm run build` from `D:\workspace\openshorts\dashboard`.

- [ ] **Step 2: Build the OpenShorts Docker stack**

Run `docker compose build` and `docker compose up -d` from `D:\workspace\openshorts`. Verify `/health`, `/ready`, and the dashboard route respond.

- [ ] **Step 3: Verify the native flow without paid AI calls**

Use mocked/unit-tested worker paths for automated verification. Confirm the running UI lists the shared MinIO bucket, exposes the Highlights tab, and rejects a start with no rights acknowledgement. Do not run a real AI job unless explicitly requested.

- [ ] **Step 4: Inspect both repositories’ final status**

Run `git -C D:\workspace\video-automation status --short` and `git -C D:\workspace\openshorts status --short`. Confirm Clipkeeper has no prior iframe integration files, OpenShorts contains only the planned migration changes, and unrelated user edits remain intact.
