# Local Editor General Playback Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all playback controls into the Local Editor top utility bar, keep them functional across native and Remotion previews, keep the cue-table controls contextual, and remove zoom controls.

**Architecture:** `LocalEditorTab` owns playback rate, loop-segment state, follow-audio state, and the scroll-to-current command. It renders the controls in `local-editor-header-utility` and passes controlled values/callbacks to `SubtitleCueTable`. `RemotionPreview` receives the controlled playback rate and passes it to Remotion’s `Player`.

**Tech Stack:** React, Vitest, Testing Library, Remotion Player 4.0.509, Tailwind CSS.

---

### Task 1: Define the control behavior with failing tests

**Files:**
- Modify: `dashboard/src/components/local-editor/LocalEditorTab.test.jsx`
- Modify: `dashboard/src/components/local-editor/SubtitleCueTable.test.jsx`
- Modify: `dashboard/src/components/RemotionPreview.test.jsx`

- [ ] **Step 1: Add a LocalEditorTab test for the top-bar controls**

Render an editor with subtitle cues and assert that `Speed`, `Loop Segment`, `Follow Audio`, and `Scroll to Current` are inside `local-editor-header-utility`, while the cue-table playback-controls heading and zoom buttons are absent.

- [ ] **Step 2: Add a LocalEditorTab test for native playback speed**

Render the native video path, change the top-bar speed select to `1.5`, and assert the native video’s `playbackRate` becomes `1.5`.

- [ ] **Step 3: Add a SubtitleCueTable test for controlled contextual controls**

Render the table with controlled `followAudio` and `onFollowAudioChange` props, click the checkbox, and assert the callback receives `false`. Assert the table renders only the row/table-specific content and retains the Scroll to Current callback hook.

- [ ] **Step 4: Add a RemotionPreview test for playback rate forwarding**

Extend the existing Remotion Player mock and assert the `playbackRate` prop received by the player changes when the component prop changes.

- [ ] **Step 5: Run the focused tests and confirm they fail for missing behavior**

Run:

```powershell
npm test -- --run src/components/local-editor/LocalEditorTab.test.jsx src/components/local-editor/SubtitleCueTable.test.jsx src/components/RemotionPreview.test.jsx
```

Expected: the new control-placement and playback-rate assertions fail while existing tests remain diagnosable.

### Task 2: Make Remotion playback rate controllable

**Files:**
- Modify: `dashboard/src/components/RemotionPreview.jsx`
- Test: `dashboard/src/components/RemotionPreview.test.jsx`

- [ ] **Step 1: Add a `playbackRate` prop defaulting to `1`**

Pass `playbackRate={playbackRate}` to the Remotion `<Player>`. Keep the prop controlled so changing the top-bar select updates a mounted project preview.

- [ ] **Step 2: Run the RemotionPreview test**

Run:

```powershell
npm test -- --run src/components/RemotionPreview.test.jsx
```

Expected: all Remotion preview tests pass.

### Task 3: Move playback state and controls into the top utility bar

**Files:**
- Modify: `dashboard/src/components/local-editor/LocalEditorTab.jsx`
- Test: `dashboard/src/components/local-editor/LocalEditorTab.test.jsx`

- [ ] **Step 1: Lift control state into LocalEditorTab**

Add controlled state for `playbackRate` (`1`), `loopSegment` (`false`), and `followAudio` (`true`). Maintain the existing whole-player loop state independently from loop-segment state.

- [ ] **Step 2: Apply playback rate to both player implementations**

Set `videoRef.current.playbackRate` for native video and pass `playbackRate` to `RemotionPreview`. Reapply the rate after source/player readiness so the setting is not lost when a project clip loads.

- [ ] **Step 3: Add the four controls to `local-editor-header-utility`**

Render Speed, Loop Segment, Follow Audio, and Scroll to Current there. Disable Scroll to Current when there are no subtitle cues; when clicked from timeline view, switch to cue-table view and invoke the table’s scroll command after it mounts.

- [ ] **Step 4: Remove playback controls from the cue-table header**

Pass controlled state and callbacks into `SubtitleCueTable`; do not render a second Playback Controls bar there.

- [ ] **Step 5: Remove zoom controls**

Remove the cue-table font-size minus/plus controls and the timeline zoom control/state/prop. Keep timeline rendering at its default scale.

- [ ] **Step 6: Run the focused LocalEditorTab tests**

Run:

```powershell
npm test -- --run src/components/local-editor/LocalEditorTab.test.jsx
```

Expected: all LocalEditorTab tests pass, including top-bar placement, native speed, Remotion speed wiring, loop segment, and scroll-to-current behavior.

### Task 4: Simplify SubtitleCueTable interfaces

**Files:**
- Modify: `dashboard/src/components/local-editor/SubtitleCueTable.jsx`
- Test: `dashboard/src/components/local-editor/SubtitleCueTable.test.jsx`

- [ ] **Step 1: Remove local playback state**

Delete the table-owned speed and follow-audio state. Accept controlled `followAudio`, `onFollowAudioChange`, and a `scrollToCurrentRef` callback registration from the parent.

- [ ] **Step 2: Keep Scroll to Current functional**

Register the table’s scroll command with the parent ref and keep row scrolling based on the current cue or first cue fallback.

- [ ] **Step 3: Run the table tests**

Run:

```powershell
npm test -- --run src/components/local-editor/SubtitleCueTable.test.jsx
```

Expected: all table tests pass with no duplicate playback toolbar.

### Task 5: Full verification

**Files:**
- Verify: `dashboard/src/components/local-editor/LocalEditorTab.jsx`
- Verify: `dashboard/src/components/local-editor/SubtitleCueTable.jsx`
- Verify: `dashboard/src/components/RemotionPreview.jsx`

- [ ] **Step 1: Run the affected test suites**

```powershell
npm test -- --run src/App.test.jsx src/components/local-editor/LocalEditorTab.test.jsx src/components/local-editor/SubtitleCueTable.test.jsx src/components/RemotionPreview.test.jsx
```

- [ ] **Step 2: Run required frontend checks**

```powershell
npm run format
npm run format:check
npm run lint
git diff --check
```

- [ ] **Step 3: Run GitNexus change detection**

Run `detect_changes({scope: "unstaged"})` and confirm only the intended editor/playback symbols and flows are affected.
