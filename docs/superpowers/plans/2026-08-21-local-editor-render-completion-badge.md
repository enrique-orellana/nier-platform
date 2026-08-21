# Local Editor Render Completion Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a session-local `Ready` badge on the local editor's Version History control when a newly rendered version completes, and clear it when the control is opened.

**Architecture:** Keep render-completion state in `FullScreenEditor`, where the existing `saveAndRenderVersion` flow already resolves. Make the existing local-editor Version History section an openable control whose heading owns the badge and clears the notice when opened. Keep version rows presentational, and update the parent's version list when a render completes.

**Tech Stack:** React, Vitest, React Testing Library, existing `saveAndRenderVersion` polling flow.

---

## Task 1: Add a failing Version History badge test

**Files:**
- Modify: `dashboard/src/components/editor/VersionHistory.test.jsx`

- [ ] Add a test that renders `VersionHistory` with a version, `renderCompleteNotice={true}`, and an `onOpen` spy.
- [ ] Assert the `Ready` badge is visible through a stable test id (`version-render-ready-badge`).
- [ ] Click the `Version History` control and assert `onOpen` is called.
- [ ] Run the focused test and confirm it fails because the component does not yet expose the control or badge.

## Task 2: Implement the Version History control and badge

**Files:**
- Modify: `dashboard/src/components/editor/VersionHistory.jsx`
- Test: `dashboard/src/components/editor/VersionHistory.test.jsx`

- [ ] Add `renderCompleteNotice` and `onOpen` props while preserving the existing version-row callbacks and failed-version behavior.
- [ ] Render an accessible `Version History` button with `aria-expanded`; keep the section open by default so existing version rows remain visible.
- [ ] When the control is opened, call `onOpen` so the parent can clear the session notice.
- [ ] Render the `Ready` badge only while `renderCompleteNotice` is true.
- [ ] Keep the component presentational: it must not own render polling or persistence.
- [ ] Remove or replace the local editor's duplicate outer `Version History` heading when wiring this control so only one accessible control is shown.
- [ ] Re-run the focused component test and confirm it passes.

## Task 3: Connect render completion to the local editor

**Files:**
- Modify: `dashboard/src/components/editor/FullScreenEditor.jsx`
- Test: `dashboard/src/components/editor/FullScreenEditor.test.jsx`

- [ ] Add a failing local-editor integration test using the existing render-flow mocks: complete a save/render with a new version, assert the `Ready` badge appears, open Version History, and assert the badge clears.
- [ ] Add local component state for the session-only completion notice, initialized to false.
- [ ] In the successful `saveVersion` result branch, derive the completed version from `result.version` with a safe fallback using `result.versionId`, `outputUrl`, and `status: "done"`.
- [ ] Upsert that version into `versions` so the newly rendered version is immediately represented in Version History without duplicating an existing id.
- [ ] Set the completion notice only after a successful completed render, then keep the existing preview/version selection updates intact.
- [ ] Pass `renderCompleteNotice` and an `onOpen` callback that clears the notice into the local editor's Version History control.
- [ ] Leave failed/cancelled render behavior without a success badge.
- [ ] Run the focused integration test and confirm it passes.

## Task 4: Verify the change without deployment

**Files:**
- No additional files.

- [ ] From `dashboard`, run `npm run format`.
- [ ] From `dashboard`, run `npm run format:check`.
- [ ] From `dashboard`, run `npm run lint`.
- [ ] Run the dashboard test suite with `npm test -- --run`.
- [ ] Run `git diff --check`, inspect `git diff --stat`, and confirm only the intended editor/test files are changed.
- [ ] Do not run Docker, deployment, or environment-update commands for this request.

## Self-review checklist

- [ ] The notice is session-local and is not persisted to the server.
- [ ] A failed render never produces a `Ready` badge.
- [ ] Opening the existing Version History control clears the badge.
- [ ] The version list includes the newly completed version immediately.
- [ ] Existing version selection, branching, deletion, and failed-version disabling remain unchanged.
- [ ] No duplicate Version History heading/control is introduced.
- [ ] No unfinished wording remains in the plan.
