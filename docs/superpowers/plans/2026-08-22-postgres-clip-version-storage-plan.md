# PostgreSQL Clip Version Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace active file-backed clip-version persistence with PostgreSQL JSONB snapshots, restore complete editor state when switching versions, and make version exports render the exact persisted snapshot.

**Architecture:** Add a version repository boundary with in-memory and PostgreSQL implementations. The Go API will use the repository for all version reads/writes and will forward the database-loaded manifest to the renderer. The dashboard will continue using the `{version, manifest}` API shape, while the renderer will derive render props from the persisted manifest plus its saved render specification.

**Tech Stack:** Go, `database/sql` with pgx, PostgreSQL JSONB, React/Vitest, TypeScript/Zod, Remotion.

---

## File map

- Modify: `backend-go/internal/jobs/migrations/001_jobs.sql` — add the manifest JSONB column and current-version head table.
- Modify: `backend-go/internal/jobs/store.go` — initialize the in-memory version repository and expose it through a provider method without expanding the existing jobs interface.
- Modify: `backend-go/internal/jobs/postgres.go` — expose the PostgreSQL version repository backed by the existing SQL connection.
- Modify: `backend-go/internal/versions/store.go` — retain version value types/status constants, replace file operations with the repository contract, and remove filesystem persistence.
- Create: `backend-go/internal/versions/memory.go` — deterministic repository for HTTP/unit tests.
- Create: `backend-go/internal/versions/postgres.go` — transactional PostgreSQL repository.
- Replace: `backend-go/internal/versions/store_test.go` — repository behavior tests that do not inspect JSON files.
- Modify: `backend-go/internal/httpapi/server.go` — inject the version repository and remove the file-store map.
- Modify: `backend-go/internal/httpapi/clip_handlers.go` — use repository operations and send persisted manifests to the renderer.
- Modify: `backend-go/cmd/api/main.go` — construct the PostgreSQL-backed version repository when PostgreSQL is configured.
- Modify: `backend-go/internal/httpapi/server_test.go` — update version route tests for database/in-memory repository behavior, current heads, deletion rules, and persisted render payloads.
- Modify: `dashboard/src/components/editor/FullScreenEditor.jsx` — persist render configuration, restore all selected-version state, and use saved render configuration for previews/exports.
- Modify: `dashboard/src/editor/renderVersion.js` — start version renders by ID without sending browser-authoritative render props.
- Modify: `dashboard/src/components/editor/FullScreenEditor.test.jsx` — test complete version switching and ID-only export requests.
- Modify: `render-service/src/render-request.ts` — accept persisted-manifest version render requests alongside existing generic render requests.
- Create: `render-service/src/version-manifest.ts` — convert a persisted manifest and render specification into Remotion render props.
- Create: `render-service/src/version-manifest.test.ts` — test the manifest-to-render-props conversion.
- Modify: `render-service/src/server.ts` — select the persisted-manifest conversion path for version requests.
- Modify: `render-service/src/render-props.ts` — share normalization for both generic and manifest-derived props.
- Modify: `render-service/src/render-request.test.ts` — test the new version request shape and reject incomplete version requests.
- Modify: `render-service/src/render-props.test.ts` — retain generic prop behavior and add persisted-manifest expectations where appropriate.

The manual migration of pre-existing `output/**/versions/*.json` files is explicitly outside this implementation plan.

### Task 1: Add the PostgreSQL schema

**Files:**
- Modify: `backend-go/internal/jobs/migrations/001_jobs.sql`
- Test: `backend-go/internal/jobs/postgres_test.go` or a new migration-focused test beside the existing PostgreSQL tests

- [ ] **Step 1: Write the schema assertions first.** Assert that the migration creates `clip_versions.manifest` as JSONB, creates `clip_version_heads`, enforces the head foreign key, and preserves the existing status/project/clip indexes.

- [ ] **Step 2: Make the migration idempotent.** Keep the repository’s current embedded-migration convention and add the following shape to `001_jobs.sql`:

```sql
ALTER TABLE clip_versions
    ADD COLUMN IF NOT EXISTS manifest JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS clip_version_heads (
    project_id TEXT NOT NULL,
    clip_index INTEGER NOT NULL CHECK (clip_index >= 0),
    current_version_id UUID NOT NULL REFERENCES clip_versions(version_id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, clip_index)
);

CREATE INDEX IF NOT EXISTS clip_version_heads_current_idx
    ON clip_version_heads (current_version_id);
```

Use `manifest` only for rows created by the new repository. Do not import existing JSON files or create an application fallback for rows/files from the old implementation.

- [ ] **Step 3: Run the migration tests.** Run:

```powershell
go test ./internal/jobs -run 'Test.*Migration|Test.*Postgres' -count=1
```

Expected: PASS, or a clear database-availability skip for tests requiring an external PostgreSQL instance.

- [ ] **Step 4: Commit the schema change.**

```powershell
git add backend-go/internal/jobs/migrations/001_jobs.sql backend-go/internal/jobs/*_test.go
git commit -m "feat: add postgres clip version snapshots"
```

### Task 2: Create the version repository boundary

**Files:**
- Modify: `backend-go/internal/versions/store.go`
- Create: `backend-go/internal/versions/memory.go`
- Create: `backend-go/internal/versions/postgres.go`
- Replace: `backend-go/internal/versions/store_test.go`
- Modify: `backend-go/internal/jobs/store.go`
- Modify: `backend-go/internal/jobs/postgres.go`

- [ ] **Step 1: Define the repository contract and test cases.** Keep `VersionRecord` JSON fields unchanged and define a context-aware contract with these operations:

```go
type Repository interface {
    List(ctx context.Context, projectID string, clipIndex int) (string, []VersionRecord, error)
    Create(ctx context.Context, projectID string, clipIndex int, manifest map[string]any, parentVersionID *string) (VersionRecord, map[string]any, error)
    Load(ctx context.Context, projectID string, clipIndex int, versionID string) (VersionRecord, map[string]any, error)
    UpdateRender(ctx context.Context, projectID string, clipIndex int, versionID string, status RenderStatus, message string) (VersionRecord, error)
    Promote(ctx context.Context, projectID string, clipIndex int, versionID string, outputURL string) (VersionRecord, error)
    Delete(ctx context.Context, projectID string, clipIndex int, versionID string) (VersionRecord, string, error)
}
```

The tests must cover creation, parent validation, manifest metadata injection, list ordering, render status updates, promotion, failed-version rejection, child-protected deletion, and current-head replacement.

- [ ] **Step 2: Implement the in-memory repository.** Use a mutex and maps keyed by `(projectID, clipIndex, versionID)` plus a head map keyed by `(projectID, clipIndex)`. Store deep-copied manifests so callers cannot mutate persisted snapshots after `Create` or `Load`. Preserve the current file-store semantics for UUID generation, revision calculation, pending status, and `master: null`, but never write a file.

- [ ] **Step 3: Implement the PostgreSQL repository.** Use `database/sql` and transactions. Creation must insert the full JSONB manifest and version metadata in one transaction. Parent validation must use both project and clip predicates:

```sql
SELECT 1
FROM clip_versions
WHERE version_id = $1 AND project_id = $2 AND clip_index = $3
```

`Promote` must lock the version row, require `status = 'done'` and a non-empty output URL, update the version output URL, and upsert `clip_version_heads` in the same transaction. `Delete` must reject a version with children, lock/update the head if needed, delete the row, and return the replacement head.

- [ ] **Step 4: Connect concrete job stores without changing the broad `jobs.Store` interface.** Add a provider method to `MemoryStore` and `PostgresStore`:

```go
func (s *MemoryStore) VersionRepository() versions.Repository
func (s *PostgresStore) VersionRepository() versions.Repository
```

Initialize the memory repository in `NewMemoryStore`. Have `PostgresStore.VersionRepository()` return a repository using its existing `*sql.DB`. This keeps unrelated job-store implementations from needing version methods.

- [ ] **Step 5: Run repository tests.** Run:

```powershell
go test ./internal/versions ./internal/jobs -count=1
```

Expected: PASS with no version JSON files created in temporary directories.

- [ ] **Step 6: Commit the repository layer.**

```powershell
git add backend-go/internal/versions backend-go/internal/jobs/store.go backend-go/internal/jobs/postgres.go
git commit -m "feat: add database-backed clip version repository"
```

### Task 3: Switch the Go API from files to the repository

**Files:**
- Modify: `backend-go/internal/httpapi/server.go`
- Modify: `backend-go/internal/httpapi/clip_handlers.go`
- Modify: `backend-go/cmd/api/main.go`
- Modify: `backend-go/internal/httpapi/server_test.go`

- [ ] **Step 1: Add failing route tests.** Update the existing version route test to assert that:

  - create/list/get responses contain the complete manifest;
  - `outputDir` contains no `versions/*.json` or `index.json` after create;
  - deleting a parent with a child returns conflict;
  - deleting the current leaf moves the head to the newest remaining completed version;
  - the render request sent upstream contains a database-loaded manifest.

- [ ] **Step 2: Inject the repository into `Server`.** Add `versionRepository versions.Repository` to `Server`. Make the existing constructors resolve the repository from the concrete job store provider and fall back to `versions.NewMemoryRepository()` for unit tests without PostgreSQL. Remove `versionMu` and `versionStores`.

- [ ] **Step 3: Replace route operations.** Change `clip_handlers.go` so every version route passes `r.Context()`, `jobID`, and `clipIndex` to the repository. Remove `versionStore()` and all version filesystem path construction. Preserve the response shapes:

```json
{
  "current_version_id": "...",
  "versions": []
}
```

and:

```json
{
  "version": {},
  "manifest": {}
}
```

- [ ] **Step 4: Wire production explicitly.** Update `main.go` to pass the PostgreSQL-backed repository into a constructor that accepts a version repository. The no-`DATABASE_URL` path uses the in-memory repository and never uses JSON files.

- [ ] **Step 5: Run the API tests.** Run:

```powershell
go test ./internal/httpapi -run 'TestClipVersion|Test.*Version' -count=1
```

Expected: PASS, with no file-backed version store references in the active handlers.

- [ ] **Step 6: Commit the API switch.**

```powershell
git add backend-go/internal/httpapi backend-go/cmd/api/main.go
git commit -m "feat: persist clip versions through postgres repository"
```

### Task 4: Persist canonical render configuration with each version

**Files:**
- Modify: `dashboard/src/components/editor/FullScreenEditor.jsx`
- Modify: `dashboard/src/editor/renderVersion.js`
- Modify: `backend-go/internal/httpapi/clip_handlers.go`
- Modify: `backend-go/internal/versions/store.go`
- Test: `dashboard/src/components/editor/FullScreenEditor.test.jsx`
- Test: `backend-go/internal/httpapi/server_test.go`

- [ ] **Step 1: Add a failing manifest test.** Assert that the manifest sent to `saveDraftVersion` includes a `render_spec` containing `video_start_seconds`, `duration_in_frames`, `fps`, `width`, `height`, and `video_fit`.

- [ ] **Step 2: Add `render_spec` when building the latest version payload.** Build it from the same values used for the preview and export, then add it to the manifest before calculating the render props. Use the saved `render_spec` when a selected historical version has one; fall back to clip defaults only for an unsaved draft.

```js
render_spec: {
  video_start_seconds: renderProps.videoStartSeconds || 0,
  duration_in_frames: Math.max(1, Math.round(durationSeconds * fps)),
  fps,
  width: clip.output_width || 1080,
  height: clip.output_height || 1920,
  video_fit: renderProps.videoFit || "cover",
}
```

- [ ] **Step 3: Keep the API request body stable.** Continue sending `{manifest, parent_version_id}`; `render_spec` is part of the immutable manifest and therefore receives the same revision/hash treatment as the other saved fields.

- [ ] **Step 4: Run dashboard editor tests.** Run:

```powershell
cd dashboard
npm test -- --run src/components/editor/FullScreenEditor.test.jsx
cd ..
```

Expected: PASS, including existing hook/subtitle/effect/hashtag persistence tests.

- [ ] **Step 5: Commit the canonical render snapshot.**

```powershell
git add dashboard/src/components/editor/FullScreenEditor.jsx dashboard/src/editor/renderVersion.js dashboard/src/components/editor/FullScreenEditor.test.jsx
git commit -m "feat: save render configuration with clip versions"
```

### Task 5: Make the renderer consume the persisted manifest

**Files:**
- Modify: `dashboard/src/editor/renderVersion.js`
- Modify: `backend-go/internal/httpapi/clip_handlers.go`
- Modify: `render-service/src/render-request.ts`
- Create: `render-service/src/version-manifest.ts`
- Create: `render-service/src/version-manifest.test.ts`
- Modify: `render-service/src/server.ts`
- Modify: `render-service/src/render-props.ts`
- Modify: `render-service/src/render-request.test.ts`
- Modify: `render-service/src/render-props.test.ts`

- [ ] **Step 1: Write the renderer contract tests first.** Add a version request fixture with `manifest`, `versionId`, and `manifestRevision`. Assert that the parsed request requires a non-empty manifest and that conversion yields source URL, trim offset, render dimensions, subtitles, active track, hook, effects, and audio from the manifest.

- [ ] **Step 2: Add a manifest-derived render adapter.** Implement `manifestToVersionRenderProps(manifest)` in `version-manifest.ts`. It must:

  - read `manifest.render_spec` for frame rate, dimensions, duration, fit, and source offset;
  - read `manifest.timeline.source_video_url` for the source;
  - choose the active subtitle track from `active_subtitle_track_id`;
  - pass all subtitle tracks while setting the selected active track;
  - pass `layers.subtitles`, `layers.hook`, `layers.effects`, and `layers.audio`;
  - attach `versionId` and `manifestRevision` supplied by the backend.

- [ ] **Step 3: Extend the renderer request schema without breaking generic renders.** Model version requests as a distinct branch with `manifest`, `versionId`, and `manifestRevision`, while retaining the existing `props` branch for non-version `/render` callers. Version requests must not accept a missing render specification.

- [ ] **Step 4: Forward the database snapshot from Go.** In `renderVersion`, load the version manifest from the repository, clone only the transport copy, resolve its source URL for the renderer, and send:

```json
{
  "jobId": "...",
  "clipIndex": 4,
  "versionId": "...",
  "manifestRevision": "...",
  "manifest": { "...": "..." }
}
```

Do not accept browser render props as the authoritative version payload.

- [ ] **Step 5: Select the manifest path in the renderer server.** When a version manifest is present, convert it with `manifestToVersionRenderProps`, resolve `/videos/{job}/{path}` to the renderer’s local output URL, and queue the resulting normalized props. Keep the generic props path unchanged for non-version callers.

- [ ] **Step 6: Make the dashboard start version renders by ID.** Change `startRender` to send only the `versionId` route request body required by the backend. Keep the saved manifest available for the UI, but do not send a second browser-authoritative props object for version rendering.

- [ ] **Step 7: Run renderer tests.** Run:

```powershell
cd render-service
npm test -- --run src/version-manifest.test.ts src/render-request.test.ts src/render-props.test.ts src/version-render.test.ts
cd ..
```

Expected: PASS, including generic render compatibility and persisted-manifest rendering.

- [ ] **Step 8: Commit renderer authority changes.**

```powershell
git add dashboard/src/editor/renderVersion.js backend-go/internal/httpapi/clip_handlers.go render-service/src
git commit -m "feat: render clip versions from persisted manifests"
```

### Task 6: Verify complete version switching in the dashboard

**Files:**
- Modify: `dashboard/src/components/editor/FullScreenEditor.jsx`
- Modify: `dashboard/src/components/editor/FullScreenEditor.test.jsx`

- [ ] **Step 1: Add a switching fixture containing every saved field.** Include trim, transcript, multiple subtitle tracks, active track, style, hook, effects, audio, layout, render spec, and publishing hashtags. Mock `GET /versions/{id}` with a different manifest for the selected version.

- [ ] **Step 2: Assert complete state replacement.** After selecting the historical version, assert that the UI shows the selected version’s subtitle text/style, hook, effects, active track, hashtags, preview configuration, and version ID. Assert that values from the previously selected version are absent.

- [ ] **Step 3: Use the selected version’s render specification.** Ensure preview/export callbacks use the loaded version’s `render_spec` and not the original clip defaults. Preserve the existing draft-building behavior for edits made after switching.

- [ ] **Step 4: Run the focused dashboard tests and required frontend checks.** Run:

```powershell
cd dashboard
npm test -- --run src/components/editor/FullScreenEditor.test.jsx
npm run format
npm run format:check
npm run lint
cd ..
```

Expected: all commands pass.

- [ ] **Step 5: Commit version-switching behavior.**

```powershell
git add dashboard/src/components/editor/FullScreenEditor.jsx dashboard/src/components/editor/FullScreenEditor.test.jsx
git commit -m "feat: restore complete clip version state in editor"
```

### Task 7: Run integration verification and remove active file persistence

**Files:**
- Modify/delete: `backend-go/internal/versions/store.go` and any file-store-only tests/imports
- Modify: `backend-go/internal/httpapi/server_test.go`
- Inspect only: `version_store.py`, `app.py`, and legacy Python tests to confirm they are not part of the deployed Go control-plane route

- [ ] **Step 1: Search for active file-backed version references.** Run:

```powershell
rg -n "versions\.Store|versionStore\(|index\.json|versionsDir|version_store" backend-go dashboard/src
```

Expected: no active Go API path creates or reads version JSON files. Leave unrelated manifest JSON persistence and media files unchanged.

- [ ] **Step 2: Remove the Go file-store implementation.** Delete the unused file-backed methods and their tests after the repository-based tests cover the same behavior. Do not delete the legacy Python module until runtime verification proves it is unused by the deployed control plane.

- [ ] **Step 3: Run the complete backend test suite.** Run:

```powershell
cd backend-go
go test ./... -count=1
cd ..
```

Expected: PASS.

- [ ] **Step 4: Run the complete relevant frontend and renderer suites.** Run:

```powershell
cd dashboard
npm test -- --run
npm run format:check
npm run lint
cd ..
cd render-service
npm test -- --run
cd ..
```

Expected: PASS.

- [ ] **Step 5: Verify the live API behavior without creating data.** Use read-only requests to confirm version GET/list responses come from PostgreSQL and that the renderer contract includes the persisted manifest. Do not call create, render, complete, activate, delete, or migration endpoints against the user’s live project during verification.

- [ ] **Step 6: Run GitNexus change detection before the implementation branch is committed.** Run `detect_changes({scope: "unstaged", repo: "openshorts"})`, review changed symbols/processes, and confirm only version persistence, editor switching, and renderer flows are affected.

- [ ] **Step 7: Preserve the user’s unrelated worktree changes.** Before final handoff, verify that the pre-existing `dashboard/src/components/local-editor/` changes are not included in feature commits.

## Final acceptance criteria

- Creating a new version creates no version JSON file.
- PostgreSQL contains the full manifest and version metadata.
- Existing JSON versions are not read automatically.
- Switching versions restores every saved editor field.
- Export renders the manifest loaded by version ID from PostgreSQL.
- A browser cannot alter the persisted version by sending different render props.
- Failed renders never become current.
- Existing media/object storage behavior remains unchanged.
- Backend, dashboard, and renderer tests pass.
