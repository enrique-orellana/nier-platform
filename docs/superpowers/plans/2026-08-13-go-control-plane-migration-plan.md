# Go Control Plane Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Go control plane that can gradually replace the FastAPI orchestration layer while preserving the existing OpenShorts API and keeping Python media/ML and TypeScript rendering intact.

**Architecture:** The new service lives under `backend-go/`. HTTP handlers depend on domain services and interfaces, not Python processes or S3 clients directly. The first slice provides health/config and job contracts with an in-memory repository for deterministic tests; subsequent slices add PostgreSQL, Python worker execution, and route migration behind the same interfaces.

**Tech Stack:** Go 1.26, standard library HTTP server, `testing`, PostgreSQL-compatible repository in a later slice, existing Python/FFmpeg workers, existing React and Remotion services.

---

## File map

- Create `backend-go/go.mod`: Go module definition.
- Create `backend-go/cmd/api/main.go`: production entry point and signal-aware server startup.
- Create `backend-go/internal/config/config.go`: environment parsing with safe defaults.
- Create `backend-go/internal/domain/job.go`: job states, job record, and request contracts.
- Create `backend-go/internal/jobs/store.go`: repository interface and in-memory implementation for the first slice.
- Create `backend-go/internal/httpapi/server.go`: route registration and JSON/error helpers.
- Create `backend-go/internal/httpapi/server_test.go`: HTTP contract tests.
- Create `backend-go/internal/jobs/store_test.go`: repository state-transition tests.
- Modify `docs/superpowers/plans/2026-08-13-go-control-plane-migration-plan.md`: check off completed tasks as implementation progresses.

## Task 1: Go module and health/config service

**Files:**
- Create: `backend-go/go.mod`
- Create: `backend-go/internal/config/config.go`
- Create: `backend-go/internal/httpapi/server.go`
- Create: `backend-go/internal/httpapi/server_test.go`
- Create: `backend-go/cmd/api/main.go`

- [x] **Step 1: Write failing health and config tests**

Add tests that construct the server without external services, request `/health`, and verify `{"status":"ok"}`. Add a second test setting `PORT=8123`, `MAX_CONCURRENT_JOBS=7`, and `RENDER_SERVICE_URL=http://renderer:3100`, then assert `/api/config` returns those values.

- [x] **Step 2: Run the focused Go tests and verify the expected missing-package failure**

Run: `cd backend-go; go test ./internal/httpapi`

Expected: FAIL because the module and server package do not yet exist.

- [x] **Step 3: Implement the minimum typed configuration and HTTP server**

`config.Load` reads `PORT`, `MAX_CONCURRENT_JOBS`, and `RENDER_SERVICE_URL`, applying `8000`, `5`, and `http://localhost:3100` when unset. The server exposes `/health` and `/api/config`, sets JSON content types, and returns `404` JSON for unknown routes.

- [x] **Step 4: Add the API entry point**

`cmd/api/main.go` loads configuration, constructs the HTTP server, starts `http.Server`, and shuts down on `SIGINT` or `SIGTERM` with a five-second timeout.

- [x] **Step 5: Run the focused tests and build**

Run: `cd backend-go; go test ./...; go build ./cmd/api`

Expected: all tests pass and the API binary builds without CGO or external services.

- [x] **Step 6: Commit the vertical slice**

```powershell
git add backend-go
git commit -m "feat: scaffold Go control plane API"
```

## Task 2: Typed job domain and repository boundary

**Files:**
- Create: `backend-go/internal/domain/job.go`
- Create: `backend-go/internal/jobs/store.go`
- Create: `backend-go/internal/jobs/store_test.go`

- [x] **Step 1: Write failing repository tests**

Test creation of a queued job, lookup by ID, transition from queued to processing to completed, rejection of an invalid transition, and preservation of append-only log order.

- [x] **Step 2: Run the focused tests and verify the expected missing-symbol failure**

Run: `cd backend-go; go test ./internal/jobs`

Expected: FAIL because the domain and repository types are not implemented.

- [x] **Step 3: Implement domain types and in-memory repository**

Define `JobStatus` values `queued`, `processing`, `completed`, and `failed`; define `Job`, `JobLog`, and `CreateJobInput`; implement a concurrency-safe `Store` interface with `Create`, `Get`, `Transition`, and `AppendLog`.

- [x] **Step 4: Run all Go tests**

Run: `cd backend-go; go test -race ./...`

Expected: all tests pass with no race reports.

- [x] **Step 5: Commit the repository boundary**

```powershell
git add backend-go/internal/domain backend-go/internal/jobs
git commit -m "feat: add typed job repository boundary"
```

## Task 3: Compatibility `/api/process` and `/api/status`

**Files:**
- Modify: `backend-go/internal/httpapi/server.go`
- Modify: `backend-go/internal/httpapi/server_test.go`
- Modify: `backend-go/internal/domain/job.go`

- [x] **Step 1: Write failing API contract tests**

Test JSON submission to `/api/process` with `url` and `acknowledged=true` returns HTTP 202 and a UUID `job_id`. Test `/api/status/{job_id}` returns `status`, `logs`, and `result`. Test missing acknowledgement returns HTTP 400 with the same `detail` field used by FastAPI.

- [x] **Step 2: Run focused tests and verify they fail**

Run: `cd backend-go; go test ./internal/httpapi -run 'TestProcess|TestStatus' -v`

Expected: FAIL because the compatibility routes are not registered.

- [x] **Step 3: Implement request validation and job creation**

Accept JSON and `application/x-www-form-urlencoded` input for the first slice. Require exactly one `url`, require `acknowledged=true`, validate `http`/`https`, create a queued job, and return `{"job_id":"...","status":"queued"}`. Keep worker execution out of the handler.

- [x] **Step 4: Implement status serialization**

Return `{"status":...,"logs":[...],"result":...}` and use HTTP 404 with `{"detail":"Job not found"}` for unknown IDs.

- [x] **Step 5: Run all Go tests**

Run: `cd backend-go; go test -race ./...`

Expected: all tests pass.

- [x] **Step 6: Commit the compatibility slice**

```powershell
git add backend-go/internal/domain backend-go/internal/httpapi
git commit -m "feat: add process and status API contracts"
```

## Task 4: Python worker adapter and durable-ready lifecycle

**Files:**
- Create: `backend-go/internal/workers/python.go`
- Create: `backend-go/internal/workers/python_test.go`
- Create: `backend-go/internal/jobs/runner.go`
- Create: `backend-go/internal/jobs/runner_test.go`
- Modify: `backend-go/internal/domain/job.go`

- [x] **Step 1: Write failing worker adapter tests**

Use an injected command runner to assert that a URL job invokes `python -u main.py --direct-url <url> --target-clips <count> -o <job-output-dir>`, captures output lines, marks success only after a zero exit code, and marks non-zero exits as failed.

- [x] **Step 2: Run focused tests and verify failure**

Run: `cd backend-go; go test ./internal/workers ./internal/jobs -v`

Expected: FAIL because the worker adapter and runner do not exist.

- [x] **Step 3: Implement injected Python command execution**

Keep process execution behind an interface so tests do not spawn Python. The production runner uses `os/exec`, sets `PYTHONUNBUFFERED=1`, streams combined stdout/stderr to the job log sink, and propagates context cancellation.

- [x] **Step 4: Implement queued-job dispatch**

Add a bounded worker runner that claims queued jobs, transitions them to processing, invokes the Python adapter, and transitions to completed or failed. Do not mark a job completed from exit code alone once artifact validation is added in the next slice.

- [x] **Step 5: Run race tests and the existing Python suite**

Run: `cd backend-go; go test -race ./...`; then from the repository root run `python -m pytest -q`.

Expected: Go tests pass and the pre-existing Python tests remain green.

- [x] **Step 6: Commit the worker boundary**

```powershell
git add backend-go/internal/jobs backend-go/internal/workers
git commit -m "feat: add Python media worker adapter"
```

## Task 5: Storage, manifest, and version compatibility

**Files:**
- Create: `backend-go/internal/manifests/manifest.go`
- Create: `backend-go/internal/manifests/manifest_test.go`
- Create: `backend-go/internal/versions/store.go`
- Create: `backend-go/internal/versions/store_test.go`
- Create: `backend-go/migrations/001_jobs.sql`

- [ ] **Step 1: Write failing compatibility tests**

Test that canonical manifest hashing excludes transient keys exactly as `render_manifest.py` does, test SHA-256 file hashing, test immutable version parent validation, and test allowed render statuses `pending`, `rendering`, `done`, and `failed`.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `cd backend-go; go test ./internal/manifests ./internal/versions -v`

Expected: FAIL because compatibility implementations do not exist.

- [ ] **Step 3: Implement manifest and version primitives**

Use deterministic JSON encoding for revision inputs, UUID version IDs, atomic file writes, and path checks that reject paths escaping a job directory.

- [ ] **Step 4: Add the initial PostgreSQL schema**

Create tables for `jobs`, `job_logs`, `job_results`, `clip_versions`, `clip_statuses`, and `publish_jobs`, including status constraints, timestamps, and indexes on job status and project identity.

- [ ] **Step 5: Run Go tests and Python regression tests**

Run: `cd backend-go; go test -race ./...`; then `python -m pytest -q`.

Expected: all tests pass.

- [ ] **Step 6: Commit compatibility primitives**

```powershell
git add backend-go/internal/manifests backend-go/internal/versions backend-go/migrations
git commit -m "feat: preserve manifest and version contracts"
```

## Task 6: Deployment and migration switch

**Files:**
- Create: `backend-go/Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `k8s/openshorts.yaml`
- Create: `backend-go/README.md`

- [ ] **Step 1: Write deployment smoke checks**

Add a Go test that starts the API on an ephemeral listener and verifies `/health`; add a container command documented in `backend-go/README.md` that runs the same endpoint check.

- [ ] **Step 2: Implement the Go image and local compose service**

Use a multi-stage Go build, run as a non-root user, expose port 8001 initially, and add a compose service named `control-plane` without changing the existing backend service.

- [ ] **Step 3: Add Kubernetes canary deployment**

Add a `openshorts-control-plane` deployment and service on port 8001 with health probes. Keep FastAPI as the active `/api` ingress target until contract tests and shadow traffic validate the Go service.

- [ ] **Step 4: Run build and regression checks**

Run: `cd backend-go; go test ./...; go build ./cmd/api`; then run `python -m pytest -q`, `npm test -- --run` in `dashboard`, and `npm test -- --run` in `render-service`.

- [ ] **Step 5: Commit deployment scaffolding**

```powershell
git add backend-go Dockerfile docker-compose.yml k8s/openshorts.yaml
git commit -m "chore: add Go control plane deployment canary"
```
