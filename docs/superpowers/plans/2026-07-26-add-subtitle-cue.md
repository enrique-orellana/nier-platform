# Add Subtitle Cue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a subtitle cue at the shared playhead, select it for immediate editing, and persist it through the existing immutable-version manifest flow.

**Architecture:** Keep `editorState` as the source of truth. Add a small cue factory in `timelineModel.js`, expose an `Add subtitle cue` action from `InspectorPanel`, and let `FullScreenEditor` insert the item into the active `subtitles-*` track. Existing `editorStateToManifest()` serialization and immutable render/save APIs remain unchanged.

**Tech Stack:** React 18, Vitest, Testing Library, existing timeline model and manifest adapter.

---

### Task 1: Add the normalized cue factory

**Files:**
- Modify: `dashboard/src/editor/timelineModel.js`
- Test: `dashboard/src/editor/timelineModel.test.js`

- [ ] **Step 1: Write the failing test**

Add tests for a cue at the playhead and a cue near the end:

```js
it('creates a blank cue at the playhead with a two-second default', () => {
    expect(createSubtitleCue({ playheadMs: 4200, durationMs: 10000, fps: 25, existingIds: [] }))
        .toMatchObject({ type: 'subtitle', text: '', label: '', startMs: 4200, endMs: 6200 });
});

it('clamps the cue to the clip end and keeps one frame minimum duration', () => {
    expect(createSubtitleCue({ playheadMs: 9900, durationMs: 10000, fps: 25, existingIds: ['subtitle-new-1'] }))
        .toMatchObject({ startMs: 9900, endMs: 9940 });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- --run src/editor/timelineModel.test.js`

Expected: FAIL because `createSubtitleCue` is not exported.

- [ ] **Step 3: Implement the factory**

Export `createSubtitleCue({ playheadMs, durationMs, fps = 30, existingIds = [] })`. Clamp the start to `[0, durationMs]`, use `frameMs = 1000 / fps`, set `endMs = min(durationMs, startMs + 2000)`, and if that is not greater than `startMs`, set `endMs = min(durationMs, startMs + frameMs)`. Generate `subtitle-new-N` using the first unused positive integer. Return:

```js
{
  id, type: 'subtitle', label: '', text: '',
  start: startMs / 1000, end: endMs / 1000,
  startMs, endMs, captions: [{ text: '', startMs, endMs }]
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npm test -- --run src/editor/timelineModel.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/editor/timelineModel.js dashboard/src/editor/timelineModel.test.js
git commit -m "feat: add normalized subtitle cue factory"
```

### Task 2: Wire cue insertion into the editor

**Files:**
- Modify: `dashboard/src/components/editor/InspectorPanel.jsx`
- Modify: `dashboard/src/components/editor/FullScreenEditor.jsx`
- Test: `dashboard/src/components/editor/FullScreenEditor.test.jsx`

- [ ] **Step 1: Write the failing editor test**

Add a test with `currentFrame` represented by the existing editor state and an Original subtitle track. Click `Add subtitle cue`, then assert a new timeline item is present and the Inspector contains the Text field for the blank selected cue. Also cover no-track behavior by asserting the action is disabled or the empty-state message appears.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- --run src/components/editor/FullScreenEditor.test.jsx`

Expected: FAIL because the Inspector has no add action.

- [ ] **Step 3: Add the Inspector action**

Extend `InspectorPanel` props with `onAddSubtitleCue` and `canAddSubtitleCue`. When no item is selected, render the existing empty-state message plus an `Add subtitle cue` button when `canAddSubtitleCue` is true. If no subtitle track exists, render `Create or translate a subtitle track before adding cues.` instead of an enabled action.

- [ ] **Step 4: Add insertion state handling**

In `FullScreenEditor`, import `createSubtitleCue`. Derive the active subtitle track from `editorState.tracks` using `activeTrackId` (falling back to the first subtitle track). Implement `addSubtitleCue()`:

```js
const track = editorState.tracks.find((candidate) =>
    candidate.type === 'subtitle' && candidate.id === `subtitles-${activeTrackId}`
) || editorState.tracks.find((candidate) => candidate.type === 'subtitle');
if (!track) return;
const existingIds = track.items.map((item) => item.id);
const cue = createSubtitleCue({
    playheadMs: Math.round(currentFrame / fps * 1000),
    durationMs: Math.round(editorState.durationSec * 1000),
    fps,
    existingIds,
});
setEditorState((previous) => ({
    ...previous,
    tracks: previous.tracks.map((candidate) => candidate.id === track.id
        ? { ...candidate, items: [...candidate.items, { ...cue, trackId: candidate.id }] }
        : candidate),
}));
setSelectedItem({ ...cue, trackId: track.id });
```

Pass the action and availability to `InspectorPanel`.

- [ ] **Step 5: Run focused tests and verify they pass**

Run: `npm test -- --run src/components/editor/FullScreenEditor.test.jsx src/editor/timelineModel.test.js`

Expected: PASS, including existing edit/delete tests.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/components/editor/InspectorPanel.jsx dashboard/src/components/editor/FullScreenEditor.jsx dashboard/src/components/editor/FullScreenEditor.test.jsx
git commit -m "feat: add subtitle cues from the editor playhead"
```

### Task 3: Verify manifest persistence and UI quality

**Files:**
- Test: `dashboard/src/editor/designcomboAdapter.test.js`
- Modify: `dashboard/src/components/editor/SubtitleCueInspector.jsx` only if focus behavior needs a stable ref

- [ ] **Step 1: Add serialization coverage**

Create an editor state containing the factory output on `subtitles-original`, call `editorStateToManifest()`, and assert the new cue appears in both `subtitle_tracks[0].cues` and `subtitle_tracks[0].captions` with identical text/start/end values.

- [ ] **Step 2: Run all dashboard tests**

Run: `npm test`

Expected: all existing and new tests pass.

- [ ] **Step 3: Run lint and production build**

Run: `npm run lint` and `npm run build`

Expected: no lint warnings/errors and a successful Vite build.

- [ ] **Step 4: Manually verify the workflow**

Open a clip with subtitles, move the playhead, click `Add subtitle cue`, type text, adjust timing, delete/re-add once, and confirm the cue remains after `Save as new version` and reopening that version.

- [ ] **Step 5: Commit verification-only changes if any**

```bash
git add dashboard/src/editor/designcomboAdapter.test.js dashboard/src/components/editor/SubtitleCueInspector.jsx
git commit -m "test: verify subtitle cue persistence"
```
