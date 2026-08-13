# Go Migration Review Findings Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the deployment and compatibility regressions found during review of the Go control-plane migration.

**Architecture:** Keep Go as the HTTP owner. Kubernetes will give each container explicit port/output settings. Compatibility-only HTML routes will use the existing worker data contract, while media, storage, and Upload-Post behavior will be corrected in their Go/Python worker boundaries.

**Tech Stack:** Go 1.26, standard library HTTP/FFmpeg command construction, Python JSON-lines worker, Kubernetes YAML, existing Go and pytest suites.

---

## Task 1: Add regression tests for media, storage, and upload contracts

**Files:**
- Modify: `backend-go/internal/media/ffmpeg_test.go`
- Modify: `backend-go/internal/integrations/s3_test.go`
- Modify: `backend-go/internal/integrations/social_test.go`

- [ ] **Step 1: Write failing tests**

Assert subtitle arguments include escaped filter paths and the requested ASS style; assert deleting two listed objects reports count two; assert `media_type=REELS` is present only when Instagram is selected.

- [ ] **Step 2: Run focused tests and verify failure**

Run `go test ./internal/media ./internal/integrations` from `backend-go`. The new assertions must fail against the reviewed implementation.

## Task 2: Fix Kubernetes runtime wiring

**Files:**
- Modify: `k8s/openshorts.yaml:51-52,79-89,159-161`

- [ ] **Step 1: Set explicit container environments**

Remove shared `PORT` and `OUTPUT_DIR` values from the ConfigMap. Add `PORT=8000` and `OUTPUT_DIR=/app/output` to the backend container, and add `PORT=3100` and `OUTPUT_DIR=/output` to the renderer container.

- [ ] **Step 2: Validate manifest structure**

Run `docker compose config --quiet` and inspect the resulting YAML text to confirm the backend and renderer each have their own values.

## Task 3: Restore gallery HTML routes under Go

**Files:**
- Modify: `backend-go/internal/httpapi/server.go`
- Modify: `backend-go/internal/httpapi/server_test.go`

- [ ] **Step 1: Write failing route tests**

Use an injected operation client returning `{"videos":[{"video_id":"v1","title":"Demo","video_url":"/videos/v1.mp4","actor_url":"/videos/v1.png"}]}`. Assert `GET /gallery` returns HTML containing the video link and `GET /video/v1` returns HTML containing the video title. Assert an unknown video returns 404.

- [ ] **Step 2: Run the focused tests and verify failure**

Run `go test ./internal/httpapi -run 'TestGallery|TestVideoPage' -v`. The current mux must return 404 for the new routes.

- [ ] **Step 3: Implement minimal HTML compatibility handlers**

Register `/gallery` and `/video/`. Call the existing `legacy_api` `saas_gallery` worker operation, escape all metadata with `html.EscapeString`, render gallery cards and a detail page, and return 404 when the requested `video_id` is absent.

- [ ] **Step 4: Run the focused tests**

Run the same focused test command and require all new tests to pass.

## Task 4: Restore subtitle style and SRT behavior

**Files:**
- Modify: `backend-go/internal/media/ffmpeg.go`
- Modify: `backend-go/internal/httpapi/server.go`
- Modify: `backend-go/internal/media/ffmpeg_test.go`

- [ ] **Step 1: Implement safe ASS filter construction**

Extend `SubtitleStyle` with font, color, border, background, and opacity fields. Group word cues using the existing 20-character/2-second rules, escape Windows paths for FFmpeg, map top/middle/bottom alignment to ASS values, and pass `force_style` to the subtitles filter.

- [ ] **Step 2: Pass all request style fields**

Populate the expanded style from `/api/subtitle` request fields with the same defaults as the Python implementation.

- [ ] **Step 3: Run media and HTTP tests**

Run `go test ./internal/media ./internal/httpapi` and require the style/path assertions to pass.

## Task 5: Implement thumbnail publishing state

**Files:**
- Modify: `python_worker.py`
- Modify: `tests/test_python_worker.py`

- [ ] **Step 1: Write a failing status regression test**

Create a persisted publish state under a temporary output directory and assert `_legacy_api` returns the stored `done` result for `thumbnail_publish_status`, instead of `unknown`.

- [ ] **Step 2: Run the focused Python test and verify failure**

Run `python -m pytest tests/test_python_worker.py -q`; the new test must fail against the placeholder status implementation.

- [ ] **Step 3: Implement publish and status persistence**

Resolve the session video and `/thumbnails/<session>/<file>` path safely, submit the YouTube multipart request to Upload-Post, persist `uploading`, `done`, or `failed` state in the output directory, and return that state from status requests.

- [ ] **Step 4: Run the focused Python tests**

Run `python -m pytest tests/test_python_worker.py tests/test_translation_worker.py -q` and require all tests to pass.

## Task 6: Fix S3 count and Upload-Post media type

**Files:**
- Modify: `backend-go/internal/integrations/s3.go`
- Modify: `backend-go/internal/integrations/social.go`
- Modify: `backend-go/internal/integrations/s3_test.go`
- Modify: `backend-go/internal/integrations/social_test.go`

- [ ] **Step 1: Implement minimal fixes**

Count successful deleted identifiers with non-quiet delete responses, and emit `media_type=REELS` only when the selected platforms include Instagram.

- [ ] **Step 2: Run focused integration tests**

Run `go test ./internal/integrations` and require all tests to pass.

## Task 7: Remove review hygiene failure and run full verification

**Files:**
- Modify: `docs/superpowers/specs/2026-08-13-go-control-plane-migration-design.md`

- [ ] **Step 1: Remove the trailing blank line**

Make `git diff --check main...HEAD` clean.

- [ ] **Step 2: Run final verification**

Run the explicit Go package tests, `go vet`, `go build ./cmd/api`, Python worker tests, `docker compose config --quiet`, and `git diff --check main...HEAD`. Confirm the working tree contains only intended source/config/test/doc changes.
