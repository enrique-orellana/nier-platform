# Go Production Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Go control plane safe to switch on as the production API while keeping Python as an internal media/AI worker.

**Architecture:** Add a PostgreSQL-backed job store selected by `DATABASE_URL`, retain the in-memory store for isolated tests, and introduce a bounded runner scheduler that owns job execution and shutdown. Add dependency-aware health checks, remove stale canary messaging, and align deployment configuration and verification tests with the Go runtime.

**Tech Stack:** Go 1.26, `database/sql` with pgx PostgreSQL driver, `net/http`, PostgreSQL migrations, Docker Compose, Kubernetes.

---

### Task 1: Define durable store and scheduler behavior with failing tests

**Files:**
- Modify: `backend-go/internal/jobs/store_test.go`
- Modify: `backend-go/internal/jobs/runner_test.go`
- Modify: `backend-go/internal/httpapi/server_test.go`
- Create: `backend-go/internal/jobs/postgres_test.go`

- [x] Write tests proving job results and logs survive store re-open when `TEST_DATABASE_URL` is supplied, queued jobs can be claimed once, and the scheduler never exceeds `MaxConcurrentJobs`.
- [x] Run the focused Go tests and confirm they fail because the PostgreSQL store and scheduler APIs did not exist.

### Task 2: Implement PostgreSQL persistence

**Files:**
- Create: `backend-go/internal/jobs/postgres.go`
- Modify: `backend-go/internal/jobs/store.go`
- Modify: `backend-go/go.mod`
- Modify: `backend-go/go.sum`
- Modify: `backend-go/internal/config/config.go`
- Modify: `backend-go/internal/config/config_test.go`

- [x] Add `DATABASE_URL` configuration and a PostgreSQL store implementing create, get, transitions, logs, and results using the existing migration schema.
- [x] Add transactional job claiming and migration startup support without changing the existing `Store` contract used by unit tests.
- [x] Run the focused store tests and confirm they pass.

### Task 3: Add bounded execution and restart recovery

**Files:**
- Create: `backend-go/internal/jobs/scheduler.go`
- Create: `backend-go/internal/jobs/scheduler_test.go`
- Modify: `backend-go/internal/jobs/store.go`
- Modify: `backend-go/internal/httpapi/server.go`
- Modify: `backend-go/cmd/api/main.go`

- [x] Add a scheduler with a bounded worker pool, context cancellation, and queued-job recovery on startup.
- [x] Submit `/api/process` jobs to the scheduler instead of creating an unbounded goroutine per request.
- [x] Preserve direct `Runner.RunOnce` behavior for existing tests and requeue in-flight jobs during startup recovery.
- [x] Run all Go job and HTTP tests.

### Task 4: Make health and deployment configuration production-aware

**Files:**
- Modify: `backend-go/internal/httpapi/server.go`
- Modify: `backend-go/internal/httpapi/server_test.go`
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `k8s/openshorts.yaml`
- Modify: `backend-go/README.md`

- [x] Add separate liveness and readiness behavior; readiness reports unavailable when the store, worker boundary, or scheduler is not configured.
- [x] Add PostgreSQL configuration to local Compose and document the required production `DATABASE_URL`.
- [x] Copy `go.sum` during the Docker build and remove stale FastAPI-canary language.
- [x] Remove Kubernetes documentation routes that Go does not serve.

### Task 5: Verify the complete cutover

**Files:**
- Existing coverage: `backend-go/internal/httpapi/server_test.go` and `tests/test_python_worker.py`.

- [x] Keep the existing route coverage for process/status, translations, clips, thumbnails, SaaS Shorts, projects, and renderer proxy behavior, with the new readiness contract covered in `server_test.go`.
- [x] Run focused Go tests, `go vet`, Go build, Python worker tests, Compose validation, and `git diff --check`.
- [x] Run `go test ./...` successfully.

Kubernetes server-side validation remains environment-dependent because this workstation has no configured Kubernetes context; the manifest was updated consistently with the new `/ready` endpoint and `openshorts-postgres` secret contract.
