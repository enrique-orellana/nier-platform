# Go Integration Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the remaining non-ML integrations and media orchestration from Python into the Go backend so Python is retained only for model-heavy worker operations.

**Architecture:** Go owns HTTP, external HTTP clients, MinIO/S3 access, Codex device authentication, filesystem state, and FFmpeg process orchestration. Python remains a JSON-lines worker for Whisper, YOLO, Torch, MediaPipe, thumbnail generation, and SaaS AI generation. The migration is incremental: each Go package gets contract tests before the Python path is removed.

**Tech Stack:** Go 1.26, standard `net/http`, AWS SDK for Go v2, FFmpeg/ffprobe subprocesses, existing JSON-lines worker protocol, Go `httptest`.

---

### Task 1: Add Go integration boundaries

**Files:**
- Create: `backend-go/internal/integrations/s3.go`
- Create: `backend-go/internal/integrations/social.go`
- Create: `backend-go/internal/integrations/codex.go`
- Create: `backend-go/internal/media/ffmpeg.go`
- Test: `backend-go/internal/integrations/s3_test.go`
- Test: `backend-go/internal/integrations/social_test.go`
- Test: `backend-go/internal/media/ffmpeg_test.go`

- [ ] Define interfaces for S3, social upload, Codex auth, and FFmpeg commands.
- [ ] Add failing tests for path validation, multipart field construction, pending Codex state, and FFmpeg argument construction.
- [ ] Implement the smallest standard-library-backed boundaries.
- [ ] Run `go test ./internal/integrations ./internal/media` from `backend-go`.

### Task 2: Move MinIO/S3 source and project operations

**Files:**
- Modify: `backend-go/internal/httpapi/server.go`
- Modify: `backend-go/internal/config/config.go`
- Modify: `backend-go/go.mod`
- Modify: `backend-go/internal/integrations/s3.go`
- Test: `backend-go/internal/httpapi/server_test.go`

- [ ] Add tests for source-object listing, allowlisted bucket validation, and project artifact deletion.
- [ ] Add AWS SDK v2 S3 client configuration from the existing `AWS_*` environment variables.
- [ ] Replace the `legacy_api` MinIO and thumbnail-project branches with Go calls.
- [ ] Keep Python fallback unavailable for these operations so missing credentials fail explicitly.
- [ ] Run Go tests and `go vet ./...`.

### Task 3: Move social publishing and profile lookup

**Files:**
- Modify: `backend-go/internal/integrations/social.go`
- Modify: `backend-go/internal/httpapi/server.go`
- Modify: `backend-go/internal/config/config.go`
- Test: `backend-go/internal/httpapi/server_test.go`

- [ ] Add tests for Upload-Post profile normalization and multipart video publishing fields.
- [ ] Inject an HTTP client and endpoint into the Go server.
- [ ] Move `/api/social/post` from `legacy_api` to Go.
- [ ] Preserve API key, platform, scheduling, title, description, and video path behavior.
- [ ] Run the focused HTTP tests and Go vet.

### Task 4: Move Codex device authentication state

**Files:**
- Modify: `backend-go/internal/integrations/codex.go`
- Modify: `backend-go/internal/httpapi/server.go`
- Modify: `backend-go/internal/config/config.go`
- Test: `backend-go/internal/httpapi/server_test.go`

- [ ] Add tests for pending-login persistence, status, disconnect, and device-poll response mapping.
- [ ] Implement device authorization and token exchange using an injected `http.Client`.
- [ ] Store credentials and pending state in the configured output directory with restrictive file permissions.
- [ ] Move `connect` and `poll` off the Python worker.
- [ ] Run focused tests and vet.

### Task 5: Move FFmpeg orchestration and simple media operations

**Files:**
- Create: `backend-go/internal/media/ffmpeg.go`
- Modify: `backend-go/internal/httpapi/server.go`
- Modify: `backend-go/internal/workers/protocol.go`
- Test: `backend-go/internal/media/ffmpeg_test.go`
- Test: `backend-go/internal/httpapi/server_test.go`

- [ ] Add tests that verify safe input paths, subtitle command arguments, hook command arguments, and output URL generation.
- [ ] Implement FFmpeg/ffprobe execution with `exec.CommandContext` and no shell interpolation.
- [ ] Move subtitle burning, hook rendering, and clip video URL persistence to Go.
- [ ] Keep translation and transcription model calls in Python.
- [ ] Run Go tests, worker tests, and media integration checks.

### Task 6: Remove the Python HTTP services

**Files:**
- Delete: `app.py`
- Delete: `translation_service.py`
- Modify: `requirements.txt`
- Modify: `tests/` Python API tests to target Go HTTP tests or worker tests
- Modify: `README.md`

- [ ] Confirm no production Go code imports either Python HTTP module.
- [ ] Port only still-relevant contract tests to Go or worker protocol tests.
- [ ] Remove FastAPI, Uvicorn, and multipart web-server dependencies.
- [ ] Update documentation and deployment references to the Go binary.
- [ ] Run full Go tests, worker tests, dashboard tests, renderer tests, Compose validation, and `git diff --check`.

### Task 7: Commit the phase

- [ ] Review the complete diff and route inventory.
- [ ] Stage only migration files.
- [ ] Commit with `feat: migrate remaining integrations to go`.
