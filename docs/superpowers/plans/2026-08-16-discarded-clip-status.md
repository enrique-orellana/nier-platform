# Discarded Clip Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a selectable, persisted `discarded` workflow status for generated clips while keeping discarded clips visible and recoverable.

**Architecture:** Extend the existing shared dashboard status list and both API validation paths. Update the SQLite/PostgreSQL check constraints used by the Go control plane, while retaining the existing FastAPI sidecar path. No new storage model or deletion behavior is introduced.

**Tech Stack:** React/Vitest, FastAPI/Pytest, Go, SQLite/PostgreSQL migrations.

---

### Task 1: Add failing status-list and API tests

**Files:**
- Modify: `dashboard/src/components/ClipWorkflowStatus.test.jsx`
- Modify: `tests/test_clip_status_api.py`
- Modify: `backend-go/internal/httpapi/server_test.go`
- Modify: `backend-go/migrations/001_jobs.sql`
- Modify: `backend-go/internal/jobs/migrations/001_jobs.sql`

- [ ] Add assertions that the dashboard renders an option named `Discarded`, the FastAPI status endpoint accepts `{ "status": "discarded" }`, and the Go route accepts the same payload.
- [ ] Add migration assertions or schema checks proving `discarded` is included in both Go status constraints.
- [ ] Run the focused dashboard, Python, and Go tests and confirm they fail because the current status lists reject or omit `discarded`.

### Task 2: Implement the shared discarded status

**Files:**
- Modify: `dashboard/src/components/clipWorkflowStatuses.js`
- Modify: `app.py`
- Modify: `backend-go/internal/httpapi/server.go`
- Modify: `backend-go/migrations/001_jobs.sql`
- Modify: `backend-go/internal/jobs/migrations/001_jobs.sql`

- [ ] Add the `discarded` status definition with a distinct neutral/red-tinted badge style consistent with the existing Tailwind classes.
- [ ] Add `discarded` to the FastAPI request allowlist and Go route allowlist.
- [ ] Add `discarded` to both Go database check constraints so persisted jobs and fresh migrations accept it.

### Task 3: Verify dashboard summaries and API persistence

**Files:**
- Modify: `dashboard/src/components/ProjectLibrary.test.jsx`

- [ ] Add a summary assertion showing one discarded clip is counted and remains rendered in the project library.
- [ ] Run the focused dashboard, Python, and Go tests until all pass.
- [ ] Run the complete dashboard suite, Python suite, Go suite, and dashboard lint.

### Task 4: Final scope review

- [ ] Run `git diff --check`.
- [ ] Run GitNexus `detect_changes({scope: "all"})` and review affected flows.
- [ ] Confirm no unrelated files changed, then commit the implementation.
