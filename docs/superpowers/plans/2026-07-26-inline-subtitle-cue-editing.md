# Inline Subtitle Cue Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make every subtitle cue visible as a labeled timeline bar and editable inline with frame-accurate timing, including manifests that still store subtitles under `layers.subtitles`.

**Architecture:** Extend the existing pure manifest adapter to normalize legacy and track-based subtitles into stable editor tracks. Keep `DesignComboTimeline` as the draft interaction surface: cue bars handle selection, keyboard/double-click inline text editing, and frame-snapped drag/resize; `FullScreenEditor` remains the single draft owner and renders immutable versions through the existing workflow.

**Tech Stack:** React 18/Vite, Vitest + Testing Library, existing `designcomboAdapter`, `DesignComboTimeline`, and `timelineModel` helpers.

---

### Task 1: Normalize legacy subtitle manifests

**Files:**
- Modify: `dashboard/src/editor/designcomboAdapter.js`
- Test: `dashboard/src/editor/designcomboAdapter.test.js`

- [ ] **Step 1: Write failing adapter tests**

Add a manifest fixture with no `subtitle_tracks` and a legacy `layers.subtitles` cue list. Assert that `manifestToEditorState()` creates an `subtitles-original` track with labeled items and that `editorStateToManifest()` writes edited text and millisecond boundaries back into `layers.subtitles` without mutating the source.

```js
it('normalizes legacy layer subtitles into a visible original track', () => {
  const state = manifestToEditorState({
    timeline: {trim: {start_sec: 0, end_sec: 4}},
    layers: {subtitles: {cues: [{text: 'Hola', startMs: 500, endMs: 1500}]}},
  });
  expect(state.tracks.find((track) => track.id === 'subtitles-original').items[0])
    .toMatchObject({text: 'Hola', start: 0.5, end: 1.5});
});

it('round-trips legacy cue edits without mutating the source manifest', () => {
  const source = {timeline: {trim: {start_sec: 0, end_sec: 4}}, layers: {subtitles: {cues: [{text: 'Hola', startMs: 500, endMs: 1500}]}}};
  const state = manifestToEditorState(source);
  state.tracks.find((track) => track.id === 'subtitles-original').items[0].text = 'Hello';
  const next = editorStateToManifest(state, source);
  expect(next.layers.subtitles.cues[0]).toMatchObject({text: 'Hello', startMs: 500, endMs: 1500});
  expect(source.layers.subtitles.cues[0].text).toBe('Hola');
});
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run `npm test -- --run src/editor/designcomboAdapter.test.js` from `dashboard`. Expected: the legacy-track test fails because the adapter currently only reads `subtitle_tracks`.

- [ ] **Step 3: Implement legacy normalization and round-trip mapping**

Create one synthetic `original` subtitle track when `manifest.subtitle_tracks` has no original track and `manifest.layers.subtitles` contains cues. Preserve cue ids and store `trackIdRef: 'original'`. In `editorStateToManifest`, update the matching `layers.subtitles.cues` array from the `subtitles-original` editor items, copying all unrelated manifest fields.

- [ ] **Step 4: Run adapter tests**

Run `npm test -- --run src/editor/designcomboAdapter.test.js`. Expected: all adapter tests pass.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/editor/designcomboAdapter.js dashboard/src/editor/designcomboAdapter.test.js
git commit -m "feat: normalize legacy subtitle layers for timeline editing"
```

### Task 2: Add inline cue-bar editing

**Files:**
- Modify: `dashboard/src/components/editor/DesignComboTimeline.jsx`
- Test: `dashboard/src/components/editor/DesignComboTimeline.test.jsx`

- [ ] **Step 1: Write failing timeline tests**

Add tests that select a subtitle cue, enter edit mode with double-click, commit a replacement with Enter, and cancel a replacement with Escape. Assert `onStateChange` receives the updated cue text only after commit.

```jsx
it('edits a subtitle label inline and commits on Enter', () => {
  const onStateChange = vi.fn();
  render(<DesignComboTimeline state={subtitleState} onStateChange={onStateChange} />);
  fireEvent.doubleClick(screen.getByRole('button', {name: 'Hola clip'}));
  const input = screen.getByRole('textbox', {name: 'Edit subtitle Hola'});
  fireEvent.change(input, {target: {value: 'Hello'}});
  fireEvent.keyDown(input, {key: 'Enter'});
  expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({
    tracks: expect.arrayContaining([expect.objectContaining({items: expect.arrayContaining([expect.objectContaining({text: 'Hello'})])})]),
  }));
});

it('cancels inline subtitle edits with Escape', () => {
  const onStateChange = vi.fn();
  render(<DesignComboTimeline state={subtitleState} onStateChange={onStateChange} />);
  fireEvent.doubleClick(screen.getByRole('button', {name: 'Hola clip'}));
  const input = screen.getByRole('textbox', {name: 'Edit subtitle Hola'});
  fireEvent.change(input, {target: {value: 'Discarded'}});
  fireEvent.keyDown(input, {key: 'Escape'});
  expect(screen.queryByRole('textbox', {name: 'Edit subtitle Hola'})).not.toBeInTheDocument();
  expect(onStateChange).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run focused timeline tests and verify failure**

Run `npm test -- --run src/components/editor/DesignComboTimeline.test.jsx`. Expected: the new tests fail because cue bars are not editable inputs.

- [ ] **Step 3: Implement inline editing**

Track `editingItemId` and `draftText` in `DesignComboTimeline`. For subtitle items, handle `onDoubleClick` and Enter on the selected cue to render a labeled input inside the bar. Commit on Enter or blur by replacing only that item’s `text`, `label`, and `captions` text fields; Escape restores the non-editing bar without emitting a draft update. Stop pointer propagation from the input so typing cannot start a drag.

- [ ] **Step 4: Preserve existing drag/resize behavior**

Keep pointer handlers on the cue bar and resize handles. When inline editing is active, ignore drag starts from the input; movement and resize continue to use `moveCue` and `resizeCue` with `1000 / fps` minimum timing.

- [ ] **Step 5: Run focused tests and lint**

Run `npm test -- --run src/components/editor/DesignComboTimeline.test.jsx` and `npm run lint` from `dashboard`. Expected: all focused tests pass with no lint errors.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/components/editor/DesignComboTimeline.jsx dashboard/src/components/editor/DesignComboTimeline.test.jsx
git commit -m "feat: edit subtitle cue text inline on timeline"
```

### Task 3: Verify full-screen draft integration

**Files:**
- Modify: `dashboard/src/components/editor/FullScreenEditor.jsx`
- Test: `dashboard/src/components/editor/FullScreenEditor.test.jsx`

- [ ] **Step 1: Add a full-screen integration test**

Use an initial manifest containing only `layers.subtitles`, open the editor, double-click the visible cue, commit new text, and assert the timeline state reflects the new value while the original manifest object remains unchanged.

- [ ] **Step 2: Run the integration test and verify failure**

Run `npm test -- --run src/components/editor/FullScreenEditor.test.jsx`. Expected: failure until the adapter fallback and timeline editor are connected.

- [ ] **Step 3: Wire active subtitle track state**

Ensure the editor selects `original` when the fallback track is created, passes the current draft subtitle tracks to the translation panel, and keeps translated tracks separate after an inline edit.

- [ ] **Step 4: Run dashboard verification**

Run `npm test -- --run`, `npm run lint`, and `npm run build` from `dashboard`. Expected: all tests pass, lint is clean, and Vite builds successfully.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/components/editor/FullScreenEditor.jsx dashboard/src/components/editor/FullScreenEditor.test.jsx
git commit -m "test: verify inline subtitle edits in full-screen editor"
```

### Task 4: Deploy and smoke-test subtitle editing

**Files:**
- Modify: none unless verification finds a configuration mismatch.

- [ ] **Step 1: Deploy the branch locally**

Run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy-local.ps1 -KubeContext docker-desktop` from the repository root.

- [ ] **Step 2: Verify rollouts and health**

Run:

```powershell
kubectl --context docker-desktop get pods -n openshorts
kubectl --context docker-desktop rollout status deployment/openshorts-backend -n openshorts --timeout=180s
kubectl --context docker-desktop rollout status deployment/openshorts-frontend -n openshorts --timeout=180s
kubectl --context docker-desktop rollout status deployment/openshorts-renderer -n openshorts --timeout=180s
curl.exe -sS -o NUL -w "frontend %{http_code}\n" -H "Host: openshorts.127.0.0.1.nip.io" http://127.0.0.1/
curl.exe -sS -o NUL -w "backend %{http_code}\n" -H "Host: openshorts.127.0.0.1.nip.io" http://127.0.0.1/openapi.json
```

Expected: one ready pod per deployment, frontend 200, backend 200, and renderer rollout successful.

