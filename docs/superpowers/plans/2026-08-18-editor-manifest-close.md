# Editor Manifest 404 Close Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task.

**Goal:** Ensure a missing legacy clip manifest does not prevent the project editor from closing or cause repeated bootstrap failures.

**Architecture:** Keep the API’s honest 404 for clips without a local manifest, but make the editor treat that response as an optional bootstrap miss and initialize from clip metadata. Ensure the card-level close handler clears local editor state before invoking route navigation.

**Tech Stack:** React, Vitest, Testing Library, Go HTTP API tests where applicable.

---

### Task 1: Add a regression test for editor close state

**Files:**
- Create or modify: `dashboard/src/components/ResultCard.test.jsx`
- Modify: `dashboard/src/components/ResultCard.jsx`

- [x] Write a test that opens a `ResultCard` editor through the supplied external callback, invokes the editor’s close control, and asserts the editor overlay is removed while the external close callback is called.
- [x] Run the focused Vitest test and confirm it fails because the current external close callback does not clear `showClipEditor`.
- [x] Add one `handleEditorClose` callback that sets `showClipEditor(false)` and then calls `onEditorClose` when provided.
- [x] Pass that callback to `FullScreenEditor`.
- [x] Run the focused test and confirm it passes.

### Task 2: Add a regression test for a missing bootstrap manifest

**Files:**
- Modify: `dashboard/src/components/editor/FullScreenEditor.test.jsx`
- Modify: `dashboard/src/components/editor/FullScreenEditor.jsx`

- [x] Add a test where `/versions` returns no versions and `/manifest` returns 404, then assert the editor still renders from clip metadata and its close callback remains callable.
- [x] Run the focused test and confirm it fails because the current load path returns before applying the clip fallback.
- [x] Add the minimal fallback manifest construction for a 404/failed manifest response, preserving the clip source URL and duration.
- [x] Run the focused editor tests and confirm they pass.

### Task 3: Verify the affected flows

**Files:**
- No additional source files.

- [x] Run the focused frontend tests for `ResultCard` and `FullScreenEditor`.
- [x] Run the full dashboard test suite and production build.
- [x] Run GitNexus `detect_changes()` and confirm only the expected editor/card flows are affected.
