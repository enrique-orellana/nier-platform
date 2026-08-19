# Project Clip Subtitles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable subtitle generation for streamed project clips by transcribing the cached local master for only the selected clip range.

**Architecture:** Keep browser uploads on `/api/local-editor/transcribe`. Add a project-clip endpoint that validates the parent job and cached `source.mp4`, then invokes the existing Python transcription worker with the clip range. The worker extracts only that range to temporary audio chunks and returns timestamps relative to the clip, so the browser never downloads the master.

**Tech Stack:** React/Vite, Go HTTP API, Python worker, FFmpeg, OpenRouter transcription, Vitest, Go tests, pytest.

---

### Task 1: Define failing frontend behavior

**Files:**
- Modify: `dashboard/src/components/local-editor/LocalEditorTab.test.jsx`
- Modify: `dashboard/src/components/editor/FullScreenEditor.test.jsx`

- [ ] Add a test that a streamed project clip enables subtitle generation and sends JSON to `/api/projects/{id}/clips/{index}/transcribe`.
- [ ] Add a test that standalone local uploads still send multipart data to `/api/local-editor/transcribe`.
- [ ] Add a test that `FullScreenEditor` passes the project ID and clip index into `LocalEditorTab`.
- [ ] Run the focused Vitest files and confirm the new tests fail because the project metadata props and JSON request path do not exist.

### Task 2: Define failing backend and worker behavior

**Files:**
- Modify: `backend-go/internal/httpapi/project_handlers_test.go`
- Modify: `backend-go/internal/httpapi/server_test.go`
- Modify: `tests/test_remote_subtitles.py`

- [ ] Add a Go handler test with a cached `source.mp4` and a clip result `{start: 12, end: 20}`; assert the worker receives that cached path plus `start_seconds: 12` and `end_seconds: 20`.
- [ ] Add a Python transcription test asserting a requested range is extracted and returned with timestamps relative to the range.
- [ ] Run the focused Go and Python tests and confirm they fail for the missing route/range support.

### Task 3: Implement range-aware transcription

**Files:**
- Modify: `highlight_generation.py`
- Modify: `subtitles.py`
- Modify: `python_worker.py`

- [ ] Add optional `start_seconds` and `end_seconds` parameters to `transcribe_video_with_config`.
- [ ] Clamp the requested range to the probed source duration, plan chunks over that range, seek FFmpeg from the absolute master offset, and return segment/word timestamps relative to the range start.
- [ ] Pass the optional range through `transcribe_audio` and the `transcribe` worker operation.
- [ ] Run the Python focused tests until green.

### Task 4: Add the cached-master project endpoint

**Files:**
- Modify: `backend-go/internal/httpapi/project_handlers.go`
- Modify: `backend-go/internal/httpapi/server.go`
- Modify: `backend-go/internal/httpapi/project_handlers_test.go`

- [ ] Route `POST /api/projects/{job_id}/clips/{clip_index}/transcribe` through the project router.
- [ ] Resolve the parent job’s cached `source.mp4` under its trusted output directory, validate the requested clip index and range from the stored result, and invoke the existing `transcribe` worker operation with the cached path and range.
- [ ] Return the same `{language, captions, segments}` shape as local uploads and clear errors for missing cache/invalid clip.
- [ ] Run the focused Go tests until green.

### Task 5: Wire the editor and verify

**Files:**
- Modify: `dashboard/src/components/local-editor/LocalEditorTab.jsx`
- Modify: `dashboard/src/components/editor/FullScreenEditor.jsx`

- [ ] Add `initialProjectId` and `initialClipIndex` props.
- [ ] Use the project endpoint for streamed project clips and the existing multipart endpoint for local files.
- [ ] Enable the button when either a local file or valid project clip metadata exists.
- [ ] Run `npm run format`, `npm run format:check`, `npm run lint`, focused tests, full dashboard tests, Go tests, and focused Python tests.
- [ ] Rebuild/restart the backend and frontend containers and verify the project status endpoint and editor route.
- [ ] Run `git diff --check` and GitNexus `detect_changes()` before committing.
