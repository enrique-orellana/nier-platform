# Large-video Highlights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bound Highlights transcription memory so multi-hour source videos do not OOM-kill the backend API.

**Architecture:** Replace the Highlights-only full-file transcription call with a reusable-model, chunked FFmpeg transcription pipeline. Each chunk is temporary and timestamp-adjusted before being merged into the existing transcript shape; AI ranking and rendering remain unchanged.

**Tech Stack:** Python, Faster-Whisper, FFmpeg, pytest, Go control plane, Docker, Ubuntu MicroK8s.

---

### Task 1: Add failing tests for bounded transcription

**Files:**
- Modify: `tests/test_highlight_generation.py`
- Test: `tests/test_highlight_generation.py`

- [ ] Add tests for a chunk plan that covers a 1,200-second source with 600-second chunks and 10-second overlap.
- [ ] Add a test that injects a fake Whisper model and fake chunk runner, asserts the model is constructed once, timestamps are offset, chunks are cleaned, and progress logs include both chunk counts.
- [ ] Run `pytest tests/test_highlight_generation.py -q` and confirm the new tests fail because the bounded transcription helper does not exist.

### Task 2: Implement the bounded transcription path

**Files:**
- Modify: `highlight_generation.py`
- Modify: `main.py` only if a shared audio utility is required after the tests define the boundary.

- [ ] Add constants for a 600-second chunk and 10-second overlap.
- [ ] Add a pure chunk-planning helper returning non-overlapping source ranges with overlap applied only between adjacent chunks.
- [ ] Add a Highlights-specific transcription helper that constructs one `WhisperModel`, extracts each chunk to a temporary WAV with FFmpeg, transcribes it, offsets segment times, appends bounded segment/text data, and deletes the temporary file in `finally`.
- [ ] Use the helper from `run_highlight_generation` and emit persisted chunk-progress logs.
- [ ] Keep the current short-source transcript shape and AI ranking contract unchanged.

### Task 3: Verify Python behavior and regression coverage

**Files:**
- Modify: `tests/test_highlight_generation.py` only if assertions need tightening.

- [ ] Run `pytest tests/test_highlight_generation.py -q` and confirm all tests pass.
- [ ] Run the complete Python suite and record any unrelated pre-existing failures separately.
- [ ] Run `git diff --check`.

### Task 4: Build and deploy to local MicroK8s

**Files:**
- Modify: no source files unless deployment verification identifies a required image/config change.

- [ ] Build `openshorts-backend:local` with Docker.
- [ ] Import the image with `microk8s images import` into Ubuntu MicroK8s.
- [ ] Restart only `openshorts-backend` and wait for rollout.
- [ ] Confirm backend, frontend, renderer, PostgreSQL, and ingress endpoints are healthy.

### Task 5: Run live verification

**Files:**
- No source changes.

- [ ] Create one Highlights project from the existing short MinIO source using the Codex provider headers.
- [ ] Poll the project until completion and confirm persisted logs include chunk progress and the result reports `method: ai`.
- [ ] Confirm `/api/config` remains HTTP 200 throughout processing.
- [ ] Delete the test project and verify the MinIO source remains present.
- [ ] Run GitNexus `detect_changes` before committing and commit the implementation by category.
