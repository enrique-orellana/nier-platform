# Delete Version History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users delete exactly one selected version from the editor history, including versions with children, and automatically select the newest remaining version when the deleted version was current.

**Architecture:** Add deletion to the Go version store and expose it through the existing `/api/clip/{job}/{clip}/versions/{version}` route using `DELETE`. The store removes only the selected index entry and manifest; the frontend adds a delete control to each history row, reloads history after success, and keeps the newest remaining version active when necessary. Rendered media files are retained.

**Tech Stack:** Go HTTP API, Go filesystem-backed version store, React, Vitest, Testing Library.

---

### Task 1: Add failing backend store and route tests

**Files:**
- Modify: `backend-go/internal/versions/store_test.go`
- Modify: `backend-go/internal/httpapi/server_test.go`

- [ ] **Step 1: Write the failing store test**

Add a test that creates three versions, promotes the newest, deletes the middle version, and verifies the deleted version is absent while its child remains. Add a second case deleting the current version and verify the store promotes the newest remaining version.

- [ ] **Step 2: Write the failing HTTP test**

Extend the existing clip-version route test to issue `DELETE /api/clip/job-1/0/versions/{versionID}` and assert HTTP 200, the deleted version is absent from the returned history, and the response reports the fallback current version.

- [ ] **Step 3: Run the focused Go tests**

Run `go test ./internal/versions ./internal/httpapi` from `backend-go`.

Expected: FAIL because the store and route do not yet implement deletion.

### Task 2: Implement persisted version deletion

**Files:**
- Modify: `backend-go/internal/versions/store.go`
- Modify: `backend-go/internal/httpapi/clip_handlers.go`

- [ ] **Step 1: Add `DeleteVersion` to the store**

Implement `DeleteVersion(versionID string) (VersionRecord, string, error)` under the store mutex. Validate that the version exists, delete its manifest file, remove only its entry from the index, and if it was current select the remaining version with the greatest `CreatedAt`. Write the updated index atomically and return the deleted record plus the new current version ID. Do not delete rendered output files.

- [ ] **Step 2: Add the DELETE route**

In `clipRoutes`, match `DELETE /versions/{versionID}` before the generic GET version handler. Return JSON containing the deleted version and `current_version_id`; return a conflict/not-found response using the existing error conventions when deletion fails.

- [ ] **Step 3: Run the focused Go tests**

Run `go test ./internal/versions ./internal/httpapi` from `backend-go`.

Expected: PASS.

### Task 3: Add the frontend deletion interaction

**Files:**
- Modify: `dashboard/src/components/editor/VersionHistory.jsx`
- Modify: `dashboard/src/components/editor/FullScreenEditor.jsx`
- Test: `dashboard/src/components/editor/VersionHistory.test.jsx`

- [ ] **Step 1: Write the failing component test**

Render `VersionHistory` with two versions and assert each row exposes a delete button that calls `onDelete(version.version_id)` with the selected version ID.

- [ ] **Step 2: Run the focused frontend test**

Run `npm test -- src/components/editor/VersionHistory.test.jsx` from `dashboard`.

Expected: FAIL because no delete control or callback exists.

- [ ] **Step 3: Add the delete control**

Add an `onDelete` prop to `VersionHistory` and render a compact delete button for each version row. Stop click propagation so deleting does not also select the version, and provide an accessible label containing the version prefix.

- [ ] **Step 4: Wire deletion through `FullScreenEditor`**

Add a `deleteVersion` handler that confirms deletion, calls the new DELETE endpoint, updates `versions` and `currentVersionId`, reloads the returned current version when present, clears the editor when no versions remain, and displays API errors through the existing error state. Pass it as `onDelete`.

- [ ] **Step 5: Run the focused frontend tests**

Run `npm test -- src/components/editor/VersionHistory.test.jsx src/components/editor/FullScreenEditor.test.jsx` from `dashboard`.

Expected: PASS.

### Task 4: Full verification and handoff

**Files:**
- Verify: `dashboard/src/components/editor/VersionHistory.jsx`
- Verify: `dashboard/src/components/editor/FullScreenEditor.jsx`
- Verify: `backend-go/internal/versions/store.go`
- Verify: `backend-go/internal/httpapi/clip_handlers.go`

- [ ] **Step 1: Run all Go tests**

Run `go test ./...` from `backend-go`.

- [ ] **Step 2: Run dashboard formatting, lint, and tests**

Run `npm run format`, `npm run format:check`, `npm run lint`, and `npm test` from `dashboard`.

- [ ] **Step 3: Run GitNexus change detection**

Run `detect_changes({repo: "openshorts", scope: "all"})` before committing and review the affected symbols and processes.

- [ ] **Step 4: Commit the implementation**

Run `git add` only for the plan and implementation/test files, then commit with `feat: allow deleting editor versions`.
