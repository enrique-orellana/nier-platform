# Version-first editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make every editor edit accumulate in the selected immutable version, keep subtitles optional and track-selectable, and download the exact saved version.

**Architecture:** `FullScreenEditor` owns the draft manifest and exposes a small editor-session API to the parent for modal-generated layers. All render props are derived from that draft, including the active subtitle track. Result-card handlers route editor-open remotion results into the session instead of rendering directly; version save remains the only promotion path.

**Tech Stack:** React, Remotion, FastAPI version API, Vitest, Testing Library.

---

### Task 1: Prove manifest/render synchronization failures

**Files:**
- Modify: `dashboard/src/editor/designcomboAdapter.test.js`
- Modify: `dashboard/src/components/editor/FullScreenEditor.test.jsx`

- [ ] **Step 1: Add failing adapter coverage for optional and active subtitles**

Assert that a manifest with no subtitle tracks produces `subtitles: null` render input, while a manifest with two tracks and one active ID produces captions from only the active track.

- [ ] **Step 2: Add failing editor coverage for accumulated layers**

Render the editor with an existing hook, then call the registered editor session API to add effects and a subtitle track. Assert the preview props and the next save request contain all layers and the selected active track.

- [ ] **Step 3: Add failing coverage for exact-version download**

Render a completed version with `output_url`, click the editor download control, and assert the fetch target is that URL and the anchor filename contains the version ID.

- [ ] **Step 4: Run focused tests and verify the new assertions fail**

```bash
npm test -- --run src/editor/designcomboAdapter.test.js src/components/editor/FullScreenEditor.test.jsx
```

### Task 2: Derive render input from the draft manifest

**Files:**
- Modify: `dashboard/src/components/editor/FullScreenEditor.jsx`
- Modify: `dashboard/src/editor/designcomboAdapter.js`

- [ ] **Step 1: Add active-track-aware manifest render helpers**

Use the selected track ID to build `subtitleTracks`, `activeSubtitleTrackId`, and a subtitle config whose captions come from only that track. Return `subtitles: null` when there is no selected track.

- [ ] **Step 2: Keep active track in the draft manifest before saving**

Make `currentManifest` include `active_subtitle_track_id: activeTrackId || null`, so preview and render use the same state.

- [ ] **Step 3: Expose a session API for parent-generated actions**

Register `{ applyLayer(type, value), setSourceVideo(url), save(), getManifest() }` through a callback prop. `applyLayer` updates the draft editor state and manifest-compatible tracks without promoting a version.

- [ ] **Step 4: Add a version-aware download control**

Use `version.output_url` only when the version is complete. Download with a filename such as `clip-${clipIndex + 1}-${version.version_id.slice(0, 8)}.mp4`; disable the control until an output URL exists.

### Task 3: Route ResultCard actions into the active editor session

**Files:**
- Modify: `dashboard/src/components/ResultCard.jsx`
- Modify: `dashboard/src/components/editor/FullScreenEditor.jsx`

- [ ] **Step 1: Store the editor session API in a ref**

Pass `onSessionReady` from `ResultCard` to `FullScreenEditor` and clear it when the editor closes.

- [ ] **Step 2: Route remotion effects, subtitles, and hooks**

When the editor is open and a handler receives `options.remotion`, `hookData.remotion`, or generated effects, call `editorSessionRef.current.applyLayer(...)` and close the modal. Do not call legacy `/api/render` or update the clip pointer in this path.

- [ ] **Step 3: Route generated base-video actions safely**

For a generated video URL such as dubbing or a legacy fallback, call `setSourceVideo(url)` in the editor session so the draft references the latest base while preserving its accumulated layers. Keep the existing card-only behavior when no editor session is active.

- [ ] **Step 4: Make Convert to Native Short save the draft**

When invoked from the editor, call the registered `save()` API instead of rendering `activeLayers` through the card workflow.

### Task 4: Verify version persistence and download behavior

**Files:**
- Modify: `dashboard/src/components/editor/FullScreenEditor.test.jsx`
- Modify: `dashboard/src/editor/designcomboAdapter.test.js`

- [ ] **Step 1: Run focused tests**

```bash
npm test -- --run src/editor/designcomboAdapter.test.js src/components/editor/FullScreenEditor.test.jsx
```

- [ ] **Step 2: Run the full dashboard suite**

```bash
npm test -- --run
npm run lint
npm run build
```

- [ ] **Step 3: Commit the implementation**

```bash
git add dashboard/src/components/editor/FullScreenEditor.jsx dashboard/src/components/ResultCard.jsx dashboard/src/editor/designcomboAdapter.js dashboard/src/components/editor/FullScreenEditor.test.jsx dashboard/src/editor/designcomboAdapter.test.js
git commit -m "fix: make editor versions accumulate all edits"
```

- [ ] **Step 4: Deploy and verify the local cluster**

```bash
./scripts/deploy-local.ps1 -KubeContext docker-desktop
kubectl --context docker-desktop -n openshorts get pods
curl.exe -s -o NUL -w "%{http_code}" http://openshorts.127.0.0.1.nip.io/
```

Expected: all deployments roll out, pods are `Running`, and the ingress returns `200`.
