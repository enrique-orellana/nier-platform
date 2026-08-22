# Local editor cue UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make subtitle cues easier to scan and edit in the local editor timeline while preserving the existing cue data and editing behavior.

**Architecture:** Keep cue state owned by `LocalEditorTab`; improve presentation and interaction affordances inside `LocalEditorTimeline` and `SubtitleCueTable`. The timeline will derive the current cue from `playheadMs`, while both views continue to use `selectedId` for cross-view selection.

**Tech Stack:** React, Tailwind utility classes, Vitest, Testing Library.

---

### Task 1: Add failing tests for timeline cue states

**Files:**
- Modify: `dashboard/src/components/local-editor/LocalEditorTimeline.test.jsx`
- Modify: `dashboard/src/components/local-editor/LocalEditorTimeline.jsx`

- [ ] **Step 1: Add tests for current and selected state semantics.**

Add tests that render a cue under `playheadMs` and assert `data-current-cue="true"`, while a separately selected cue has `aria-pressed="true"` or an equivalent selected marker. Assert that a narrow cue exposes its complete text through `title`.

- [ ] **Step 2: Run the focused timeline test and verify the new assertions fail.**

Run from `dashboard`:

```powershell
npm test -- --run src/components/local-editor/LocalEditorTimeline.test.jsx
```

Expected result: the existing tests pass and the new state/tooltip assertions fail because the attributes and title are not yet present.

- [ ] **Step 3: Implement the smallest `CueBlock` presentation changes.**

Pass `current` into `CueBlock` from `Track`, add current/selected data attributes and `aria-pressed`, add a `title` containing the full cue text, and use distinct classes for normal, current, and selected states. Keep the existing drag, resize, click, double-click, and keyboard handlers unchanged.

- [ ] **Step 4: Run the focused timeline test again.**

Expected result: all timeline tests pass.

### Task 2: Improve cue table visual parity

**Files:**
- Modify: `dashboard/src/components/local-editor/SubtitleCueTable.jsx`
- Modify: `dashboard/src/components/local-editor/SubtitleCueTable.test.jsx`

- [ ] **Step 1: Add a failing test for explicit row state metadata.**

Assert that the current row has `data-current-cue="true"`, the selected row has `aria-selected="true"`, and the selected/current distinction is preserved when they are different cues.

- [ ] **Step 2: Run the focused cue-table test and verify the new assertion fails.**

Run:

```powershell
npm test -- --run src/components/local-editor/SubtitleCueTable.test.jsx
```

Expected result: the new metadata assertion fails before implementation.

- [ ] **Step 3: Apply the compact editor-first row treatment.**

Keep the table structure and editing inputs, but make current and selected states visually distinct, add a small current-state indicator, and preserve the existing delete and scroll-to-current behavior. Use the same cyan current accent and violet selected accent as the timeline.

- [ ] **Step 4: Run the focused cue-table test.**

Expected result: all cue-table tests pass.

### Task 3: Verify the integrated cue experience

**Files:**
- Modify: `dashboard/src/components/local-editor/LocalEditorTimeline.test.jsx`
- Modify: `dashboard/src/components/local-editor/SubtitleCueTable.test.jsx`

- [ ] **Step 1: Run all focused cue tests.**

```powershell
npm test -- --run src/components/local-editor/LocalEditorTimeline.test.jsx src/components/local-editor/SubtitleCueTable.test.jsx
```

Expected result: all focused cue tests pass with no warnings.

- [ ] **Step 2: Run dashboard formatting and lint checks.**

```powershell
npm run format
npm run format:check
npm run lint
```

Expected result: all commands succeed.

- [ ] **Step 3: Run GitNexus change detection.**

Use `detect_changes({ scope: "all", repo: "openshorts" })` and confirm the changed symbols are limited to the cue timeline/table and their tests, plus the user's pre-existing subtitle-panel edits.

- [ ] **Step 4: Commit only the cue UI files.**

Stage the timeline/table implementation and focused tests, leaving the user's existing `LocalEditorTab` and `LocalEditorSubtitleStyleInspector` changes unstaged. Commit with:

```powershell
git commit -m "Polish local editor cue states"
```
