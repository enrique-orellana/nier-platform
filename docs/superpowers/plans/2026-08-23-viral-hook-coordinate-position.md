# Viral Hook Pixel Coordinate Positioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add pixel-based Viral Hook positioning that preserves the existing Top, Center, and Bottom presets and renders custom positions identically in the editor and exported video.

**Architecture:** Store custom hook coordinates as an explicit `position: "custom"` mode with optional `positionX` and `positionY` values in output pixels. A shared resolver maps presets or custom coordinates to a center point, and each UI/render surface converts that point to its own display dimensions. Legacy manifests without custom fields continue through the existing preset path.

**Tech Stack:** React, Vitest, Testing Library, Remotion, Zod, TypeScript, Canvas 2D, Prettier, ESLint.

---

## File map

- `dashboard/src/remotion/lib/hookVisual.js`: dashboard-side coordinate resolver and CSS position conversion used by the Local Editor preview.
- `remotion/src/lib/hookVisual.ts`: renderer-side equivalent used by the production Remotion composition.
- `dashboard/src/remotion/lib/types.ts` and `remotion/src/lib/types.ts`: allow the `custom` position and coordinate fields in the client and renderer contracts.
- `dashboard/src/components/local-editor/LocalEditorHookInspector.jsx`: coordinate inputs, preset reset behavior, and custom-mode indicator.
- `dashboard/src/components/local-editor/LocalEditorTab.jsx`: pass output dimensions into the inspector and use the shared resolver for the native preview overlay.
- `dashboard/src/components/local-editor/localEditorExport.js`: use the same resolved center point for the Canvas export fallback.
- `dashboard/src/components/editor/FullScreenEditor.jsx`: preserve coordinate fields when converting manifests to and from editor state.
- `dashboard/src/components/local-editor/localEditorRender.js`: normalize and forward custom hook fields into browser/backend render props.
- `dashboard/src/remotion/compositions/HookOverlay.tsx` and `remotion/src/compositions/HookOverlay.tsx`: apply the shared custom position in Remotion preview and production rendering.
- `dashboard/src/remotion/lib/hookVisual.test.js`, `render-service/src/hookVisual.test.ts`, `dashboard/src/components/local-editor/LocalEditorHookInspector.test.jsx`, `dashboard/src/components/local-editor/localEditorExport.test.js`, and `dashboard/src/components/local-editor/localEditorRender.test.js`: regression coverage for the resolver, UI, Canvas fallback, and render contract.

## Task 1: Add the shared pixel coordinate contract

**Files:**

- Modify: `dashboard/src/remotion/lib/types.ts`
- Modify: `remotion/src/lib/types.ts`
- Modify: `dashboard/src/remotion/lib/hookVisual.js`
- Modify: `remotion/src/lib/hookVisual.ts`
- Create: `dashboard/src/remotion/lib/hookVisual.test.js`
- Create: `render-service/src/hookVisual.test.ts`

- [ ] **Step 1: Write the failing dashboard resolver tests.**

Add tests for a `getHookPositionCoordinates(hook, width, height)` helper:

```js
it("resolves preset and custom hook center points in output pixels", () => {
  expect(getHookPositionCoordinates({ position: "top" }, 1080, 1920)).toEqual({
    x: 540,
    y: 154,
  });
  expect(getHookPositionCoordinates({ position: "center" }, 1080, 1920)).toEqual({
    x: 540,
    y: 960,
  });
  expect(getHookPositionCoordinates({ position: "bottom" }, 1080, 1920)).toEqual({
    x: 540,
    y: 1574,
  });
  expect(
    getHookPositionCoordinates(
      { position: "custom", positionX: 700, positionY: 420 },
      1080,
      1920,
    ),
  ).toEqual({ x: 700, y: 420 });
});

it("rounds and clamps custom coordinates to the render canvas", () => {
  expect(
    getHookPositionCoordinates(
      { position: "custom", positionX: 1200.8, positionY: -10 },
      1080,
      1920,
    ),
  ).toEqual({ x: 1080, y: 0 });
});

it("resolves the streamer stack top preset at the facecam boundary", () => {
  expect(
    getHookPositionCoordinates(
      { position: "top", layoutFormat: "streamer_stack", facecamSize: "large" },
      1080,
      1920,
    ),
  ).toEqual({ x: 540, y: 883 });
});
```

- [ ] **Step 2: Run the dashboard resolver tests and verify RED.**

Run from `dashboard`:

```powershell
npm test -- --run src/remotion/lib/hookVisual.test.js
```

Expected: FAIL because `getHookPositionCoordinates` does not exist yet.

- [ ] **Step 3: Implement the resolver in both visual helper copies.**

Use the same constants and algorithm in the JavaScript and TypeScript helpers:

```js
export const HOOK_OUTPUT_WIDTH = 1080;
export const HOOK_OUTPUT_HEIGHT = 1920;

export const clampHookCoordinate = (value, maximum, fallback) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.round(Math.max(0, Math.min(maximum, numeric)));
};

export const getHookPositionCoordinates = (
  hook = {},
  renderWidth = HOOK_OUTPUT_WIDTH,
  renderHeight = HOOK_OUTPUT_HEIGHT,
) => {
  const width = Math.max(1, Number(renderWidth) || HOOK_OUTPUT_WIDTH);
  const height = Math.max(1, Number(renderHeight) || HOOK_OUTPUT_HEIGHT);
  if (hook.position === "custom") {
    return {
      x: clampHookCoordinate(hook.positionX, width, width / 2),
      y: clampHookCoordinate(hook.positionY, height, height / 2),
    };
  }
  const x = Math.round(width / 2);
  const y =
    hook.position === "center"
      ? height * 0.5
      : hook.position === "bottom"
        ? height * 0.82
        : hook.layoutFormat === "streamer_stack"
          ? height * getStreamerBoundaryRatio(hook.facecamSize)
          : height * 0.08;
  return { x, y: Math.round(y) };
};
```

Update `getHookPositionStyle` to accept either the legacy position string or a hook object, resolve the center point, and return `left`, `top`, `bottom: "auto"`, and `transform: "translate(-50%, -50%)"` as percentages for the supplied render dimensions. Keep the legacy string arguments supported while callers migrate.

- [ ] **Step 4: Extend both hook schemas and TypeScript types.**

Change `HookPosition` to include `"custom"`, add optional numeric `positionX` and `positionY` fields to `HookConfig`, and allow the same fields in both `hookConfigSchema` definitions. Preserve all existing required fields and defaults.

- [ ] **Step 5: Test the renderer-side helper and compile contract.**

In `render-service/src/hookVisual.test.ts`, import the TypeScript helper from `../../remotion/src/lib/hookVisual` and assert the same preset/custom/clamping cases. Run:

```powershell
npm test -- --run src/hookVisual.test.ts
npm run build
```

from `render-service`. Expected: the helper tests pass and the renderer TypeScript build succeeds.

- [ ] **Step 6: Commit the shared contract.**

```powershell
git add dashboard/src/remotion/lib/types.ts dashboard/src/remotion/lib/hookVisual.js dashboard/src/remotion/lib/hookVisual.test.js remotion/src/lib/types.ts remotion/src/lib/hookVisual.ts render-service/src/hookVisual.test.ts
git commit -m "feat: add viral hook pixel position contract"
```

## Task 2: Add coordinate controls to the Viral Hook inspector

**Files:**

- Modify: `dashboard/src/components/local-editor/LocalEditorHookInspector.jsx`
- Modify: `dashboard/src/components/local-editor/LocalEditorTab.jsx`
- Modify: `dashboard/src/components/local-editor/LocalEditorHookInspector.test.jsx`

- [ ] **Step 1: Write the failing inspector tests.**

Extend the test hook fixture with `position: "top"`, render with `renderWidth={1080}` and `renderHeight={1920}`, and add:

```jsx
it("shows resolved preset pixels and switches to custom when edited", () => {
  const onChange = vi.fn();
  render(
    <LocalEditorHookInspector
      hook={hook}
      onChange={onChange}
      onRemove={vi.fn()}
      renderWidth={1080}
      renderHeight={1920}
    />,
  );

  expect(screen.getByLabelText("Hook X position")).toHaveValue(540);
  expect(screen.getByLabelText("Hook Y position")).toHaveValue(154);
  expect(screen.getByText("Preset position")).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Hook X position"), {
    target: { value: "700" },
  });

  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ position: "custom", positionX: 700, positionY: 154 }),
  );
});

it("clears custom coordinates when a preset is selected", () => {
  const onChange = vi.fn();
  render(
    <LocalEditorHookInspector
      hook={{ ...hook, position: "custom", positionX: 700, positionY: 420 }}
      onChange={onChange}
      onRemove={vi.fn()}
      renderWidth={1080}
      renderHeight={1920}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Bottom" }));

  expect(onChange).toHaveBeenLastCalledWith(
    expect.not.objectContaining({ positionX: expect.anything(), positionY: expect.anything() }),
  );
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ position: "bottom" }));
});
```

- [ ] **Step 2: Run the inspector tests and verify RED.**

Run from `dashboard`:

```powershell
npm test -- --run src/components/local-editor/LocalEditorHookInspector.test.jsx
```

Expected: FAIL because the coordinate inputs and custom-mode behavior are not present.

- [ ] **Step 3: Implement the inspector controls.**

Add `renderWidth = 1080` and `renderHeight = 1920` props. Resolve the displayed values with `getHookPositionCoordinates(hook, renderWidth, renderHeight)`. Add two integer number inputs below the preset grid with `min="0"`, `max` set to the corresponding render dimension, `step="1"`, and labels `Hook X position` and `Hook Y position`.

When a coordinate changes, import `clampHookCoordinate` from the shared visual helper and use this exact state transition:

```js
const updateCoordinate = (key, rawValue) => {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return;
  onChange({
    ...hook,
    position: "custom",
    positionX: clampHookCoordinate(
      key === "positionX" ? value : resolved.x,
      renderWidth,
      resolved.x,
    ),
    positionY: clampHookCoordinate(
      key === "positionY" ? value : resolved.y,
      renderHeight,
      resolved.y,
    ),
  });
};
```

Use a `Preset position` label for Top/Center/Bottom and a `Custom position` indicator when `hook.position === "custom"`. Preset buttons must remove `positionX` and `positionY` before calling `onChange`, rather than leaving stale custom values in the object.

- [ ] **Step 4: Pass output dimensions from `LocalEditorTab`.**

Derive `hookRenderWidth` and `hookRenderHeight` from `remotionPreviewProps.width/height`, then `clipMetadata.output_width/output_height`, then `1080/1920`. Pass them to `LocalEditorHookInspector` so the visible ranges match the render contract.

- [ ] **Step 5: Run the inspector tests and verify GREEN.**

```powershell
npm test -- --run src/components/local-editor/LocalEditorHookInspector.test.jsx
```

Expected: all inspector tests pass.

- [ ] **Step 6: Commit the inspector controls.**

```powershell
git add dashboard/src/components/local-editor/LocalEditorHookInspector.jsx dashboard/src/components/local-editor/LocalEditorTab.jsx dashboard/src/components/local-editor/LocalEditorHookInspector.test.jsx
git commit -m "feat: add viral hook coordinate controls"
```

## Task 3: Preserve and forward custom coordinates

**Files:**

- Modify: `dashboard/src/components/editor/FullScreenEditor.jsx`
- Modify: `dashboard/src/components/local-editor/localEditorRender.js`
- Modify: `dashboard/src/components/local-editor/localEditorRender.test.js`
- Modify: `dashboard/src/components/editor/FullScreenEditor.test.jsx`

- [ ] **Step 1: Add failing render-contract and manifest round-trip assertions.**

In `localEditorRender.test.js`, add a custom hook with fractional and out-of-bounds coordinates to the `buildRemotionRenderProps` input and assert that the render contract normalizes them:

```js
expect(props.hook).toMatchObject({
  position: "custom",
  positionX: 701,
  positionY: 0,
});

expect(props.hook).not.toHaveProperty("positionX", 700.6);
```

Add a `FullScreenEditor` regression case that loads a manifest with the same custom fields, edits/saves the editor state, and asserts the resulting manifest still contains `position`, `positionX`, and `positionY` unchanged.

- [ ] **Step 2: Run the focused tests and verify the new assertions fail if fields are dropped.**

```powershell
npm test -- --run src/components/local-editor/localEditorRender.test.js src/components/editor/FullScreenEditor.test.jsx
```

Expected: the new round-trip assertion fails before the explicit state conversion changes are made.

- [ ] **Step 3: Preserve coordinates in `FullScreenEditor` state conversion.**

In `manifestToLocalEditorState`, copy `positionX` and `positionY` when they are finite. In `localEditorStateToManifest`, keep those fields when `state.hook.position === "custom"`, and remove them when the state uses a preset. Do not change timing, appearance, or subtitle serialization.

- [ ] **Step 4: Normalize custom hook fields in `buildRemotionRenderProps`.**

Keep the existing hook spread, but normalize `position` to one of the four supported values and forward finite `positionX`/`positionY` values. Preserve the existing default `position: "top"` for legacy hooks.

- [ ] **Step 5: Run the focused tests and verify GREEN.**

```powershell
npm test -- --run src/components/local-editor/localEditorRender.test.js src/components/editor/FullScreenEditor.test.jsx
```

Expected: the render contract and manifest round-trip tests pass.

- [ ] **Step 6: Commit persistence and render forwarding.**

```powershell
git add dashboard/src/components/editor/FullScreenEditor.jsx dashboard/src/components/editor/FullScreenEditor.test.jsx dashboard/src/components/local-editor/localEditorRender.js dashboard/src/components/local-editor/localEditorRender.test.js
git commit -m "feat: persist viral hook custom coordinates"
```

## Task 4: Make every preview and export surface use the resolver

**Files:**

- Modify: `dashboard/src/remotion/compositions/HookOverlay.tsx`
- Modify: `remotion/src/compositions/HookOverlay.tsx`
- Modify: `dashboard/src/components/local-editor/LocalEditorTab.jsx`
- Modify: `dashboard/src/components/local-editor/localEditorExport.js`
- Modify: `dashboard/src/remotion/compositions/HookOverlay.test.jsx`
- Modify: `dashboard/src/components/local-editor/localEditorExport.test.js`

- [ ] **Step 1: Write failing custom-position render tests.**

Add a `HookOverlay` test with `position: "custom"`, `positionX: 270`, `positionY: 480`, and mocked Remotion dimensions `540x960`. Assert the hook container has `left: "50%"`, `top: "50%"`, and `transform: "translate(-50%, -50%)"`.

Add a Canvas helper test:

```js
expect(getHookCanvasPosition({ position: "custom", positionX: 700, positionY: 420 }, 1080, 1920)).toEqual({
  x: 700,
  y: 420,
});
```

- [ ] **Step 2: Run the focused render tests and verify RED.**

```powershell
npm test -- --run src/remotion/compositions/HookOverlay.test.jsx src/components/local-editor/localEditorExport.test.js
```

Expected: the custom-position assertions fail because both paths still use preset-only positioning.

- [ ] **Step 3: Update both Remotion HookOverlay components.**

Pass the complete hook config plus `width` and `height` to `getHookPositionStyle`. Keep the existing animation and box style merges after the position style so entrance animation cannot overwrite the position transform.

- [ ] **Step 4: Update the Local Editor HTML preview.**

Replace the position-string call with the complete `activeHook` config and the same resolved render dimensions used by the inspector. The position helper must provide the left/top center anchor; remove the hard-coded `left: "50%"` only when the helper supplies the value.

- [ ] **Step 5: Update the native Canvas export fallback.**

Add a small `getHookCanvasPosition(hook, canvasWidth, canvasHeight)` wrapper that delegates to `getHookPositionCoordinates`. In the hook draw block, replace the preset conditional with:

```js
const { x, y } = getHookCanvasPosition(currentHook, canvas.width, canvas.height);
context.translate(x, y + hookState.translateY);
```

Keep the existing animation scale, opacity, text, colors, and width unchanged.

- [ ] **Step 6: Run the focused render tests and verify GREEN.**

```powershell
npm test -- --run src/remotion/compositions/HookOverlay.test.jsx src/components/local-editor/localEditorExport.test.js
```

Expected: both Remotion and Canvas custom-position tests pass, alongside all existing hook appearance tests.

- [ ] **Step 7: Commit preview/export parity.**

```powershell
git add dashboard/src/remotion/compositions/HookOverlay.tsx dashboard/src/remotion/compositions/HookOverlay.test.jsx remotion/src/compositions/HookOverlay.tsx dashboard/src/components/local-editor/LocalEditorTab.jsx dashboard/src/components/local-editor/localEditorExport.js dashboard/src/components/local-editor/localEditorExport.test.js
git commit -m "fix: render viral hook custom positions consistently"
```

## Task 5: Run the complete verification suite

**Files:** No production files; verification only.

- [ ] **Step 1: Format the dashboard sources.**

```powershell
npm run format
npm run format:check
```

Run from `dashboard`. Expected: Prettier writes only the intended dashboard files, then the format check passes.

- [ ] **Step 2: Run dashboard lint and focused regression tests.**

```powershell
npm run lint
npm test -- --run src/remotion/lib/hookVisual.test.js src/components/local-editor/LocalEditorHookInspector.test.jsx src/components/local-editor/localEditorExport.test.js src/components/local-editor/localEditorRender.test.js src/remotion/compositions/HookOverlay.test.jsx src/components/editor/FullScreenEditor.test.jsx
```

Expected: lint exits 0 and every focused test passes.

- [ ] **Step 3: Build dashboard and renderer packages.**

```powershell
npm run build
```

Run from `dashboard`, then run `npm run build` from both `remotion` and `render-service`. Expected: all three builds exit 0.

- [ ] **Step 4: Run repository diff checks.**

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors and only the intended implementation commits present.

- [ ] **Step 5: Run GitNexus pre-commit impact detection.**

Run `detect_changes({ scope: "compare", base_ref: "main", repo: "openshorts" })` and verify that only the Viral Hook inspector, position helpers, render compositions, persistence conversion, and their tests are affected. Review any unexpected affected process before committing the final verification result.

- [ ] **Step 6: Commit any final formatting-only changes separately.**

```powershell
git add dashboard/src remotion/src render-service/src
git commit -m "chore: format viral hook coordinate changes"
```

Create this commit only if formatting changed one of the feature files listed in Tasks 1–4; stage those exact files and do not stage unrelated files.
