# Immutable Clip Versions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist every rendered edit as an immutable, branchable clip version without overwriting existing outputs.

**Architecture:** Add a version store beside the existing render manifest. Each version has a UUID, parent version ID, canonical manifest revision, render status, and unique output artifact. The backend owns version creation, branching, current-pointer promotion, migration, and renderer requests; the renderer validates the requested revision before publishing an output.

**Tech Stack:** Python, FastAPI, JSON manifests, atomic filesystem writes, existing Remotion render service, pytest.

---

### Task 1: Define immutable version storage and tests

**Files:**
- Create: `version_store.py`
- Create: `tests/test_version_store.py`

- [ ] **Step 1: Write failing tests**

Add tests for `create_version`, `load_version`, `list_versions`, `branch_version`, and `promote_version`. Assert that a child records its parent, version files are never overwritten, failed versions do not move `current_version_id`, and a branch from version 3 can be created after version 4 exists.

```python
def test_branch_from_older_version_does_not_change_later_branch(tmp_path):
    store = VersionStore(tmp_path / "clip")
    v0 = store.create_version(manifest("v0"), parent_version_id=None)
    v1 = store.create_version(manifest("v1"), parent_version_id=v0.version_id)
    v2 = store.create_version(manifest("v2"), parent_version_id=v1.version_id)
    v3 = store.create_version(manifest("v3"), parent_version_id=v2.version_id)
    v4 = store.create_version(manifest("v4"), parent_version_id=v3.version_id)
    branch = store.create_version(manifest("branch"), parent_version_id=v3.version_id)

    assert store.load_version(v4.version_id).parent_version_id == v3.version_id
    assert store.load_version(branch.version_id).parent_version_id == v3.version_id
    assert store.current_version_id is None
```

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run: `python -m pytest tests/test_version_store.py -q`  
Expected: FAIL because `version_store` does not exist.

- [ ] **Step 3: Implement the minimal version store**

Use `output/<job_id>/clips/<clip_index>/versions/<version_id>.json` for manifests and `versions/index.json` for the version index/current pointer. Generate `version_id` with `uuid.uuid4()`. Store `manifest_revision = calculate_revision(manifest)`. Write JSON through a sibling temporary file, `flush()`, `os.fsync()`, and `os.replace()`. `promote_version()` must require status `done`, a non-empty output URL, and a matching manifest revision.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `python -m pytest tests/test_version_store.py -q`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add version_store.py tests/test_version_store.py
git commit -m "feat: add immutable clip version store"
```

### Task 2: Extend manifest validation for version metadata

**Files:**
- Modify: `render_manifest.py`
- Modify: `tests/test_render_manifest.py`

- [ ] **Step 1: Add failing validation tests**

Test that a manifest with `version_id`, `parent_version_id`, and `manifest_revision` calculates the same revision regardless of `master`, `render_status`, or `updated_at`, and that source checksums remain mandatory.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `python -m pytest tests/test_render_manifest.py -q`  
Expected: FAIL for the new version metadata assertions.

- [ ] **Step 3: Implement version-aware canonicalization**

Keep `master`, `render_status`, and `updated_at` transient. Add a `version_id`/`parent_version_id` schema check without including generated timestamps in the revision. Reject a manifest whose declared `manifest_revision` differs from `calculate_revision()`.

- [ ] **Step 4: Run manifest tests**

Run: `python -m pytest tests/test_render_manifest.py -q`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add render_manifest.py tests/test_render_manifest.py
git commit -m "feat: validate versioned manifest revisions"
```

### Task 3: Add version and branch API endpoints

**Files:**
- Modify: `app.py`
- Create: `tests/test_version_api.py`

- [ ] **Step 1: Write failing API tests**

Cover:

```python
def test_get_versions_returns_parent_and_current_state(client, clip_fixture): ...
def test_branch_from_historical_version_creates_child(client, clip_fixture): ...
def test_failed_version_cannot_become_current(client, clip_fixture): ...
```

Assert that invalid clip IDs return 404, path traversal is rejected, and a branch from an older version remains a sibling of newer versions.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `python -m pytest tests/test_version_api.py -q`  
Expected: FAIL because the endpoints do not exist.

- [ ] **Step 3: Implement endpoints**

Add:

- `GET /api/clip/{job_id}/{clip_index}/versions`
- `GET /api/clip/{job_id}/{clip_index}/versions/{version_id}`
- `POST /api/clip/{job_id}/{clip_index}/versions/branch`
- `POST /api/clip/{job_id}/{clip_index}/versions/{version_id}/activate`

Resolve all paths beneath the clip version directory. Branching copies the selected manifest into a new UUID version with `parent_version_id` set to the selected version. Activation requires a validated successful output and does not delete any version.

- [ ] **Step 4: Run API tests**

Run: `python -m pytest tests/test_version_api.py -q`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app.py tests/test_version_api.py
git commit -m "feat: expose clip version and branch APIs"
```

### Task 4: Migrate existing clips without deleting outputs

**Files:**
- Modify: `app.py`
- Create: `tests/test_version_migration.py`

- [ ] **Step 1: Write the migration regression test**

Create a fixture containing an existing metadata JSON, source clip, and current edited MP4 with no version directory. Assert that migration creates version 0 and an index while byte-for-byte preserving both existing files and URLs.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `python -m pytest tests/test_version_migration.py -q`  
Expected: FAIL because legacy clips are not migrated.

- [ ] **Step 3: Implement idempotent migration**

On first access to the version API or editor, create a legacy version pointing to the preserved source/current output. Store `legacy: true`, the original URL, and the current output URL. If the version index already exists, return without changing it.

- [ ] **Step 4: Run migration and source-retention tests**

Run: `python -m pytest tests/test_version_migration.py tests/test_source_retention.py -q`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app.py tests/test_version_migration.py
git commit -m "feat: migrate legacy clips into version history"
```

### Task 5: Render and promote immutable version outputs

**Files:**
- Modify: `dashboard/src/components/ResultCard.jsx`
- Modify: `app.py`
- Modify: `render-service/src/server.ts`
- Modify: `render-service/src/render-worker.ts`
- Create: `render-service/src/version-render.test.ts`

- [ ] **Step 1: Write the failing renderer contract test**

Assert that a render request includes `versionId` and `manifestRevision`, output names include the version ID, and a completion for a mismatched revision is rejected instead of promoted.

- [ ] **Step 2: Run the focused renderer test and verify failure**

Run: `npm test -- --run src/version-render.test.ts` from `render-service`  
Expected: FAIL because version-aware render fields are not accepted.

- [ ] **Step 3: Implement the version render contract**

Extend the render request schema with `versionId`, `manifestPath`, and `manifestRevision`. Resolve manifests only under the clip’s versions directory. Render to `masters/<versionId>.mp4`, validate output metadata, and return the version ID/revision. Promote through the backend only when both match.

- [ ] **Step 4: Update the dashboard render flow**

Replace the current `video-url` persistence call in `ResultCard.jsx` with version creation plus render polling. Keep the existing current output visible until the new version succeeds. On success, refresh the version list and current pointer.

- [ ] **Step 5: Run renderer and dashboard tests**

Run: `npm test` and `npm run build` in `render-service`; run `npm test`, `npm run build`, and `npm run lint` in `dashboard`.  
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add app.py render-service/src/server.ts render-service/src/render-worker.ts render-service/src/version-render.test.ts dashboard/src/components/ResultCard.jsx
git commit -m "feat: render and promote immutable clip versions"
```

### Task 6: Verify version history end to end

**Files:**
- Create: `tests/test_version_end_to_end.py`

- [ ] **Step 1: Add an integration fixture**

Create v0, render a hook as v1, add a translated-track layer as v2, branch from v1 as v3, and assert all manifests and output paths remain present.

- [ ] **Step 2: Run the integration test**

Run: `python -m pytest tests/test_version_end_to_end.py -q`  
Expected: PASS; v2 and v3 both retain `parent_version_id == v1.version_id`, and v1 remains readable.

- [ ] **Step 3: Run the full backend and renderer suites**

Run: `python -m pytest -q` and `npm test` in `render-service`.  
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/test_version_end_to_end.py
git commit -m "test: verify immutable clip version branching"
```
