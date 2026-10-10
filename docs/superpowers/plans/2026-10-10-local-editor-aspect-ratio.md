# Local Editor Aspect Ratio Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users see a clip's source ratio, select an output ratio, preview the matching frame, and export with that ratio.

**Architecture:** Add a focused aspect-ratio module for the preset list, dimension resolver, source-ratio formatter, and coordinate scaling. Persist the selected ratio in the existing editor history snapshot with a legacy-safe 9:16 default. Pass the resolved canvas dimensions to the local preview, position inspectors, Details panel, and existing export request.

**Tech Stack:** React, JavaScript, Tailwind CSS, localStorage/IndexedDB editor persistence, existing Remotion preview and backend render request.

---

## Files and responsibilities

- Create `dashboard/src/components/local-editor/localEditorAspectRatio.js` for ratio options, normalization, source-ratio formatting, target dimensions, and proportional coordinate conversion.
- Modify `dashboard/src/components/local-editor/localEditorPersistence.js` to include `aspectRatio` in empty and normalized history snapshots. Legacy snapshots resolve to `9:16`.
- Modify `dashboard/src/components/local-editor/LocalEditorTab.jsx` to own the ratio selection, collect source dimensions, render the ratio selector, size the preview, pass active dimensions to inspectors and Details, and export at the selected dimensions.
- Modify `dashboard/src/components/local-editor/LocalEditorSubtitleStyleInspector.jsx` so X/Y fields use the active output dimensions.
- Modify `dashboard/src/components/local-editor/ClipMetadataPanel.jsx` to show source ratio and active output ratio as separate rows.

`LocalEditorHookInspector.jsx` already accepts `renderWidth` and `renderHeight`; pass it the resolved dimensions from `LocalEditorTab` without changing its shared coordinate helper.

The ratio selector is for the standalone `/editor` route, where `LocalEditorTab` owns the export request. Do not show it when a parent `onExport` callback is supplied: the full-screen project editor owns a separate render specification and does not accept local output dimensions through that callback.

## Task 1: Add the aspect-ratio model

**Files:**
- Create: `dashboard/src/components/local-editor/localEditorAspectRatio.js`

- [ ] **Step 1: Define the supported output presets and legacy-safe normalization**

Implement these options and dimensions:

```js
export const LOCAL_EDITOR_ASPECT_RATIOS = [
  { value: "9:16", label: "9:16", width: 1080, height: 1920 },
  { value: "16:9", label: "16:9", width: 1920, height: 1080 },
  { value: "1:1", label: "1:1", width: 1080, height: 1080 },
  { value: "4:5", label: "4:5", width: 1080, height: 1350 },
  { value: "original", label: "Original" },
];

export const normalizeAspectRatio = (value) =>
  LOCAL_EDITOR_ASPECT_RATIOS.some((option) => option.value === value)
    ? value
    : "9:16";
```

- [ ] **Step 2: Add source formatting and dimension resolution**

Export `formatAspectRatio(width, height)` that rounds both arguments to positive integers, divides by their greatest common divisor, and returns `W:H`; return `"—"` when either dimension is unavailable. Export `resolveAspectRatioDimensions(aspectRatio, sourceWidth, sourceHeight)` with this behavior:

```js
export const resolveAspectRatioDimensions = (
  aspectRatio,
  sourceWidth,
  sourceHeight,
) => {
  const selected = normalizeAspectRatio(aspectRatio);
  if (selected !== "original") {
    const { width, height } = LOCAL_EDITOR_ASPECT_RATIOS.find(
      (option) => option.value === selected,
    );
    return { width, height };
  }

  const evenDimension = (value) =>
    Math.max(2, Math.floor((Number(value) || 0) / 2) * 2);
  return {
    width: evenDimension(sourceWidth || 1080),
    height: evenDimension(sourceHeight || 1920),
  };
};
```

- [ ] **Step 3: Add proportional coordinate scaling**

Export `scaleCanvasCoordinate(value, fromSize, toSize)`. Return a rounded coordinate scaled by `toSize / fromSize`, clamp the input to `0..fromSize`, and return `0` when either size is invalid. `LocalEditorTab` will use this only when the selected ratio changes, and only for custom subtitle or hook positions.

## Task 2: Persist the selected ratio safely

**Files:**
- Modify: `dashboard/src/components/local-editor/localEditorPersistence.js`

- [ ] **Step 1: Add the default to empty editor snapshots**

Add `aspectRatio: "9:16"` to `createEmptyEditorHistory().present`.

- [ ] **Step 2: Normalize stored snapshots**

Import `normalizeAspectRatio` from `localEditorAspectRatio.js` and add this field to the object returned by `normalizeSnapshot`:

```js
aspectRatio: normalizeAspectRatio(snapshot?.aspectRatio),
```

This keeps pre-feature browser history and saved projects valid. `normalizeEditorHistory`, `saveStoredProject`, and `loadStoredProject` continue to use the existing snapshot path.

## Task 3: Connect selection, preview, and export

**Files:**
- Modify: `dashboard/src/components/local-editor/LocalEditorTab.jsx`

- [ ] **Step 1: Resolve source and output dimensions**

Read the selected ratio from `editHistory.present.aspectRatio`. Track native source dimensions in state from the existing `handleMetadata` event. For Remotion previews, wrap the existing `remotionPreviewProps.onSourceDimensionsChange` callback, store the callback's dimensions, and forward them to the parent. Use `remotionPreviewProps.width` and `height`, then `clipMetadata.output_width` and `output_height`, as fallbacks. Clear tracked source dimensions when the active source changes so the Details panel cannot briefly show a stale ratio.

Call `resolveAspectRatioDimensions` once with the selected ratio and resolved source dimensions. Reuse that `{ width, height }` object for every preview and export consumer.

- [ ] **Step 2: Add an undoable ratio selector**

Replace the hardcoded player `9:16` button with a native `<select aria-label="Export aspect ratio">` when no parent `onExport` callback is supplied. Populate it from `LOCAL_EDITOR_ASPECT_RATIOS`; render `Original` as `Original (W:H)` when source dimensions are known. On change, call `commitEdit` so the choice is included in undo/redo and project persistence. Before committing, if the current subtitle style or hook has `position === "custom"`, resolve its point in the old dimensions and scale X and Y to the new dimensions with `scaleCanvasCoordinate`. Leave preset positions unchanged so their existing anchor logic resolves against the new canvas.

- [ ] **Step 3: Match the preview frame and Remotion composition**

Replace the static `aspect-[9/16]` class with `style={{ aspectRatio: `${outputWidth} / ${outputHeight}` }}`. Pass `width={outputWidth}` and `height={outputHeight}` after the spread of `remotionPreviewProps` so the composition has the selected dimensions. Compute the native subtitle overlay's CSS position with the same output dimensions. Preserve the existing native video Fit/Fill behavior.

- [ ] **Step 4: Export using the selected dimensions**

In `exportVideo`, remove the fixed-default `getFilledFrameDimensions(sourceWidth, sourceHeight)` call. Use the resolved output dimensions directly in `renderParams.width` and `renderParams.height`. Keep the existing `videoFit`, timeline, subtitle, hook, and layout fields. The browser and project export paths already forward these dimensions to the backend.

## Task 4: Keep position controls and Details accurate

**Files:**
- Modify: `dashboard/src/components/local-editor/LocalEditorSubtitleStyleInspector.jsx`
- Modify: `dashboard/src/components/local-editor/ClipMetadataPanel.jsx`
- Modify: `dashboard/src/components/local-editor/LocalEditorTab.jsx`

- [ ] **Step 1: Make subtitle X/Y fields use active canvas bounds**

Add `renderWidth = 1080` and `renderHeight = 1920` props to `LocalEditorSubtitleStyleInspector`. Pass them to `getSubtitlePositionCoordinates` in the initial resolution, coordinate commit, and preset display. Set input `max` attributes from those props and describe the center point using the current dimensions. Pass the selected output dimensions from `LocalEditorTab`.

- [ ] **Step 2: Pass active output and source dimensions to Details**

Keep `width` and `height` as the active output dimensions. Add `sourceWidth` and `sourceHeight` props to `ClipMetadataPanel`; compute the source ratio with `formatAspectRatio`. Show separate `Source ratio` and `Output ratio` rows. The output resolution row uses the active output dimensions. In `LocalEditorTab`, pass the tracked source dimensions and resolved output dimensions. Pass the same output dimensions to the existing hook inspector props.

## Task 5: Verify the live editor and commit

**Files:**
- No additional files.

- [ ] **Step 1: Format and lint the dashboard**

From `dashboard`, run `npm run format`, `npm run format:check`, and `npm run lint`. All must finish successfully before commit, per the repository instructions.

- [ ] **Step 2: Review the change scope**

Run `git status --short` and `git diff --check`. Confirm only the listed implementation files changed. Run GitNexus `detect_changes({ scope: "compare", base_ref: "main" })` and review affected flows before committing.

- [ ] **Step 3: Commit the implementation**

Stage only the implementation files and commit with:

```powershell
git add -- dashboard/src/components/local-editor/localEditorAspectRatio.js dashboard/src/components/local-editor/localEditorPersistence.js dashboard/src/components/local-editor/LocalEditorTab.jsx dashboard/src/components/local-editor/LocalEditorSubtitleStyleInspector.jsx dashboard/src/components/local-editor/ClipMetadataPanel.jsx
git commit -m "feat: select local editor aspect ratio"
```

- [ ] **Step 4: Apply to the local app**

From the repository root, run `.\scripts\manage-local.ps1 -Action Restart -Component frontend`, then `.\scripts\manage-local.ps1 -Action Status`. Confirm the frontend and backend are running and the dashboard health check succeeds.

- [ ] **Step 5: Smoke-check in Brave**

Open `http://localhost:18575/editor#app` in Brave. Confirm the source ratio appears in Details; select each of the four presets and `Original`; confirm the frame and subtitle/hook coordinate bounds change; then export one short clip and confirm its reported dimensions match the selected ratio. Restore the editor to its previous ratio after the smoke check.

