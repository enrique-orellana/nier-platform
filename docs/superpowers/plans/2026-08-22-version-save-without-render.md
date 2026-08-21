# Save Versions Without Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make “Save as new version” persist only the edited manifest, while “Export Video” creates, renders, completes, and promotes the immutable version output.

**Architecture:** Reuse the existing version store and render helper, but split the frontend orchestration into a save-only helper and the existing save-and-render helper. A save-only version remains pending with no output URL, so the prior rendered clip remains active; exporting the current draft renders the full hook/subtitle/effects props and downloads the resulting MP4.

**Tech Stack:** React, Vitest/Testing Library, existing Go/Python version APIs, Remotion render service.

---

### Task 1: Lock the save/export contracts with failing tests

**Files:**
- Modify: `dashboard/src/editor/renderVersion.test.js`
- Modify: `dashboard/src/components/editor/FullScreenEditor.test.jsx`
- Modify: `dashboard/src/components/local-editor/LocalEditorTab.test.jsx`

- [x] Add a test proving save-only calls `createVersion` but never starts rendering or completes a version.
- [x] Add a FullScreenEditor test proving Save as new version stores the manifest without calling the render helper.
- [x] Add a LocalEditorTab test proving Export Video delegates to the version export callback and downloads its returned URL.
- [x] Run the focused tests and confirm they fail for the missing save/export separation.

### Task 2: Implement the save-only version path

**Files:**
- Modify: `dashboard/src/editor/renderVersion.js`
- Modify: `dashboard/src/components/editor/FullScreenEditor.jsx`

- [x] Export a `saveDraftVersion` helper that creates a child version and returns its saved version/manifest without calling render or complete.
- [x] Change the FullScreenEditor Save action to use `saveDraftVersion`, update local history/selection/route, and show “Saving…” rather than “Rendering…”.
- [x] Keep the existing `saveAndRenderVersion` helper unchanged for export.

### Task 3: Move rendering to Export Video

**Files:**
- Modify: `dashboard/src/components/editor/FullScreenEditor.jsx`
- Modify: `dashboard/src/components/local-editor/LocalEditorTab.jsx`

- [x] Add an export callback from FullScreenEditor to LocalEditorTab.
- [x] Make project-clip Export Video call `saveAndRenderVersion` with the complete current project props, including hook, subtitles, subtitle tracks, and effects.
- [x] Download the completed output URL from LocalEditorTab and update the active clip only after successful completion.
- [x] Preserve standalone local-editor export behavior when no project export callback is supplied.

### Task 4: Verify the changed behavior

**Files:**
- Verify: `dashboard/src/editor/renderVersion.test.js`
- Verify: `dashboard/src/components/editor/FullScreenEditor.test.jsx`
- Verify: `dashboard/src/components/local-editor/LocalEditorTab.test.jsx`

- [x] Run focused dashboard tests.
- [x] Run `npm run format`, `npm run format:check`, and `npm run lint` from `dashboard`.
- [x] Run the broader dashboard test suite if the focused tests pass.
- [x] Run GitNexus `detect_changes()` and inspect the final diff for unrelated changes.
