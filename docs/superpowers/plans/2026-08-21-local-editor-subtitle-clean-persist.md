# Local Editor Subtitle Cleanup and Master Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add immediate subtitle-period cleanup and a typed-confirmation action that persists the current subtitle track into the clip master manifest.

**Architecture:** The local editor performs a pure cue transformation and sends a focused subtitle payload to `/api/clip/{job_id}/{clip_index}/persist-subtitles`. Both the Go control plane used by Docker and the Python compatibility API merge that payload into the existing manifest, preserving unrelated layers and invalidating the stale master render.

**Tech Stack:** React/Vitest, FastAPI/Python, Go HTTP handlers, manifest JSON storage.

---

### Task 1: Add failing frontend cleanup and confirmation tests

**Files:**
- Modify: `dashboard/src/components/local-editor/LocalEditorTab.test.jsx`
- Modify: `dashboard/src/components/local-editor/localEditorRender.test.js`

- [ ] **Step 1: Test the pure cleanup contract**

Add a test asserting `cleanSubtitleCue` changes `sé.` to `sé`, removes `...` before a closing quote, preserves `¿Qué?` and cue timing, and cleans attached caption text without changing caption timings.

- [ ] **Step 2: Test the editor actions in the red phase**

Add a project-clip render with one cue ending in `sé.`, click `Clean subtitle dots`, and assert the cue preview text becomes `sé`. Add a second test asserting `Persist on master` opens a modal, does not call `fetch` before exact `confirm`, and sends the subtitle payload only after typing `confirm` and clicking the confirmation button.

- [ ] **Step 3: Run focused tests and verify expected failures**

Run from `dashboard`:

```text
npm test -- --run src/components/local-editor/localEditorRender.test.js src/components/local-editor/LocalEditorTab.test.jsx
```

Expected: failures because the cleanup export, buttons, modal, and persistence handler do not exist yet.

### Task 2: Implement frontend cleanup and typed persistence modal

**Files:**
- Modify: `dashboard/src/components/local-editor/localEditorRender.js`
- Modify: `dashboard/src/components/local-editor/LocalEditorTab.jsx`
- Test: `dashboard/src/components/local-editor/localEditorRender.test.js`
- Test: `dashboard/src/components/local-editor/LocalEditorTab.test.jsx`

- [ ] **Step 1: Implement the pure cue transform**

Export a helper that removes terminal ASCII periods from cue text and each attached caption text while returning new objects and preserving all timing fields.

- [ ] **Step 2: Add the Clean subtitle dots transaction**

Add a Subtitles-panel button that maps the helper over `subtitleCues` through `commitEdit`, updates the visible preview immediately, and remains enabled when cues exist even if the result is unchanged.

- [ ] **Step 3: Add the Persist on master action and modal**

For project clips, add a dedicated button. Open a modal with a text input and a disabled-until-exactly-`confirm` confirmation button. On confirmation, POST the active subtitle track payload to the dedicated endpoint, close the modal on success, and show an editor status notice. Do not mutate the local draft on request failure.

- [ ] **Step 4: Run focused frontend tests**

```text
npm test -- --run src/components/local-editor/localEditorRender.test.js src/components/local-editor/LocalEditorTab.test.jsx
```

Expected: all focused tests pass.

### Task 3: Add failing backend persistence tests

**Files:**
- Modify: `backend-go/internal/httpapi/server_test.go`
- Modify: `tests/test_local_editor_subtitles.py`

- [ ] **Step 1: Add Go manifest merge tests**

Exercise `POST /api/clip/job-1/0/persist-subtitles` with cues and style; assert the saved manifest contains the updated active track and subtitle layer, keeps an existing hook layer, and sets `master` to `nil`. Add an empty-cue case asserting the subtitle track is removed and `subtitle_tracks_disabled` is true.

- [ ] **Step 2: Add Python compatibility API tests**

Exercise the same route through the Python app test setup and assert the response preserves unrelated layers and writes the requested subtitle fields.

- [ ] **Step 3: Run backend tests and verify red**

Run:

```text
go test ./internal/httpapi
pytest tests/test_local_editor_subtitles.py -q
```

Expected: route-not-found or missing-handler failures before implementation.

### Task 4: Implement the dedicated persistence endpoint

**Files:**
- Modify: `backend-go/internal/httpapi/clip_handlers.go`
- Modify: `app.py`
- Test: `backend-go/internal/httpapi/server_test.go`
- Test: `tests/test_local_editor_subtitles.py`

- [ ] **Step 1: Add the route and payload validation**

Register `POST .../persist-subtitles` and require a JSON subtitle track payload with cue arrays, style object, language, and optional track ID.

- [ ] **Step 2: Merge only subtitle data**

Load the existing manifest, replace/remove the requested track, update `layers.subtitles`, preserve all unrelated `layers` entries, set `active_subtitle_track_id`, set `subtitle_tracks_disabled` from cue emptiness, set `master` to `nil`, and save atomically.

- [ ] **Step 3: Run backend tests green**

```text
go test ./internal/httpapi
pytest tests/test_local_editor_subtitles.py -q
```

Expected: all targeted backend tests pass.

### Task 5: Verify, inspect impact, and prepare handoff

**Files:**
- Modify only files listed above.

- [ ] **Step 1: Run dashboard formatting, lint, and all tests**

```text
npm run format
npm run format:check
npm run lint
npm test -- --run
```

- [ ] **Step 2: Run Python and Go verification**

```text
pytest -q
go test ./...
git diff --check
```

- [ ] **Step 3: Run GitNexus change detection**

Run `detect_changes({repo: "openshorts", scope: "unstaged"})`, review the affected routes and editor flows, and report any high-risk result before deployment.

- [ ] **Step 4: Do not deploy unless explicitly requested**

The user requested implementation only in this plan; Docker deployment remains a separate action.

