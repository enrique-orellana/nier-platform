# Clip Render Recovery and CPU Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make deferred clip renders durable across browser and backend restarts, prevent abandoned worker processes and duplicate renders, switch exports to a faster encoder preset, and reduce YOLO invocation frequency.

**Architecture:** PostgreSQL remains the source of truth for clip-render jobs. The scheduler recovers persisted `processing` jobs, while the dashboard rehydrates active child jobs from the parent status response after every mount or reload. Worker cancellation will terminate and await the complete Python/FFmpeg process tree before the job becomes terminal. Export speed and person-detection frequency will be independently configurable so they can be tuned without changing job semantics.

**Tech Stack:** Go scheduler and PostgreSQL job store, Python/OpenCV/FFmpeg rendering pipeline, React/Vite dashboard, Go/Python/ Vitest tests.

---

## Files and responsibilities

Modify:

- `backend-go/internal/workers/protocol.go` — make cancellation wait for the worker process tree to exit.
- `backend-go/internal/workers/process_unix.go` — terminate Unix process groups gracefully, then force-kill if needed.
- `backend-go/internal/workers/process_windows.go` — preserve recursive `taskkill` behavior and expose the same cancellation contract.
- `backend-go/internal/workers/protocol_test.go` — verify descendants do not survive cancellation.
- `backend-go/internal/jobs/scheduler.go` — ensure shutdown waits for running jobs and startup recovery remains authoritative.
- `backend-go/internal/jobs/scheduler_test.go` and `backend-go/internal/jobs/store_test.go` — verify recovery, cancellation, and active-render deduplication.
- `backend-go/internal/jobs/migrations/003_deferred_clip_rendering.sql` — retain and verify the existing active-render unique index; add no second competing constraint.
- `dashboard/src/lib/clipRenderJobs.js` — normalize active child-render records into the dashboard state shape.
- `dashboard/src/lib/clipRenderJobs.test.js` — test active, terminal, and malformed status records.
- `dashboard/src/App.jsx` — hydrate and poll child jobs from server status after reload.
- `dashboard/src/components/ProjectLibrary.jsx` — reconnect project-level clip rendering after mount and tolerate temporary network failures.
- `dashboard/src/components/ProjectLibrary.test.jsx` — verify reload recovery and that browser unmount does not cancel the server job.
- `master-export-policy.json` — change the default H.264 preset from `veryslow` to `fast`.
- `backend-go/internal/media/ffmpeg.go` and `backend-go/internal/media/ffmpeg_test.go` — keep Go-generated exports consistent with the policy.
- `main.py` — gate YOLO fallback detection by elapsed source-video frames and cache the last result.
- `tests/test_video_rendering.py` or a focused new Python test module — test detection scheduling without requiring a real video or model.

---

### Task 1: Make clip rendering durable and eliminate abandoned processes

**Files:**

- Modify: `backend-go/internal/workers/protocol.go`
- Modify: `backend-go/internal/workers/process_unix.go`
- Modify: `backend-go/internal/workers/process_windows.go`
- Modify: `backend-go/internal/jobs/scheduler.go`
- Modify: `backend-go/internal/jobs/scheduler_test.go`
- Modify: `backend-go/internal/workers/protocol_test.go`
- Modify: `dashboard/src/lib/clipRenderJobs.js`
- Create: `dashboard/src/lib/clipRenderJobs.test.js`
- Modify: `dashboard/src/App.jsx`
- Modify: `dashboard/src/components/ProjectLibrary.jsx`
- Modify: `dashboard/src/components/ProjectLibrary.test.jsx`

- [ ] **Step 1: Run GitNexus impact analysis before editing symbols.**

Run impact analysis for `ExecProtocolRunner`, `killWorkerProcess`, `Scheduler.Stop`, `Scheduler.Start`, `ProjectLibrary`, and the App clip-render polling effect. Record direct callers, affected execution flows, and risk. Stop for user review if any result is HIGH or CRITICAL.

- [ ] **Step 2: Write failing backend cancellation tests.**

Extend `TestExecProtocolRunnerCancelsWorkerProcessTree` so it verifies both that `RunProtocol` returns promptly and that the helper grandchild does not write its marker after cancellation. Add a scheduler test with a blocking worker that asserts `Scheduler.Stop` waits for the worker context to finish before returning.

Run:

```powershell
go test ./internal/workers ./internal/jobs
```

Expected: the new shutdown assertion fails against the current implementation if a worker is still alive when `Stop` returns.

- [ ] **Step 3: Implement process-tree cancellation.**

Keep the existing process-group setup, but give both platforms the same behavior: request termination, wait for normal process exit, and use the existing force-kill mechanism after a bounded grace period. In `ExecProtocolRunner`, the context watcher must trigger that operation while stdout is being scanned; the deferred cleanup must always call `Wait` exactly once.

The Unix implementation must signal the negative process-group ID so Python and its inherited FFmpeg children are terminated together. The Windows implementation must continue using `taskkill /T /F` for the complete tree. Cancellation errors must still be returned as `context.Canceled` so `Runner.RunOnce` persists `cancelled` rather than `failed`.

- [ ] **Step 4: Make scheduler shutdown and restart recovery explicit.**

Preserve `Scheduler.Start` behavior that calls `RequeueProcessing` before listing queued jobs. Update `Scheduler.Stop` so it cancels the scheduler, waits for every running `Runner.RunOnce`, and only then returns or reports its context timeout. Do not mark a processing job cancelled merely because the browser disappeared; only an explicit server-side cancellation or worker failure should do that.

Verify the existing migration index:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS jobs_active_clip_render_idx
    ON jobs (parent_job_id, clip_index)
    WHERE kind = 'clip-render' AND status IN ('queued', 'processing');
```

The implementation must continue returning the existing queued/processing job from `CreateClipRenderIfAbsent`; completed, failed, and cancelled jobs may be retried.

- [ ] **Step 5: Add server-status hydration to the dashboard.**

Create a pure helper with this behavior:

```js
export function activeClipRenderJobs(clipRenders = []) {
  return Object.fromEntries(
    clipRenders
      .filter((render) =>
        ["queued", "processing", "rendering"].includes(render?.status),
      )
      .filter((render) => render?.job_id && Number.isInteger(render?.clip_index))
      .map((render) => [String(render.clip_index), render.job_id]),
  );
}
```

On initial project load and on every parent status refresh, merge this map into `clipRenderJobs`. Polling must accept both backend `processing` and UI `rendering` names. A hard reload must therefore reconnect to the persisted child job ID without starting a duplicate job.

- [ ] **Step 6: Do not treat temporary browser/network failures as render failures.**

In `ProjectLibrary.jsx`, an aborted status request or transient non-404 network error must stop that poll attempt and retry later. Only a real terminal child status, a confirmed 404, or the configured overall polling deadline may produce a UI failure. Component unmount must only clear timers and request controllers; it must not call a cancellation endpoint.

- [ ] **Step 7: Test browser reload recovery.**

Add a `ProjectLibrary.test.jsx` case where the parent status returns an active child render after the component mounts. Assert that the child status endpoint is polled and that the clip remains processing after unmount/remount. Add a case where the first status request rejects, then succeeds, and verify the render is not marked failed.

Run:

```powershell
go test ./internal/workers ./internal/jobs
cd dashboard
npm test -- --run src/lib/clipRenderJobs.test.js src/components/ProjectLibrary.test.jsx src/App.test.jsx
```

Expected: all backend process/recovery tests and dashboard hydration tests pass.

- [ ] **Step 8: Commit the durable-job fix.**

```powershell
git add backend-go dashboard/src
git commit -m "fix: recover deferred clip renders after reconnect"
```

Before committing, run GitNexus `detect_changes()` and confirm only the expected job, worker, and dashboard flows changed.

---

### Task 2: Change the export encoder preset to `fast`

**Files:**

- Modify: `master-export-policy.json:8`
- Modify: `backend-go/internal/media/ffmpeg.go:38`
- Modify: `backend-go/internal/media/ffmpeg_test.go`

- [ ] **Step 1: Run GitNexus impact analysis for the export-policy and FFmpeg command symbols.**

Inspect callers of the policy loader and `master_video_encode_args`/the Go FFmpeg argument builder before editing. Confirm that this change affects export encoding only and does not change resolution, frame rate, codec, CRF, audio, or subtitle behavior.

- [ ] **Step 2: Update the expected preset test first.**

Change the FFmpeg argument assertion from:

```go
{"-preset", "veryslow"}
```

to:

```go
{"-preset", "fast"}
```

Run the focused test and confirm it fails until both command builders are updated.

- [ ] **Step 3: Change both export command sources to `fast`.**

Set the JSON policy and Go fallback/default command to `fast`, while keeping `-crf 14`, `libx264`, the existing profile/level, pixel format, audio settings, and `+faststart` unchanged. This prevents one execution path from silently continuing to use `veryslow`.

- [ ] **Step 4: Verify encoder behavior.**

Run:

```powershell
cd backend-go
go test ./internal/media
cd ..
```

Then render the same short clip once before and once after the change. Record elapsed time, peak CPU, output size, and visual quality. Expected result: lower encode time and CPU, similar quality, and potentially a larger file.

- [ ] **Step 5: Commit the export-speed fix.**

```powershell
git add master-export-policy.json backend-go/internal/media
git commit -m "perf: use fast video export preset"
```

Run GitNexus `detect_changes()` before committing.

---

### Task 3: Run YOLO less frequently during frame rendering

**Files:**

- Modify: `main.py:1381-1446`
- Modify: `tests/test_video_rendering.py`

- [ ] **Step 1: Run GitNexus impact analysis for `render_clip_plan`, `detect_person_yolo`, and the standard/streamer tracking branches.**

Confirm that the change is limited to render-time fallback detection and does not alter the separate scene-analysis sampling path.

- [ ] **Step 2: Write failing scheduling tests.**

Extract a small pure helper and test these cases:

```python
def test_person_detection_runs_at_scene_start():
    assert should_run_person_detection(900, 900, -1, 60.0, 1.5)

def test_person_detection_waits_for_interval():
    assert not should_run_person_detection(930, 900, 900, 60.0, 1.5)
    assert should_run_person_detection(991, 900, 900, 60.0, 1.5)
```

The interval is measured in source-video frames: 1.5 seconds at 60 FPS is 90 frames.

- [ ] **Step 3: Add an interval-based YOLO gate.**

Use a configurable interval with a default of 1.5 seconds, for example `OPENSHORTS_YOLO_INTERVAL_SECONDS`, and convert it to source frames:

```python
interval_seconds = max(
    1.0, float(os.environ.get("OPENSHORTS_YOLO_INTERVAL_SECONDS", "1.5"))
)
person_detection_interval_frames = max(1, round(source_fps * interval_seconds))
```

Maintain `last_yolo_frame` and `last_person_box`. Run YOLO when the clip starts, when the scene changes, or when the interval has elapsed. Reuse the cached box between detections and allow the existing tracker/cameraman to smooth movement. Apply the same gate to the streamer-stack YOLO fallback.

Do not gate face detection or scene-analysis detection in this task; those are separate tuning controls. If no person is found, cache `None` and retry at the next interval.

- [ ] **Step 4: Verify tracking and CPU behavior.**

Run:

```powershell
python -m unittest tests.test_video_rendering
```

Render one standard-layout clip and one streamer-layout clip. Confirm that scene changes still trigger immediate detection, camera framing remains acceptable, YOLO calls are approximately once every 1.5 seconds or less, and the output contains the expected number of frames.

- [ ] **Step 5: Commit the YOLO scheduling fix.**

```powershell
git add main.py tests/test_video_rendering.py
git commit -m "perf: reduce YOLO fallback detection frequency"
```

Run GitNexus `detect_changes()` before committing.

---

### Task 4: End-to-end verification

- [ ] **Step 1: Start a clip render and record the parent and child job IDs.**

- [ ] **Step 2: Hard-reload the dashboard.**

Expected: the same child job ID is shown as active; no second queued/processing job is created for the same parent and clip.

- [ ] **Step 3: Close the browser while the render is processing.**

Expected: the backend process continues, the job reaches `completed` or `failed`, and reopening the project displays the terminal result.

- [ ] **Step 4: Restart the backend during a render.**

Expected: the old processing row is requeued once, the old worker tree is gone, and exactly one worker resumes the child job.

- [ ] **Step 5: Verify CPU and artifact safety.**

Expected: no cancelled child job leaves Python or FFmpeg descendants, no duplicate FFmpeg processes write the same temporary output, peak CPU is lower than the original duplicate-render case, and the resulting MP4 is playable.

- [ ] **Step 6: Run the full relevant test suites and inspect GitNexus changes.**

```powershell
cd backend-go
go test ./...
cd ..
cd dashboard
npm test -- --run
cd ..
python -m unittest discover -s tests
```

Run `detect_changes()` with `scope: "compare"` against the default branch before final handoff. Confirm that only the three planned fixes and their tests are included.
