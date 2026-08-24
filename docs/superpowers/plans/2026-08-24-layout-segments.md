# Per-Section Standard and Streamer Layouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a CapCut-style Layout timeline track that lets users split a clip and alternate Standard and Streamer video layouts while keeping subtitles and hooks continuous and stable.

**Architecture:** Store contiguous layout segments in `layers.layout.segments`, with legacy `layers.layout.format` remaining the fallback for old manifests. The editor owns segment editing and persistence; both the dashboard preview composition and the root Remotion render composition resolve the active segment from the current frame. Layout transitions affect only the video layer, while subtitles and hooks remain outside the segment composition.

**Tech Stack:** React, Vitest, Remotion, TypeScript, JavaScript manifest adapters, IndexedDB/local editor history, Vite dashboard, Node render service.

---

## Files and responsibilities

### New files

- `dashboard/src/editor/layoutTimelineModel.js` — pure layout-segment normalization, split, update, and active-segment helpers.
- `dashboard/src/editor/layoutTimelineModel.test.js` — model tests for defaults, splitting, validation, and frame resolution.
- `dashboard/src/components/local-editor/LayoutSegmentInspector.jsx` — selected-layout controls for Standard/Streamer and Cut/Crossfade.
- `dashboard/src/components/local-editor/LayoutSegmentInspector.test.jsx` — isolated inspector interaction tests.

### Modified files

- `dashboard/src/components/local-editor/localEditorPersistence.js` and `.test.js` — persist and normalize `layoutSegments` in editor history.
- `dashboard/src/components/local-editor/LocalEditorTimeline.jsx` and `.test.jsx` — render and test the dedicated Layout track.
- `dashboard/src/components/local-editor/LocalEditorTab.jsx` and `.test.jsx` — own layout selection, split/update actions, preview props, and export props.
- `dashboard/src/components/editor/FullScreenEditor.jsx` and `.test.jsx` — convert layout segments between manifest and local editor state and retain them in saved versions.
- `dashboard/src/editor/designcomboAdapter.js` and `.test.js` — preserve layout segments during generic manifest/render-prop conversion.
- `dashboard/src/components/local-editor/localEditorRender.js` and `.test.js` — include layout in browser/backend local-render props.
- `dashboard/src/remotion/lib/types.ts` and `dashboard/src/remotion/compositions/ShortVideo.tsx` — preview layout types and per-frame video composition.
- `dashboard/src/remotion/compositions/ShortVideo.test.tsx` — preview segment and overlay tests.
- `remotion/src/lib/types.ts`, `remotion/src/lib/layoutSegments.ts`, and `remotion/src/compositions/ShortVideo.tsx` — exported layout types, shared render resolver, and per-frame video composition.
- `render-service/src/version-manifest.ts` and `.test.ts` — preserve legacy/new layout data for version renders.
- `render-service/src/layoutSegments.test.ts` — test the root Remotion resolver through the existing Vitest setup.

Before editing existing symbols in implementation tasks, run GitNexus `impact` upstream for each symbol, report the blast radius, and stop for review if any result is HIGH or CRITICAL.

---

### Task 1: Add the pure layout-segment model

**Files:**

- Create: `dashboard/src/editor/layoutTimelineModel.js`
- Test: `dashboard/src/editor/layoutTimelineModel.test.js`

- [ ] **Step 1: Write the failing tests**

Add tests for the default segment, interior split, boundary rejection, normalization, active-segment lookup, layout update, and transition update. The essential expectations are:

```js
expect(createLayoutSegments(12000)).toEqual([
  {
    id: "layout-1",
    startMs: 0,
    endMs: 12000,
    format: "standard",
    transition: "cut",
    transitionDurationMs: 250,
  },
]);

const source = [{
  id: "layout-1",
  startMs: 0,
  endMs: 12000,
  format: "streamer_stack",
  transition: "crossfade",
  transitionDurationMs: 400,
}];
expect(splitLayoutSegment(source, "layout-1", 5000)).toEqual([
  { ...source[0], endMs: 5000 },
  { ...source[0], id: "layout-1-split-1", startMs: 5000 },
]);
expect(splitLayoutSegment(source, "layout-1", 0)).toBeNull();
expect(getLayoutSegmentAt(source, 5000).id).toBe("layout-1");
```

- [ ] **Step 2: Run the tests and verify the expected RED state**

Run from `dashboard`:

```powershell
npm test -- src/editor/layoutTimelineModel.test.js --run
```

Expected: the import fails because the model file and exports do not exist.

- [ ] **Step 3: Implement the model**

Export `createLayoutSegments`, `normalizeLayoutSegments`, `splitLayoutSegment`, `updateLayoutSegment`, and `getLayoutSegmentAt`. Normalize format to `standard` or `streamer_stack`, transition to `cut` or `crossfade`, clamp times to `[0, durationMs]`, remove zero-length ranges, sort by start time, and close gaps so valid segments remain contiguous. Preserve IDs and generate deterministic `-split-N` IDs. Use `250` ms as the default transition duration and clamp crossfades to adjacent segment durations.

- [ ] **Step 4: Run the tests and verify GREEN**

```powershell
npm test -- src/editor/layoutTimelineModel.test.js --run
```

Expected: all model tests pass.

- [ ] **Step 5: Commit the model**

```powershell
git add dashboard/src/editor/layoutTimelineModel.js dashboard/src/editor/layoutTimelineModel.test.js
git commit -m "feat(editor): add layout segment timeline model"
```

### Task 2: Persist layout segments and adapt manifests

**Files:**

- Modify: `dashboard/src/components/local-editor/localEditorPersistence.js`
- Test: `dashboard/src/components/local-editor/localEditorPersistence.test.js`
- Modify: `dashboard/src/components/editor/FullScreenEditor.jsx`
- Test: `dashboard/src/components/editor/FullScreenEditor.test.jsx`
- Modify: `dashboard/src/editor/designcomboAdapter.js`
- Test: `dashboard/src/editor/designcomboAdapter.test.js`

- [ ] **Step 1: Write failing persistence and adapter tests**

Assert that `createEmptyEditorHistory()` includes `layoutSegments: []`, stored projects retain normalized segments, legacy histories load without errors, and manifest conversion maps `layers.layout.segments` to `localState.layoutSegments` and back without dropping subtitles, hooks, effects, or publishing metadata.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
npm test -- src/components/local-editor/localEditorPersistence.test.js src/components/editor/FullScreenEditor.test.jsx src/editor/designcomboAdapter.test.js --run
```

Expected: failures show that `layoutSegments` is absent or dropped during conversion.

- [ ] **Step 3: Implement persistence and manifest conversion**

Use `normalizeLayoutSegments` at the state boundary. When reading a manifest, choose the fallback format in this order: `layers.layout.format`, `export_policy.layout_format`, clip layout, then `standard`. When writing, keep the clip-level `format` and `facecam_size` fields and add normalized segments. Do not rewrite unrelated layers.

The local editor state must include:

```js
{
  subtitleCues,
  subtitleStyle,
  subtitleLanguage,
  hook,
  markers,
  layoutSegments,
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

```powershell
npm test -- src/components/local-editor/localEditorPersistence.test.js src/components/editor/FullScreenEditor.test.jsx src/editor/designcomboAdapter.test.js --run
```

### Task 3: Add the Layout track and segment inspector

**Files:**

- Modify: `dashboard/src/components/local-editor/LocalEditorTimeline.jsx`
- Test: `dashboard/src/components/local-editor/LocalEditorTimeline.test.jsx`
- Create: `dashboard/src/components/local-editor/LayoutSegmentInspector.jsx`
- Test: `dashboard/src/components/local-editor/LayoutSegmentInspector.test.jsx`
- Modify: `dashboard/src/components/local-editor/LocalEditorTab.jsx`
- Test: `dashboard/src/components/local-editor/LocalEditorTab.test.jsx`

- [ ] **Step 1: Write failing UI tests**

Test that the timeline renders an accessible `Layout track` with Standard and Streamer blocks at the correct widths; selecting a block does not clear subtitle/hook selection; splitting creates two inherited blocks; changing the selected block affects only that block; Cut/Crossfade controls work; and Crossfade alone reveals the duration control.

- [ ] **Step 2: Run focused UI tests and verify RED**

```powershell
npm test -- src/components/local-editor/LocalEditorTimeline.test.jsx src/components/local-editor/LayoutSegmentInspector.test.jsx src/components/local-editor/LocalEditorTab.test.jsx --run
```

- [ ] **Step 3: Implement the track and inspector**

Add `layoutSegments`, `selectedLayoutSegmentId`, `onLayoutSelect`, and `onLayoutChange` props to `LocalEditorTimeline`. Render a segment-specific track using the existing timeline width/playhead geometry. Give Standard and Streamer distinct colors and show the segment label.

Add separate layout selection state in `LocalEditorTab` so Layout selection never changes `selected`, which remains responsible for subtitle/hook selection. Wire the following actions through `commitEdit` so undo/redo records them:

```js
const splitLayoutAtPlayhead = () => {
  commitEdit((current) => {
    const next = splitLayoutSegment(
      current.layoutSegments,
      selectedLayoutSegmentId,
      playheadMs,
    );
    return next ? { ...current, layoutSegments: next } : current;
  });
};
```

`LayoutSegmentInspector` must expose Standard, Streamer, Cut, Crossfade, and Crossfade duration controls, plus the split action. It must reuse the clip’s existing Streamer settings and never add per-segment region editors.

- [ ] **Step 4: Run focused UI tests and verify GREEN**

```powershell
npm test -- src/components/local-editor/LocalEditorTimeline.test.jsx src/components/local-editor/LayoutSegmentInspector.test.jsx src/components/local-editor/LocalEditorTab.test.jsx --run
```

### Task 4: Resolve layout segments in the dashboard preview

**Files:**

- Modify: `dashboard/src/remotion/lib/types.ts`
- Modify: `dashboard/src/remotion/compositions/ShortVideo.tsx`
- Test: `dashboard/src/remotion/compositions/ShortVideo.test.tsx`
- Modify: `dashboard/src/components/local-editor/LocalEditorTab.jsx`

- [ ] **Step 1: Write failing composition tests**

Test legacy `{ format: "standard" }` as one full-duration Standard segment, test format resolution before and after a segment boundary, test Crossfade as video-only behavior, and assert that subtitles/hooks remain outside the segment video layer and are not repeated per segment.

- [ ] **Step 2: Run the focused composition tests and verify RED**

```powershell
npm test -- src/remotion/compositions/ShortVideo.test.tsx --run
```

Expected: the current composition only reads `layout.format` and has no segment resolver.

- [ ] **Step 3: Extend dashboard layout types and implement frame resolution**

Extend `LayoutConfig` with:

```ts
segments?: Array<{
  id: string;
  startMs: number;
  endMs: number;
  format: "standard" | "streamer_stack";
  transition?: "cut" | "crossfade";
  transitionDurationMs?: number;
}>;
```

Use a single layout-video layer whose `objectFit`, Standard blur background, and transition opacity are resolved from `useCurrentFrame()`. Keep `<Subtitles>` and `<HookOverlay>` outside that layer. Do not create one subtitle or hook component per layout segment.

- [ ] **Step 4: Pass edited layout state into preview props**

In `LocalEditorTab`, derive `previewLayout` from `layoutSegments` plus the existing clip-level Streamer settings and pass it to `RemotionPreview`. Keep the incoming `remotionPreviewProps.layout` as the fallback for callers without editable layout state.

- [ ] **Step 5: Run focused preview tests and verify GREEN**

```powershell
npm test -- src/remotion/compositions/ShortVideo.test.tsx src/components/local-editor/LocalEditorTab.test.jsx --run
```

### Task 5: Mirror segmented layout behavior in exported Remotion renders

**Files:**

- Modify: `remotion/src/lib/types.ts`
- Modify: `remotion/src/compositions/ShortVideo.tsx`
- Create: `remotion/src/lib/layoutSegments.ts`
- Test: `render-service/src/layoutSegments.test.ts`
- Modify: `render-service/src/version-manifest.ts`
- Test: `render-service/src/version-manifest.test.ts`
- Modify: `dashboard/src/components/local-editor/localEditorRender.js`
- Test: `dashboard/src/components/local-editor/localEditorRender.test.js`

- [ ] **Step 1: Write failing render tests**

Assert that version manifests with `layers.layout.segments` produce render props containing the same segment list; legacy manifests produce the existing single-layout props; local editor backend/browser render props include `layout`; and the root composition uses the same active-segment rules as the dashboard preview. Include an overlay assertion that a subtitle and hook spanning a boundary are each rendered once.

- [ ] **Step 2: Run focused render tests and verify RED**

From `dashboard`:

```powershell
npm test -- src/components/local-editor/localEditorRender.test.js --run
```

From `render-service`:

```powershell
npm test -- src/version-manifest.test.ts src/layoutSegments.test.ts --run
```

Expected: local render props omit layout and the shared root resolver does not yet support segments.

- [ ] **Step 3: Extend root Remotion types and version conversion**

Mirror the dashboard `LayoutConfig` segment shape in `remotion/src/lib/types.ts`, allow `segments` in `layoutConfigSchema`, and ensure `manifestToVersionRenderProps` clones the complete layout object without dropping segments.

- [ ] **Step 4: Implement the root Remotion composition**

Mirror the dashboard per-frame resolver and video-only transition behavior in `remotion/src/compositions/ShortVideo.tsx`. Keep `Subtitles` and `HookOverlay` outside the video layer exactly as in the approved render order. If hook rendering requires a change, preserve one `Sequence` covering the hook’s original time range and do not derive a new hook instance per layout segment.

- [ ] **Step 5: Forward layout through local editor render props**

Add `layout` to `buildRemotionRenderProps`, `renderLocalVideoOnBrowser`, `renderLocalVideoOnBackend`, and `burnLocalEditorSubtitles` where applicable. Pass the active editor layout from `LocalEditorTab` into those functions.

- [ ] **Step 6: Run render-focused tests and verify GREEN**

```powershell
cd dashboard
npm test -- src/components/local-editor/localEditorRender.test.js --run
cd ..\render-service
npm test -- src/version-manifest.test.ts src/layoutSegments.test.ts --run
npm run build
cd ..\remotion
npm run build
```

### Task 6: Full verification and commit

- [ ] **Step 1: Run required dashboard formatting and linting**

```powershell
cd dashboard
npm run format
npm run format:check
npm run lint
```

- [ ] **Step 2: Run all dashboard tests**

```powershell
npm test -- --run
```

- [ ] **Step 3: Run render-service tests and build**

```powershell
cd ..\render-service
npm test
npm run build
```

- [ ] **Step 4: Build the root Remotion package**

```powershell
cd ..\remotion
npm run build
```

- [ ] **Step 5: Run backend tests if any API/render-prop files were touched**

```powershell
cd ..\backend-go
go test ./...
```

- [ ] **Step 6: Review the diff and run GitNexus change detection**

From the repository root:

```powershell
git diff --check
git status --short
```

Run GitNexus `detect_changes({ repo: "openshorts", scope: "all" })` before committing. Confirm only the planned dashboard, Remotion, render-service, and test files changed; investigate any unrelated symbols or execution flows.

- [ ] **Step 7: Commit the implementation**

```powershell
git add dashboard/src/editor/layoutTimelineModel.js dashboard/src/editor/layoutTimelineModel.test.js dashboard/src/components/local-editor dashboard/src/components/editor/FullScreenEditor.jsx dashboard/src/components/editor/FullScreenEditor.test.jsx dashboard/src/editor/designcomboAdapter.js dashboard/src/editor/designcomboAdapter.test.js dashboard/src/remotion remotion/src render-service/src
git commit -m "feat(editor): alternate layouts across timeline segments"
```

### Task 7: Apply and smoke-test the live app

- [ ] **Step 1: Restart the frontend and renderer**

```powershell
cd ..
.\scripts\manage-local.ps1 -Action Restart -Component frontend
.\scripts\manage-local.ps1 -Action Restart -Component renderer
```

If the local script reports that the Remotion bundle is owned by a different component, restart the reported component as well before testing.

- [ ] **Step 2: Check status and health**

```powershell
.\scripts\manage-local.ps1 -Action Status
Invoke-WebRequest -UseBasicParsing http://localhost:18000/health
```

- [ ] **Step 3: Verify the editor in Brave**

Open a project clip and verify:

1. The Layout track starts with one Standard block.
2. Splitting at an interior playhead creates two Standard blocks.
3. Changing only the right block to Streamer updates the preview after the cut.
4. A second split supports Standard → Streamer → Standard.
5. Subtitles do not restart, duplicate, or disappear at boundaries.
6. A hook spanning a boundary does not restart or jump position.
7. Crossfade changes only the video composition.
8. Saving, refreshing, and reopening the version preserves the Layout track.
9. Exported output matches the preview.

- [ ] **Step 4: Report the commit, test results, live services, and any unrelated worktree state**
