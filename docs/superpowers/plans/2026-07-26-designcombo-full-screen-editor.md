# DesignCombo Full-Screen Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cue-only editor with a full-screen multi-track video editor using the DesignCombo timeline/state packages while preserving OpenShorts' Remotion preview, immutable versions, and server-side H.264/MP4 rendering.

**Architecture:** The editor owns a draft timeline and maps it to/from the existing clip manifest through a pure adapter. DesignCombo provides timeline interaction state and canvas rendering; OpenShorts owns the viewer, inspectors, media pool, version history, translation workflow, and export persistence. The existing version render API remains the only path that can promote a master output.

**Tech Stack:** React 18/Vite, DesignCombo state/timeline/types packages, Remotion Player, Vitest/Testing Library, existing FastAPI version APIs, existing TypeScript render service.

---

### Task 1: Add DesignCombo dependencies and define the manifest/timeline adapter

**Files:**
- Modify: `dashboard/package.json`
- Modify: `dashboard/package-lock.json`
- Create: `dashboard/src/editor/designcomboAdapter.js`
- Create: `dashboard/src/editor/designcomboAdapter.test.js`

- [ ] **Step 1: Write the failing adapter tests**

Create tests for a manifest containing a source clip, hook, original subtitles, a translated track, and effects:

```js
it('maps every manifest layer to stable editor tracks', () => {
  const state = manifestToEditorState(manifest);
  expect(state.tracks.map((track) => track.id)).toEqual(['video-1', 'audio-1', 'hook', 'subtitles-original', 'subtitles-es', 'effects']);
  expect(state.tracks.find((track) => track.id === 'subtitles-es').items[0]).toMatchObject({start: 1.2, end: 2.4, type: 'subtitle'});
});

it('round-trips timing without mutating the source manifest', () => {
  const state = manifestToEditorState(manifest);
  state.tracks.find((track) => track.id === 'hook').items[0].start = 1.5;
  const next = editorStateToManifest(state, manifest);
  expect(next.layers.hook.startMs).toBe(1500);
  expect(manifest.layers.hook.startMs).not.toBe(1500);
});

it('preserves frame-accurate boundaries at the clip fps', () => {
  const state = manifestToEditorState(manifest, {fps: 29.97});
  expect(state.durationFrames).toBe(Math.round(12.5 * 29.97));
});
```

- [ ] **Step 2: Run the adapter tests and verify failure**

Run from `dashboard`:

```bash
npm test -- --run src/editor/designcomboAdapter.test.js
```

Expected: FAIL because the adapter module and DesignCombo packages do not exist.

- [ ] **Step 3: Install the modular DesignCombo packages**

Run:

```bash
npm install @designcombo/state@5.5.8 @designcombo/timeline@5.5.8 @designcombo/types@5.5.8
```

Keep the current React 18/Vite application and do not install the separate Next.js editor application.

- [ ] **Step 4: Implement the pure adapter**

Export these functions from `designcomboAdapter.js`:

```js
export function manifestToEditorState(manifest, {fps = 30} = {}) {}
export function editorStateToManifest(state, sourceManifest) {}
export function editorStateToDesignComboItems(state) {}
export function designComboItemsToEditorState(items, state) {}
```

Use seconds for timeline item positions, milliseconds for manifest cue/hook values, and `Math.round(seconds * fps)` for frame boundaries. Include stable track/item ids so selection survives undo/redo and version branching. Deep-clone the source manifest before writing any draft values.

- [ ] **Step 5: Run the adapter tests**

Run the focused test again. Expected: all adapter tests pass.

- [ ] **Step 6: Commit**

```bash
git add dashboard/package.json dashboard/package-lock.json dashboard/src/editor/designcomboAdapter.js dashboard/src/editor/designcomboAdapter.test.js
git commit -m "feat: add DesignCombo manifest timeline adapter"
```

### Task 2: Build the full-screen editor route and viewer transport

**Files:**
- Create: `dashboard/src/components/editor/FullScreenEditor.jsx`
- Create: `dashboard/src/components/editor/TransportControls.jsx`
- Create: `dashboard/src/components/editor/FullScreenEditor.test.jsx`
- Modify: `dashboard/src/components/RemotionPreview.jsx`
- Modify: `dashboard/src/App.jsx`

- [ ] **Step 1: Write failing route/workspace tests**

Test that opening a clip editor renders the media pool, viewer, transport controls, timeline host, inspector, and version history regions; the transport seeks the preview; and Cancel closes without changing the current clip URL.

```jsx
it('renders the full editor workspace and seeks the preview', async () => {
  render(<FullScreenEditor jobId="job" clipIndex={0} clip={clip} onClose={onClose} />);
  expect(screen.getByRole('heading', {name: /media pool/i})).toBeInTheDocument();
  expect(screen.getByRole('region', {name: /timeline/i})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', {name: /next frame/i}));
  expect(screen.getByTestId('remotion-player-frame')).toHaveTextContent('1');
});
```

- [ ] **Step 2: Run the focused test and verify failure**

```bash
npm test -- --run src/components/editor/FullScreenEditor.test.jsx
```

Expected: FAIL because the full-screen route and transport controls do not exist.

- [ ] **Step 3: Extend `RemotionPreview` with controlled playback**

Add a `playerRef`, `currentFrame`, `playing`, `onFrameChange`, and `onPlayingChange` interface. Use `seekTo()` for controlled playhead updates and `useCurrentFrame` callbacks only for UI synchronization. Keep the existing subtitle track, hook, effects, and source URL props unchanged.

- [ ] **Step 4: Implement the workspace shell and transport controls**

`FullScreenEditor` must render a full viewport overlay with named regions:

```jsx
<section aria-label="Media Pool" />
<section aria-label="Viewer" />
<section aria-label="Timeline" />
<aside aria-label="Inspector" />
<aside aria-label="Version History" />
```

`TransportControls` provides play/pause, previous frame, next frame, timecode, fit/zoom, and a 25/50/100/200% timeline zoom selector. Keyboard shortcuts are `Space`, `ArrowLeft`, `ArrowRight`, and `J/K/L` for reverse/stop/forward.

- [ ] **Step 5: Add a dedicated editor route**

Add a route/state transition in `App.jsx` that opens `FullScreenEditor` from the clip action. Keep the existing legacy modals available and do not replace the clip URL until a version completion callback succeeds.

- [ ] **Step 6: Run focused tests and commit**

```bash
npm test -- --run src/components/editor/FullScreenEditor.test.jsx
git add dashboard/src/components/editor/FullScreenEditor.jsx dashboard/src/components/editor/TransportControls.jsx dashboard/src/components/editor/FullScreenEditor.test.jsx dashboard/src/components/RemotionPreview.jsx dashboard/src/App.jsx
git commit -m "feat: add full-screen editor workspace and transport"
```

### Task 3: Integrate the multi-track DesignCombo timeline

**Files:**
- Create: `dashboard/src/components/editor/DesignComboTimeline.jsx`
- Create: `dashboard/src/components/editor/TrackControls.jsx`
- Create: `dashboard/src/components/editor/DesignComboTimeline.test.jsx`
- Modify: `dashboard/src/components/editor/FullScreenEditor.jsx`

- [ ] **Step 1: Write failing timeline interaction tests**

Cover rendering V1/A1/Hook/subtitle/translation/effects tracks, selecting an item, moving an item with snapping, resizing both edges, splitting at the playhead, zooming, and mute/lock/visibility controls.

```jsx
it('moves and snaps an item through the adapter callback', () => {
  render(<DesignComboTimeline state={state} onStateChange={onStateChange} />);
  fireEvent.pointerDown(screen.getByRole('button', {name: /hook clip/i}), {clientX: 100});
  fireEvent.pointerMove(window, {clientX: 220});
  fireEvent.pointerUp(window);
  expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({snapTarget: expect.any(Number)}));
});
```

- [ ] **Step 2: Run the test and verify failure**

```bash
npm test -- --run src/components/editor/DesignComboTimeline.test.jsx
```

Expected: FAIL because the DesignCombo timeline host does not exist.

- [ ] **Step 3: Implement the timeline host**

Create the DesignCombo timeline instance against a canvas ref, configure track/item types and clip duration, subscribe to interaction events, and convert emitted item changes through `designComboItemsToEditorState`. Render a DOM track header beside the canvas for labels and controls so accessibility and mute/lock/visibility actions remain testable.

The timeline must use the current fps for snapping and frame boundaries. Minimum item duration is one frame. Split creates two items with contiguous frame boundaries and never mutates the saved manifest.

- [ ] **Step 4: Add track controls and timeline zoom**

Implement mute, solo, lock, visibility, and per-track selection. Preserve these as draft UI state and map mute/volume/visibility to the manifest layers where supported. Zoom changes the DesignCombo scale without changing item times.

- [ ] **Step 5: Run tests and commit**

```bash
npm test -- --run src/components/editor/DesignComboTimeline.test.jsx
git add dashboard/src/components/editor/DesignComboTimeline.jsx dashboard/src/components/editor/TrackControls.jsx dashboard/src/components/editor/DesignComboTimeline.test.jsx dashboard/src/components/editor/FullScreenEditor.jsx
git commit -m "feat: add DesignCombo multi-track timeline"
```

### Task 4: Add media pool, inspector panels, and subtitle translation selection

**Files:**
- Create: `dashboard/src/components/editor/MediaPool.jsx`
- Create: `dashboard/src/components/editor/InspectorPanel.jsx`
- Create: `dashboard/src/components/editor/AudioInspector.jsx`
- Create: `dashboard/src/components/editor/MediaPoolInspector.test.jsx`
- Modify: `dashboard/src/components/editor/HookInspector.jsx`
- Modify: `dashboard/src/components/editor/SubtitleCueInspector.jsx`
- Modify: `dashboard/src/components/SubtitleTranslationPanel.jsx`

- [ ] **Step 1: Write failing inspector/media tests**

Test media pool loading from the manifest and version list, historical version selection, context-sensitive inspector rendering, audio mute/volume edits, hook edits, subtitle edits, and selecting Original/English/other translated tracks.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
npm test -- --run src/components/editor/MediaPoolInspector.test.jsx
```

Expected: FAIL because the media pool and inspector shell do not exist.

- [ ] **Step 3: Implement the media pool**

Render stable asset cards for source media, every rendered version, and subtitle tracks. Selecting a version loads its immutable manifest into a new draft; it never mutates the current pointer. Keep media URLs routed through the existing video proxy helper.

- [ ] **Step 4: Implement the inspector panel**

Dispatch by selected item type to the existing hook/subtitle inspectors and a new audio inspector. All edits update the draft state through the adapter and are undoable. Use controlled inputs and frame-accurate numeric fields for timing.

- [ ] **Step 5: Integrate translation tracks**

Render `SubtitleTranslationPanel` inside the subtitle inspector. Pass the selected version's current draft tracks to the translation API, merge returned tracks without discarding earlier unsaved translations, and keep audio unchanged. English remains selectable for non-English source tracks.

- [ ] **Step 6: Run tests and commit**

```bash
npm test -- --run src/components/editor/MediaPoolInspector.test.jsx src/components/SubtitleTranslationPanel.test.jsx
git add dashboard/src/components/editor/MediaPool.jsx dashboard/src/components/editor/InspectorPanel.jsx dashboard/src/components/editor/AudioInspector.jsx dashboard/src/components/editor/MediaPoolInspector.test.jsx dashboard/src/components/editor/HookInspector.jsx dashboard/src/components/editor/SubtitleCueInspector.jsx dashboard/src/components/SubtitleTranslationPanel.jsx
git commit -m "feat: add media pool inspectors and translation tracks"
```

### Task 5: Implement version save, render polling, branching, and failure preservation

**Files:**
- Create: `dashboard/src/editor/renderVersion.js`
- Create: `dashboard/src/editor/renderVersion.test.js`
- Modify: `dashboard/src/components/editor/FullScreenEditor.jsx`
- Modify: `dashboard/src/components/editor/VersionHistory.jsx`

- [ ] **Step 1: Write failing render workflow tests**

Test that saving creates a child version, sends the complete Remotion props, polls until done, completes the version with the output URL, refreshes history, and leaves the current URL unchanged when rendering fails.

```js
it('does not promote the current output when the new render fails', async () => {
  const result = await saveAndRenderVersion({api, draft, parentVersionId: 'v3'});
  expect(result.status).toBe('failed');
  expect(api.complete).toHaveBeenCalledWith(expect.objectContaining({error: expect.any(String)}));
  expect(api.promote).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the focused tests and verify failure**

```bash
npm test -- --run src/editor/renderVersion.test.js
```

Expected: FAIL because the version workflow module does not exist.

- [ ] **Step 3: Implement `renderVersion.js`**

Export:

```js
export async function createDraftVersion({jobId, clipIndex, manifest, parentVersionId}) {}
export async function renderDraftVersion({jobId, clipIndex, versionId, props, pollMs = 1200}) {}
export async function saveAndRenderVersion(args) {}
```

The implementation must POST the manifest, POST version render props containing source URL, fps, dimensions, subtitles, subtitle tracks, active track, hook, and effects, poll `/api/render/{renderId}`, and POST `/complete`. Render errors call `/complete` with `error` and never update the clip URL.

- [ ] **Step 4: Wire history and branch actions**

Selecting a historical version loads it into a draft. “Branch from this version” calls the existing branch API and uses the returned version as the new parent. Failed versions cannot be activated.

- [ ] **Step 5: Run tests and commit**

```bash
npm test -- --run src/editor/renderVersion.test.js
git add dashboard/src/editor/renderVersion.js dashboard/src/editor/renderVersion.test.js dashboard/src/components/editor/FullScreenEditor.jsx dashboard/src/components/editor/VersionHistory.jsx
git commit -m "feat: persist full-editor drafts as immutable renders"
```

### Task 6: Complete route integration and end-to-end verification

**Files:**
- Create: `dashboard/src/components/editor/FullScreenEditor.e2e.test.jsx`
- Modify: `dashboard/src/components/ResultCard.jsx`
- Modify: `dashboard/src/components/ResultCard/CardActions.jsx`
- Modify: `dashboard/src/components/editor/FullScreenEditor.jsx`

- [ ] **Step 1: Write the end-to-end editor scenario**

Simulate opening a clip, selecting the source media, adding a hook, dragging its end, selecting the original subtitle track, translating it to English from a non-English source, changing a subtitle cue, branching from an older version, saving a new version, and confirming the old output remains until the new render completes.

- [ ] **Step 2: Run the scenario and verify failure**

```bash
npm test -- --run src/components/editor/FullScreenEditor.e2e.test.jsx
```

Expected: FAIL until route, timeline, inspectors, translation, and persistence are connected.

- [ ] **Step 3: Integrate the full-screen route from `ResultCard`**

Replace the current “Edit Timeline” modal trigger with a full-screen editor route/state transition. Keep Auto Edit, Convert to Native Short, Subtitles, Viral Hook, Dub Voice, Post, and Download buttons working. The editor's successful completion callback updates the card preview/download URL; cancellation does not.

- [ ] **Step 4: Run the full dashboard suite**

```bash
npm test -- --run
npm run lint
npm run build
```

Expected: all existing and new dashboard tests pass with no lint errors.

- [ ] **Step 5: Run renderer and backend regressions**

```bash
cd ../render-service && npm test -- --run && npm run build
cd ..
python -m pytest -q tests/test_version_store.py tests/test_version_api.py tests/test_version_migration.py tests/test_version_end_to_end.py tests/test_subtitle_translation.py tests/test_subtitle_translation_api.py
```

Expected: renderer tests/build and all targeted backend tests pass.

- [ ] **Step 6: Commit the integrated editor**

```bash
git add dashboard/src/components/editor/FullScreenEditor.e2e.test.jsx dashboard/src/components/ResultCard.jsx dashboard/src/components/ResultCard/CardActions.jsx dashboard/src/components/editor/FullScreenEditor.jsx
git commit -m "feat: expose full-screen multi-track video editor"
```

### Task 7: Deploy and verify the local cluster

**Files:**
- Modify: none unless deployment verification finds a configuration mismatch.

- [ ] **Step 1: Build the dashboard and renderer images**

Run from the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy-local.ps1 -KubeContext docker-desktop
```

- [ ] **Step 2: Verify all rollouts**

```powershell
kubectl --context docker-desktop get pods -n openshorts
kubectl --context docker-desktop rollout status deployment/openshorts-backend -n openshorts --timeout=180s
kubectl --context docker-desktop rollout status deployment/openshorts-frontend -n openshorts --timeout=180s
kubectl --context docker-desktop rollout status deployment/openshorts-renderer -n openshorts --timeout=180s
```

Expected: all three deployments have one ready replica and no old pod remains terminating.

- [ ] **Step 3: Verify ingress and renderer health**

```powershell
curl.exe -sS -o NUL -w "frontend %{http_code}\n" -H "Host: openshorts.127.0.0.1.nip.io" http://127.0.0.1/
curl.exe -sS -o NUL -w "backend %{http_code}\n" -H "Host: openshorts.127.0.0.1.nip.io" http://127.0.0.1/openapi.json
kubectl --context docker-desktop exec deployment/openshorts-renderer -n openshorts -- node -e "fetch('http://127.0.0.1:3100/health').then(async r=>{console.log(r.status,await r.text())})"
```

Expected: frontend 200, backend 200, renderer 200 with `{"ok":true}`.

