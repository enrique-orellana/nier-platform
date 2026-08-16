# Deferred Per-Clip Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make clip generation return candidate clips as soon as discovery/transcription/AI planning finish, then run face analysis, scene strategy, vertical composition, encoding, validation, and publishing only after the user clicks the button for that individual clip.

**Architecture:** Add an explicit `defer_render` request mode. The parent `clip-generation` job persists the source reference, metadata, transcript, AI clip plan, and `found` status for every clip, then finishes in `clips_ready`. Each render click creates one idempotent `clip-render` child job linked to the parent and clip index. The child worker performs range-limited analysis and rendering, updates the parent clip metadata atomically, and exposes its own status for independent progress/retry. Requests that omit `defer_render` keep the existing automatic all-clips behavior.

**Tech Stack:** Python media pipeline, PySceneDetect/OpenCV, JSON-lines Python worker, Go job store/scheduler/API, PostgreSQL migrations, React/Vite dashboard, Vitest, Go tests, pytest.

---

## Task 1: Add durable parent/child job state to the Go domain and stores

**Files:**
- Modify: `backend-go/internal/domain/job.go`
- Modify: `backend-go/internal/jobs/store.go`
- Modify: `backend-go/internal/jobs/postgres.go`
- Modify: `backend-go/internal/jobs/migrations/001_jobs.sql`
- Add: `backend-go/internal/jobs/migrations/003_deferred_clip_rendering.sql`
- Test: `backend-go/internal/jobs/store_test.go`
- Test: `backend-go/internal/jobs/postgres_test.go`

- [ ] Before editing existing symbols, run GitNexus `impact` upstream for `Job`, `CreateJobInput`, `MemoryStore.Create`, `MemoryStore.Transition`, `PostgresStore.Create`, `PostgresStore.Get`, and `PostgresStore.Transition`; record the direct callers, affected job flows, and risk.
- [ ] Add the `clips_ready` parent status and allow `processing -> clips_ready`; keep existing `completed` transitions unchanged for legacy automatic jobs.
- [ ] Add optional `ParentJobID` and `ClipIndex` fields to `domain.Job` and `domain.CreateJobInput` so child render jobs can be queried without decoding arbitrary metadata.
- [ ] Add the corresponding nullable PostgreSQL columns and indexes, including a uniqueness guard for one active `clip-render` job per `(parent_job_id, clip_index)`; keep migration execution safe for existing installations.
- [ ] Add a store operation for creating or returning the existing active child render job atomically. Implement it in both `MemoryStore` and `PostgresStore`, returning the existing ready/active child where appropriate and permitting a new child after a failed child.
- [ ] Add tests first for: parent status transition to `clips_ready`, child identity persistence, duplicate active render requests returning one job, and failed-child retry creating a new job.
- [ ] Run the focused red tests and confirm they fail for the intended missing behavior before implementation.
- [ ] Implement the minimum domain/store/migration changes, then run `gofmt` and:
      `go test ./internal/jobs ./internal/domain`
- [ ] Confirm the legacy store transition and PostgreSQL migration tests remain green.

## Task 2: Split Python discovery from expensive per-clip rendering

**Files:**
- Modify: `main.py`
- Modify: `video_analysis.py`
- Modify: `python_worker.py`
- Test: `tests/test_main_generation_pipeline.py`
- Test: `tests/test_video_analysis.py`
- Test: `tests/test_python_worker.py`

- [ ] Before editing existing symbols, run GitNexus `impact` upstream for `build_source_analysis_for_job`, `render_clip_plan`, `process_video_to_vertical`, `detect_scenes`, `load_or_build_source_analysis`, `build_clip_generation_command`, `_run_clip_generation`, and `handle_request`; warn before proceeding if any result is HIGH or CRITICAL.
- [ ] Add failing tests proving `--defer-render` performs source preparation, transcription, and AI clip selection but does not call `build_source_analysis_for_job`, `render_clip_plan`, `process_video_to_vertical`, face detection, or vertical encoding.
- [ ] Add failing worker-command tests proving deferred discovery emits `--defer-render` and per-clip rendering emits `--render-clip <index>` while forwarding the same source, output directory, layout, facecam size, and AI headers.
- [ ] Add failing tests proving discovery metadata contains every candidate with `render_status: "found"`, the persisted source reference/output directory, transcript/AI data, layout settings, and no fabricated video URL.
- [ ] Add failing tests proving a selected clip builds a per-clip analysis cache, limits scene/strategy sampling to the clip frame range, renders only that clip, marks it ready, and returns the existing artifact without re-rendering when invoked again.
- [ ] Add `--defer-render` and `--render-clip` CLI modes. Keep the old path untouched when neither flag is present.
- [ ] Move source analysis behind the render-only branch for deferred discovery. Preserve the compatibility source copy and source asset needed by later child jobs; do not delete a deferred source before its clips are rendered.
- [ ] Add an atomic metadata update helper that changes only the requested clip’s render state and artifact fields, preserving transcript, AI plan, source context, and other clips.
- [ ] Add a per-clip render entry point that loads the persisted plan, validates the index, computes a range-limited scene/strategy analysis, invokes the existing shared `process_video_to_vertical` path, writes the manifest/artifact, and marks the clip `ready` or `failed`.
- [ ] Use `clip_<index>_analysis.json` (or the repository’s equivalent safe filename) for per-clip analysis caching, keyed by source fingerprint, clip range, analysis settings, and layout settings. Keep the existing whole-source cache for legacy automatic jobs.
- [ ] Keep Streamer Stack and Standard layout behavior identical at render time; only the timing of the expensive work changes.
- [ ] Run:
      `python -m pytest -q tests/test_python_worker.py tests/test_video_analysis.py tests/test_main_generation_pipeline.py`
- [ ] Verify a deferred fixture produces candidate metadata quickly and a single render fixture changes only its selected clip and writes one artifact.

## Task 3: Route discovery and individual render jobs through the Go worker

**Files:**
- Modify: `backend-go/internal/workers/protocol.go`
- Modify: `backend-go/internal/workers/python.go`
- Modify: `backend-go/internal/jobs/runner.go`
- Modify: `backend-go/internal/httpapi/server.go`
- Add: `backend-go/internal/httpapi/deferred_clip_rendering.go`
- Test: `backend-go/internal/workers/protocol_test.go`
- Test: `backend-go/internal/workers/python_test.go`
- Test: `backend-go/internal/jobs/runner_test.go`
- Test: `backend-go/internal/httpapi/server_test.go`

- [ ] Before editing existing symbols, run GitNexus `impact` upstream for `PythonWorkerAdapter.RunResult`, `PythonAdapter.Run`, `Runner.RunOnce`, `Server.process`, `Server.status`, and the `/api/process` and `/api/status/{id}` route handlers. Use the API-specific impact report for the routes and warn on HIGH/CRITICAL risk.
- [ ] Add failing protocol tests for three cases: legacy automatic `clip_generation`, deferred `clip_generation` carrying `defer_render`, and `clip_render` carrying parent job ID, clip index, source/output metadata, and layout options.
- [ ] Add failing runner tests proving a deferred parent transitions to `clips_ready`, while legacy parents still transition to `completed`; child jobs still transition to `completed`/`failed` independently.
- [ ] Extend the Python adapter request builder to select the operation from the job kind and forward the deferred/render-clip fields without leaking unrelated metadata.
- [ ] Add `defer_render` to `/api/process` input and persist it in job metadata. The default remains false so existing clients retain automatic rendering.
- [ ] Add `POST /api/jobs/{jobID}/clips/{clipIndex}/render`. Validate the parent exists, is a deferred clip-generation job, and the index is valid; create or return the idempotent child job; enqueue it on the existing scheduler; and return the child ID plus current clip state.
- [ ] Extend `GET /api/status/{id}` with parent clip states and child render summaries while preserving `status`, `logs`, `result`, and `error` fields. A parent in `clips_ready` must expose candidates even when none have been rendered.
- [ ] Make the status response derive artifact URLs from persisted metadata only after the child reports success; never report a ready clip before the artifact exists.
- [ ] Add API tests for deferred process creation, discovery-ready status, one child per clip, duplicate-click idempotency, independent failure/retry, invalid indices, and legacy automatic behavior.
- [ ] Run:
      `go test ./internal/workers ./internal/jobs ./internal/httpapi`

## Task 4: Add per-clip controls and independent dashboard polling

**Files:**
- Modify: `dashboard/src/App.jsx`
- Modify: `dashboard/src/components/ResultCard.jsx`
- Add: `dashboard/src/components/ClipRenderControls.jsx`
- Add: `dashboard/src/components/ClipRenderControls.test.jsx`
- Modify: `dashboard/src/App.test.jsx`
- Modify: `dashboard/src/components/MediaInput.jsx`
- Modify: `dashboard/src/components/MediaInput.test.jsx`

- [ ] Before editing existing React functions, run GitNexus `impact` upstream for `App`, `handleProcess`, `pollJob`, the dashboard polling effect, `ResultCard`, and `MediaInput`; review direct consumers and route fetches before changing them.
- [ ] Add failing component tests for the four visible states: Found with `Analyze & Render`, Queued/Analyzing/Rendering with disabled progress feedback, Ready with the existing video/actions, and Failed with `Retry`.
- [ ] Add failing App tests proving generation sends `defer_render: true`, discovery results appear when the parent reaches `clips_ready`, clicking one clip calls only that clip endpoint, and another clip remains `Found`.
- [ ] Add a small `ClipRenderControls` component that owns presentation of state/action labels and calls a supplied render/retry callback; keep the expensive-job state in `App` so polling survives card remounts.
- [ ] Add `clipRenderJobs` state keyed by clip index and an independent polling loop for child job IDs. On child completion, refresh the parent status/result; on failure, keep the failed clip retryable without changing other cards.
- [ ] Update `ResultCard` to render a non-video candidate card when no artifact exists and to show the per-clip control above the existing editing/publishing actions once an artifact is ready.
- [ ] Preserve the existing result-card editing, subtitle, hook, translation, posting, and download behavior for ready clips.
- [ ] Keep session recovery able to restore a discovery-ready parent and in-flight child IDs without making the user regenerate the source analysis.
- [ ] Run:
      `npm test -- --run src/components/ClipRenderControls.test.jsx src/components/MediaInput.test.jsx src/App.test.jsx`
- [ ] Run `npm run build` from `dashboard` and fix any lint/build regressions caused by the new state shape.

## Task 5: Integrate, measure, and harden the staged workflow

**Files:**
- Modify only files already listed above unless a test exposes a necessary boundary.
- Test: `tests/test_main_generation_pipeline.py`
- Test: `backend-go/internal/httpapi/server_test.go`
- Test: `dashboard/src/App.test.jsx`
- Add if needed: a small fixture/helper under the existing test fixture directories, with no video assets committed unless required by current conventions.

- [ ] Add an end-to-end test using a short fixture: parent job reaches `clips_ready` with N candidates, rendering clip 0 creates exactly one artifact, rendering clip 1 does not reuse clip 0’s analysis/artifact, and retrying ready clip 0 is idempotent.
- [ ] Add assertions that discovery metrics exclude `scene_analysis`, face-analysis, vertical frame processing, and encoding time; per-clip metrics include them only for the selected clip.
- [ ] Add a bounded-concurrency test proving multiple selected clips can be queued independently and are limited by the existing scheduler rather than spawning unbounded Python processes.
- [ ] Verify both `standard` and `streamer_stack` candidates retain their requested layout metadata through discovery and render.
- [ ] Run focused tests across all three layers, then run the repository’s normal validation commands available in the current environment. Record any pre-existing full-suite failures instead of masking them.
- [ ] Run GitNexus `detect_changes({scope: "all"})`; confirm only the deferred-render symbols, routes, worker paths, tests, migration, and dashboard components are affected. Resolve unexpected blast radius before commit.
- [ ] Run `git diff --check`, review the complete diff, and stage only this feature’s files. Leave the user’s existing GPU deployment changes (`Dockerfile`, `k8s/openshorts.yaml`, `requirements.txt`, and the ROCm test/plan files) untouched.
- [ ] Commit the feature only after the focused tests, build, and `detect_changes()` report are clean. Do not deploy in this implementation pass; deployment remains a separate explicit step.

## Expected Result

The initial Generate Clips action returns candidate cards as soon as discovery is complete. Each card has its own Analyze & Render button, progress state, retry path, and artifact. Face recognition, scene strategy, vertical composition, encoding, validation, and publishing are paid only for clips the user selects. Existing clients that do not request deferred mode continue to use the current automatic rendering workflow.
