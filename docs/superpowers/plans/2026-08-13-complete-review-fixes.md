# Complete Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the remaining review fixes for asynchronous thumbnail publishing, master-policy subtitle exports, and SEO gallery compatibility.

**Architecture:** The Go HTTP layer will own the publish job lifecycle: it returns a publish ID immediately and runs the Python upload operation in a background goroutine using a detached context. Python persists status under that supplied ID. Subtitle FFmpeg arguments will encode through the repository’s fixed master-export contract, while Go will render the existing gallery metadata as escaped HTML and JSON-LD.

**Tech Stack:** Go 1.26, standard library HTTP/HTML/JSON, FFmpeg, Python JSON-lines worker, pytest.

---

## Task 1: Add failing async publish and subtitle export tests

**Files:**
- Modify: `backend-go/internal/httpapi/server_test.go`
- Modify: `backend-go/internal/media/ffmpeg_test.go`
- Modify: `tests/test_python_worker.py`

- [ ] **Step 1: Write failing tests**

Test that multipart thumbnail publish returns `202` and a publish ID while the worker operation is blocked, and that the payload includes the same ID. Test subtitle args include the master H.264/AAC, color, faststart, and normalized filter arguments. Test Python accepts a caller-supplied publish ID for persisted state.

- [ ] **Step 2: Run focused tests and verify failure**

Run `go test ./internal/httpapi ./internal/media` with a repository-local `GOCACHE`, and `python -m pytest tests/test_python_worker.py -q`. The new assertions must fail against the current synchronous/minimal implementation.

## Task 2: Make thumbnail publishing asynchronous

**Files:**
- Modify: `backend-go/internal/httpapi/server.go`
- Modify: `backend-go/internal/httpapi/server_test.go`
- Modify: `python_worker.py`
- Modify: `tests/test_python_worker.py`

- [ ] **Step 1: Return a publish ID before upload**

Generate a UUID in the Go thumbnail route, add it to the worker payload, launch the operation in a goroutine with `context.Background()`, and return HTTP 202 with `{publish_id,status:"uploading"}`. Keep status polling on the existing worker route.

- [ ] **Step 2: Persist the supplied ID in Python**

Use `payload.publish_id` when present instead of always generating a new UUID. Preserve uploading/done/failed state files and ensure errors update the same ID.

- [ ] **Step 3: Run async publish tests**

Run the focused Go and Python tests and require the immediate response, propagated ID, and persisted status assertions to pass.

## Task 3: Apply the master export policy to subtitles

**Files:**
- Modify: `backend-go/internal/media/ffmpeg.go`
- Modify: `backend-go/internal/media/ffmpeg_test.go`

- [ ] **Step 1: Add the master filter and encoder arguments**

Append `setsar=1,colorspace=all=bt709:iall=bt709:range=tv:irange=tv` to the subtitle filter and encode with libx264 high profile level 4.2, veryslow preset, CRF 14, yuv420p, BT.709 color metadata, AAC 48 kHz stereo 192k, and faststart.

- [ ] **Step 2: Run media tests**

Run `go test ./internal/media` and verify the argument contract passes.

## Task 4: Restore gallery SEO/content parity

**Files:**
- Modify: `backend-go/internal/httpapi/server.go`
- Modify: `backend-go/internal/httpapi/server_test.go`

- [ ] **Step 1: Add failing content assertions**

Assert gallery HTML includes robots metadata, CollectionPage JSON-LD, mode/product metadata, and escaped title content. Assert video HTML includes VideoObject JSON-LD, Open Graph fields, caption, narration, actor, product, language, and cost details.

- [ ] **Step 2: Implement escaped parity rendering**

Render the existing Python page structure from worker metadata, escape all HTML values, generate safe JSON-LD, preserve `/gallery` and `/video/{id}` links, and keep 404 behavior for missing videos.

- [ ] **Step 3: Run HTTP tests**

Run `go test ./internal/httpapi` and require all gallery tests to pass.

## Task 5: Final verification

**Files:**
- No additional files.

- [ ] **Step 1: Run complete explicit verification**

Run the explicit Go package tests with local `GOCACHE`, `go vet`, API build, Python worker/translation tests, Compose validation, and `git diff --check`.
