# Full Timeline Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-editor screen where users can preview a clip, adjust hook and subtitle timing, select subtitle languages, and save edits as new immutable versions.

**Architecture:** The editor loads a version manifest and keeps a local draft. A frame-accurate playhead drives the Remotion preview and timeline cursor. Hook and subtitle tracks are pure draft data until Save as New Version submits the manifest to the version API and starts a validated render. Version history and branching are separate from the visual timeline but share the same manifest API.

**Tech Stack:** React, Remotion Player, existing dashboard components, CSS/Tailwind, Vitest and Testing Library.

**Dependencies:** Complete `2026-07-26-immutable-clip-versions.md` Tasks 1–5 and `2026-07-26-automatic-subtitle-translation.md` Tasks 1–4.

---

### Task 1: Define editor draft and timeline geometry helpers

**Files:**
- Create: `dashboard/src/editor/timelineModel.js`
- Create: `dashboard/src/editor/timelineModel.test.js`

- [ ] **Step 1: Write failing tests**

Test frame/time conversion, clamping, cue movement, cue resizing, and branch-safe draft creation:

```javascript
it('converts a 30fps frame to milliseconds exactly', () => {
  expect(frameToMs(15, 30)).toBe(500);
});

it('clamps a moved cue inside the clip duration', () => {
  expect(moveCue({ startMs: 900, endMs: 1400 }, -1000, 1000)).toEqual({ startMs: 0, endMs: 500 });
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- --run src/editor/timelineModel.test.js` in `dashboard`.  
Expected: FAIL because the timeline helpers do not exist.

- [ ] **Step 3: Implement pure timeline helpers**

Implement:

- `msToFrame(ms, fps)` and `frameToMs(frame, fps)` using deterministic rounding;
- `clampCue(cue, durationMs)`;
- `moveCue(cue, deltaMs, durationMs)`;
- `resizeCue(cue, edge, deltaMs, durationMs, minimumMs = 80)`;
- `makeEditorDraft(version)` using a deep clone so editing cannot mutate the loaded version.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- --run src/editor/timelineModel.test.js`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/editor/timelineModel.js dashboard/src/editor/timelineModel.test.js
git commit -m "feat: add frame-accurate timeline draft helpers"
```

### Task 2: Build timeline track components

**Files:**
- Create: `dashboard/src/components/editor/Timeline.jsx`
- Create: `dashboard/src/components/editor/TimelineTrack.jsx`
- Create: `dashboard/src/components/editor/TimelineCue.jsx`
- Create: `dashboard/src/components/editor/Timeline.test.jsx`

- [ ] **Step 1: Write failing component tests**

Test that the timeline renders Hook, Original Subtitles, and translated tracks; clicking a cue selects it; dragging a cue calls `onDraftChange` with clamped timing; and the playhead calls `onSeek`.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- --run src/components/editor/Timeline.test.jsx`  
Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement track rendering and pointer interaction**

Use a normalized timeline width. Convert pointer X to milliseconds using `durationMs`. Render each cue as a positioned block with start/end handles. Use pointer capture so the drag remains stable outside the cue. Enforce the minimum cue duration and clip bounds through `timelineModel.js`.

- [ ] **Step 4: Run component tests**

Run: `npm test -- --run src/components/editor/Timeline.test.jsx`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/components/editor/Timeline.jsx dashboard/src/components/editor/TimelineTrack.jsx dashboard/src/components/editor/TimelineCue.jsx dashboard/src/components/editor/Timeline.test.jsx
git commit -m "feat: add editable hook and subtitle timeline tracks"
```

### Task 3: Add hook and subtitle inspectors

**Files:**
- Create: `dashboard/src/components/editor/HookInspector.jsx`
- Create: `dashboard/src/components/editor/SubtitleCueInspector.jsx`
- Create: `dashboard/src/components/editor/LayerInspector.test.jsx`

- [ ] **Step 1: Write failing inspector tests**

Test editing hook text/start/end, changing hook style, editing cue text, and selecting a subtitle track. Assert that each change produces a new draft object and leaves the loaded version unchanged.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- --run src/components/editor/LayerInspector.test.jsx`  
Expected: FAIL because inspectors do not exist.

- [ ] **Step 3: Implement inspectors**

Use controlled inputs. Hook inspector edits `text`, `position`, `size`, `entranceAnimation`, `startMs`, `endMs`. Subtitle inspector edits `text`, `startMs`, `endMs`, and exposes the active language track. Every timing change uses the pure clamp/resize helpers.

- [ ] **Step 4: Run inspector tests**

Run: `npm test -- --run src/components/editor/LayerInspector.test.jsx`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/components/editor/HookInspector.jsx dashboard/src/components/editor/SubtitleCueInspector.jsx dashboard/src/components/editor/LayerInspector.test.jsx
git commit -m "feat: add hook and subtitle timeline inspectors"
```

### Task 4: Build version history and branching controls

**Files:**
- Create: `dashboard/src/components/editor/VersionHistory.jsx`
- Create: `dashboard/src/components/editor/VersionHistory.test.jsx`

- [ ] **Step 1: Write failing history tests**

Test that history displays parent/child relationships, marks the current version, allows selecting Version 3 while Version 4 exists, and calls `onBranch(version3Id)` rather than mutating Version 4.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- --run src/components/editor/VersionHistory.test.jsx`  
Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement version history**

Render a compact branch tree with status badges `Draft`, `Rendering`, `Ready`, and `Failed`. Add `Branch from this version` action and prevent activation of failed versions. Refresh history after a successful render.

- [ ] **Step 4: Run history tests**

Run: `npm test -- --run src/components/editor/VersionHistory.test.jsx`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/components/editor/VersionHistory.jsx dashboard/src/components/editor/VersionHistory.test.jsx
git commit -m "feat: add branchable version history controls"
```

### Task 5: Implement the full editor screen

**Files:**
- Create: `dashboard/src/components/ClipEditor.jsx`
- Create: `dashboard/src/components/ClipEditor.test.jsx`
- Modify: `dashboard/src/components/ResultCard.jsx`
- Modify: `dashboard/src/components/RemotionPreview.jsx`

- [ ] **Step 1: Write failing editor integration tests**

Test loading a version, displaying the preview/timeline, changing the active subtitle track, opening translation, branching from history, and saving a draft as a new version. Assert that the old current video remains visible while the new version renders.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- --run src/components/ClipEditor.test.jsx`  
Expected: FAIL because `ClipEditor` is not implemented.

- [ ] **Step 3: Implement the full editor**

On open, fetch `/versions` and the selected manifest. Pass the manifest’s source URL and active layers to `RemotionPreview`. Keep a local draft and current playhead frame. Wire timeline/inspectors to draft updates. Render the selected active subtitle track. Add actions:

- Translate subtitles: open the translation panel from the translation plan.
- Save as New Version: POST the draft, poll render status, and refresh history.
- Branch from Version: POST branch request, then load the returned draft.
- Cancel: discard draft and restore the selected saved version.

Do not replace the current result card URL until the new render reports `Ready`.

- [ ] **Step 4: Integrate from ResultCard**

Add an Edit Timeline action to `ResultCard.jsx` and pass the clip/job/index into `ClipEditor`. Keep existing buttons working for legacy clips while routing new manifest-backed clips into the editor.

- [ ] **Step 5: Update Remotion preview props**

Update `RemotionPreview.jsx` and its server counterpart to accept the selected source trim, active subtitle track, hook timing, and current playhead frame without using a previously rendered MP4 as the next source.

- [ ] **Step 6: Run dashboard tests/build/lint**

Run: `npm test`, `npm run build`, and `npm run lint` in `dashboard`.  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/components/ClipEditor.jsx dashboard/src/components/ClipEditor.test.jsx dashboard/src/components/ResultCard.jsx dashboard/src/components/RemotionPreview.jsx
git commit -m "feat: add full clip timeline editor"
```

### Task 6: Verify end-to-end editing and branching

**Files:**
- Create: `dashboard/src/components/editor/ClipEditor.e2e.test.jsx`

- [ ] **Step 1: Add the end-to-end scenario**

Simulate: open v0, add a hook, translate subtitles to Spanish, select Spanish, drag the hook end time, save v1, branch from v0, select Original, and save v2. Assert that both outputs are present and the branch parents are correct.

- [ ] **Step 2: Run the scenario and full dashboard suite**

Run: `npm test -- --run src/components/editor/ClipEditor.e2e.test.jsx` and then `npm test` in `dashboard`.  
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/components/editor/ClipEditor.e2e.test.jsx
git commit -m "test: verify timeline editing and version branching"
```
