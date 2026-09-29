# Subtitle X/Y Position Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add track-wide numeric X/Y subtitle positioning to the local editor while keeping preset positioning and making preview, render, and export use the same coordinates.

**Architecture:** Keep subtitle position in the existing `SubtitleStyle` object. Add a small pure coordinate resolver at each runtime boundary (dashboard and renderer) so legacy presets and custom pixel coordinates resolve to the same CSS anchor contract. The inspector writes `position: "custom"` plus bounded coordinates; presets clear custom coordinates and continue to use the existing style/history/version pipeline.

**Tech Stack:** React, TypeScript, Remotion, Vitest, Testing Library, Zod, Tailwind CSS, ESLint, Prettier.

---

## File map

- Create `dashboard/src/remotion/lib/subtitlePosition.js` — dashboard coordinate constants, clamping, preset resolution, and CSS anchor style.
- Create `dashboard/src/remotion/lib/subtitlePosition.test.js` — pure resolver tests.
- Create `remotion/src/lib/subtitlePosition.ts` — renderer-package copy of the same pure coordinate contract.
- Modify `dashboard/src/remotion/lib/types.ts` and `remotion/src/lib/types.ts` — add `custom`, `positionX`, and `positionY` to subtitle types and Zod schemas.
- Modify `dashboard/src/components/local-editor/localEditorStyles.js` — validate the expanded position enum without changing existing defaults.
- Modify `dashboard/src/components/local-editor/LocalEditorSubtitleStyleInspector.jsx` — add accessible X/Y number inputs and preset/custom transitions.
- Modify `dashboard/src/components/local-editor/localEditorStyles.test.js` and `LocalEditorSubtitleStyleInspector.test.jsx` — cover normalization, coordinate values, preset selection, custom edits, and template resets.
- Modify `dashboard/src/components/local-editor/LocalEditorTab.jsx` — apply the coordinate resolver to the inline preview.
- Modify `dashboard/src/remotion/compositions/Subtitles.tsx` and `remotion/src/compositions/Subtitles.tsx` — apply the coordinate resolver to Remotion subtitle overlays.
- Modify `dashboard/src/remotion/compositions/Subtitles.test.jsx` — verify custom subtitle overlay placement.
- Modify `dashboard/src/components/local-editor/localEditorExport.js` — resolve canvas coordinates and center the measured subtitle overlay there.
- Modify `dashboard/src/components/local-editor/localEditorExport.test.js` — test custom canvas placement and legacy preset placement.
- Modify `dashboard/src/components/local-editor/localEditorRender.test.js` and `localEditorPersistence.test.js` — verify custom coordinates survive render props and persisted editor state.

### Task 1: Add the pure subtitle coordinate contract

**Files:**
- Create: `dashboard/src/remotion/lib/subtitlePosition.js`
- Test: `dashboard/src/remotion/lib/subtitlePosition.test.js`
- Create: `remotion/src/lib/subtitlePosition.ts`

- [ ] **Step 1: Write the failing resolver tests**

Create `dashboard/src/remotion/lib/subtitlePosition.test.js` with these behaviors:

```js
import { describe, expect, it } from "vitest";
import {
  getSubtitlePositionCoordinates,
  getSubtitlePositionStyle,
} from "./subtitlePosition";

describe("subtitle position resolver", () => {
  it("maps legacy presets to the 1080x1920 canvas", () => {
    expect(getSubtitlePositionCoordinates({ position: "top" })).toEqual({
      x: 540,
      y: 230,
    });
    expect(getSubtitlePositionCoordinates({ position: "middle" })).toEqual({
      x: 540,
      y: 864,
    });
    expect(getSubtitlePositionCoordinates({ position: "bottom" })).toEqual({
      x: 540,
      y: 1728,
    });
  });

  it("rounds and clamps custom coordinates to the output frame", () => {
    expect(
      getSubtitlePositionCoordinates({
        position: "custom",
        positionX: 1200.8,
        positionY: -10,
      }),
    ).toEqual({ x: 1080, y: 0 });
  });

  it("returns a centered percentage anchor for CSS previews", () => {
    expect(
      getSubtitlePositionStyle(
        { position: "custom", positionX: 270, positionY: 480 },
        1080,
        1920,
      ),
    ).toEqual({
      left: "25%",
      top: "25%",
      bottom: "auto",
      transform: "translate(-50%, -50%)",
    });
  });
});
```

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run from `dashboard`:

```powershell
npx vitest run src/remotion/lib/subtitlePosition.test.js
```

Expected result: FAIL because `./subtitlePosition` does not exist yet.

- [ ] **Step 3: Implement the dashboard resolver**

Create `dashboard/src/remotion/lib/subtitlePosition.js`:

```js
export const SUBTITLE_OUTPUT_WIDTH = 1080;
export const SUBTITLE_OUTPUT_HEIGHT = 1920;

const PRESET_Y_RATIOS = Object.freeze({
  top: 0.12,
  middle: 0.45,
  bottom: 0.9,
});

export const clampSubtitleCoordinate = (value, maximum, fallback) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Math.round(fallback);
  return Math.round(Math.max(0, Math.min(maximum, numeric)));
};

export const getSubtitlePositionCoordinates = (
  style = {},
  width = SUBTITLE_OUTPUT_WIDTH,
  height = SUBTITLE_OUTPUT_HEIGHT,
) => {
  const outputWidth = Math.max(1, Number(width) || SUBTITLE_OUTPUT_WIDTH);
  const outputHeight = Math.max(1, Number(height) || SUBTITLE_OUTPUT_HEIGHT);
  if (style.position === "custom") {
    return {
      x: clampSubtitleCoordinate(style.positionX, outputWidth, outputWidth / 2),
      y: clampSubtitleCoordinate(style.positionY, outputHeight, outputHeight / 2),
    };
  }
  const ratio = PRESET_Y_RATIOS[style.position] ?? PRESET_Y_RATIOS.bottom;
  return { x: Math.round(outputWidth / 2), y: Math.round(outputHeight * ratio) };
};

export const getSubtitlePositionStyle = (
  style = {},
  width = SUBTITLE_OUTPUT_WIDTH,
  height = SUBTITLE_OUTPUT_HEIGHT,
) => {
  const outputWidth = Math.max(1, Number(width) || SUBTITLE_OUTPUT_WIDTH);
  const outputHeight = Math.max(1, Number(height) || SUBTITLE_OUTPUT_HEIGHT);
  const { x, y } = getSubtitlePositionCoordinates(style, outputWidth, outputHeight);
  return {
    left: `${(x / outputWidth) * 100}%`,
    top: `${(y / outputHeight) * 100}%`,
    bottom: "auto",
    transform: "translate(-50%, -50%)",
  };
};
```

- [ ] **Step 4: Add the renderer-package implementation with the same contract**

Create `remotion/src/lib/subtitlePosition.ts` with the same exported constants and functions, using TypeScript return types inferred from the implementation. Keep this copy dependency-free so the standalone renderer does not import dashboard code.

- [ ] **Step 5: Run the helper tests and renderer typecheck**

Run:

```powershell
cd dashboard
npx vitest run src/remotion/lib/subtitlePosition.test.js
cd ..\remotion
npm run build
```

Expected result: the resolver suite passes and the renderer TypeScript build exits 0.

- [ ] **Step 6: Commit the coordinate contract**

```powershell
git add dashboard/src/remotion/lib/subtitlePosition.js dashboard/src/remotion/lib/subtitlePosition.test.js remotion/src/lib/subtitlePosition.ts
git commit -m "feat: add subtitle position resolver"
```

### Task 2: Extend subtitle types and implement the inspector controls

**Files:**
- Modify: `dashboard/src/remotion/lib/types.ts`
- Modify: `remotion/src/lib/types.ts`
- Modify: `dashboard/src/components/local-editor/localEditorStyles.js`
- Modify: `dashboard/src/components/local-editor/LocalEditorSubtitleStyleInspector.jsx`
- Test: `dashboard/src/components/local-editor/localEditorStyles.test.js`
- Test: `dashboard/src/components/local-editor/LocalEditorSubtitleStyleInspector.test.jsx`

- [ ] **Step 1: Add failing style and inspector tests**

Append tests that require the new behavior:

```js
it("accepts custom subtitle coordinates and normalizes invalid positions", () => {
  expect(
    normalizeSubtitleStyle({
      position: "custom",
      positionX: 700,
      positionY: 420,
    }),
  ).toMatchObject({
    position: "custom",
    positionX: 700,
    positionY: 420,
  });
  expect(normalizeSubtitleStyle({ position: "invalid" }).position).toBe("bottom");
});

it("shows effective preset coordinates and switches to custom on edit", () => {
  const onChange = vi.fn();
  render(
    <LocalEditorSubtitleStyleInspector
      style={DEFAULT_SUBTITLE_STYLE}
      onChange={onChange}
      onRemove={vi.fn()}
      hasCues
    />,
  );

  expect(screen.getByLabelText("Subtitle X position")).toHaveValue(540);
  expect(screen.getByLabelText("Subtitle Y position")).toHaveValue(1728);
  fireEvent.change(screen.getByLabelText("Subtitle X position"), {
    target: { value: "700" },
  });
  expect(onChange).toHaveBeenLastCalledWith({
    ...DEFAULT_SUBTITLE_STYLE,
    position: "custom",
    positionX: 700,
    positionY: 1728,
  });
});

it("clears custom coordinates when a preset is selected", () => {
  const onChange = vi.fn();
  render(
    <LocalEditorSubtitleStyleInspector
      style={{
        ...DEFAULT_SUBTITLE_STYLE,
        position: "custom",
        positionX: 700,
        positionY: 420,
      }}
      onChange={onChange}
      onRemove={vi.fn()}
      hasCues
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Bottom" }));
  expect(onChange).toHaveBeenLastCalledWith(DEFAULT_SUBTITLE_STYLE);
});
```

Update the existing quick-pick test with a custom starting style and assert that a template with a preset position removes `positionX` and `positionY`.

- [ ] **Step 2: Run the focused style and inspector tests to verify RED**

Run from `dashboard`:

```powershell
npx vitest run src/components/local-editor/localEditorStyles.test.js src/components/local-editor/LocalEditorSubtitleStyleInspector.test.jsx
```

Expected result: FAIL because the style type/controls and coordinate resolver integration do not exist yet.

- [ ] **Step 3: Extend both type/schema definitions**

In both `dashboard/src/remotion/lib/types.ts` and `remotion/src/lib/types.ts`, change the subtitle declarations to:

```ts
export type SubtitlePosition = "top" | "middle" | "bottom" | "custom";

export interface SubtitleStyle {
  fontFamily: string;
  fontSize: number;
  fontColor: string;
  highlightColor: string;
  borderColor: string;
  borderWidth: number;
  bgColor: string;
  bgOpacity: number;
  animation: SubtitleAnimation;
  displayMode: SubtitleDisplayMode;
  position?: SubtitlePosition;
  positionX?: number;
  positionY?: number;
}
```

Add these fields to both `subtitleStyleSchema` objects:

```ts
position: z.enum(["top", "middle", "bottom", "custom"]).optional(),
positionX: z.number().min(0).max(1080).optional(),
positionY: z.number().min(0).max(1920).optional(),
```

- [ ] **Step 4: Normalize the expanded position enum in the dashboard style helper**

Update `normalizeSubtitleStyle` in `dashboard/src/components/local-editor/localEditorStyles.js` so invalid positions fall back to `bottom` while preserving optional custom coordinates:

```js
const SUBTITLE_POSITIONS = new Set(["top", "middle", "bottom", "custom"]);

export const normalizeSubtitleStyle = (style = {}) => ({
  ...DEFAULT_SUBTITLE_STYLE,
  ...style,
  position: SUBTITLE_POSITIONS.has(style.position)
    ? style.position
    : DEFAULT_SUBTITLE_STYLE.position,
  displayMode: style.displayMode === "single-word" ? "single-word" : "phrase",
});
```

- [ ] **Step 5: Add the numeric controls and preset/custom transitions**

In `LocalEditorSubtitleStyleInspector.jsx`, import `getSubtitlePositionCoordinates`, derive `coordinates` from `current`, and add this logic before the Position section:

```jsx
const coordinates = getSubtitlePositionCoordinates(current);
const updateCoordinate = (key, rawValue) => {
  const value = rawValue === "" ? "" : Number(rawValue);
  onChange({
    ...current,
    position: "custom",
    positionX: key === "positionX" ? value : coordinates.x,
    positionY: key === "positionY" ? value : coordinates.y,
  });
};

const selectPreset = (position) => {
  const { positionX, positionY, ...withoutCoordinates } = current;
  onChange({ ...withoutCoordinates, position });
};
```

Replace the existing preset `onClick={() => update("position", position)}` with `onClick={() => selectPreset(position)}` and mark a preset active only when `current.position === position`. Add the following controls below the preset button group:

```jsx
<div className="mt-3 grid grid-cols-2 gap-2">
  <label className="text-xs text-zinc-400">
    X (px)
    <input
      aria-label="Subtitle X position"
      type="number"
      min="0"
      max="1080"
      step="1"
      value={current.position === "custom" ? current.positionX ?? coordinates.x : coordinates.x}
      onChange={(event) => updateCoordinate("positionX", event.target.value)}
      className="input-field mt-2"
    />
  </label>
  <label className="text-xs text-zinc-400">
    Y (px)
    <input
      aria-label="Subtitle Y position"
      type="number"
      min="0"
      max="1920"
      step="1"
      value={current.position === "custom" ? current.positionY ?? coordinates.y : coordinates.y}
      onChange={(event) => updateCoordinate("positionY", event.target.value)}
      className="input-field mt-2"
    />
  </label>
</div>
<p className="mt-1 text-[10px] text-zinc-500">Center point in a 1080 × 1920 video.</p>
```

Update `applyTemplate` to remove custom coordinates whenever the template sets a preset position:

```js
const applyTemplate = (template) => {
  const next = { ...current, ...template.style };
  if (template.style.position && template.style.position !== "custom") {
    delete next.positionX;
    delete next.positionY;
  }
  onChange(next);
};
```

On blur, clamp the value through the same resolver before persisting it; blank inputs may remain temporarily blank during editing but must resolve to the fallback coordinate when blurred.

- [ ] **Step 6: Run the focused style and inspector tests to verify GREEN**

```powershell
cd dashboard
npx vitest run src/components/local-editor/localEditorStyles.test.js src/components/local-editor/LocalEditorSubtitleStyleInspector.test.jsx
```

Expected result: all style and inspector tests pass with no warnings.

- [ ] **Step 7: Commit the model and inspector controls**

```powershell
git add dashboard/src/remotion/lib/types.ts remotion/src/lib/types.ts dashboard/src/components/local-editor/localEditorStyles.js dashboard/src/components/local-editor/LocalEditorSubtitleStyleInspector.jsx dashboard/src/components/local-editor/localEditorStyles.test.js dashboard/src/components/local-editor/LocalEditorSubtitleStyleInspector.test.jsx
git commit -m "feat: add subtitle x y controls"
```

### Task 3: Apply coordinates to editor and Remotion previews

**Files:**
- Modify: `dashboard/src/components/local-editor/LocalEditorTab.jsx`
- Modify: `dashboard/src/remotion/compositions/Subtitles.tsx`
- Modify: `remotion/src/compositions/Subtitles.tsx`
- Test: `dashboard/src/remotion/compositions/Subtitles.test.jsx`

- [ ] **Step 1: Add a failing custom-position rendering test**

Extend the Remotion mock to return `{ fps: 30, width: 1080, height: 1920 }`, render a timed custom subtitle, and assert its overlay layer uses the resolved percentage anchor:

```jsx
it("places custom subtitles at their configured canvas point", () => {
  render(
    <Subtitles
      config={{
        position: "custom",
        style: {
          position: "custom",
          positionX: 270,
          positionY: 480,
        },
        captions: [{ text: "Move me", startMs: 0, endMs: 1000 }],
      }}
      mediaTimeMs={500}
    />,
  );

  expect(screen.getByTestId("subtitle-position-layer")).toHaveStyle({
    left: "25%",
    top: "25%",
    transform: "translate(-50%, -50%)",
  });
});
```

- [ ] **Step 2: Run the dashboard subtitle tests to verify RED**

```powershell
cd dashboard
npx vitest run src/remotion/compositions/Subtitles.test.jsx
```

Expected result: FAIL because the layer has no test id and still uses preset CSS placement.

- [ ] **Step 3: Update both Remotion compositions**

In both subtitle composition files:

1. Import `getSubtitlePositionStyle` from the package-local resolver.
2. Read `width` and `height` from `useVideoConfig()`.
3. Replace `POSITION_MAP` lookup with `getSubtitlePositionStyle(style, width, height)`.
4. Make the outer subtitle layer `width: "88%"`, keep `display: "flex"` and `justifyContent: "center"`, add `data-testid="subtitle-position-layer"`, and retain `pointerEvents: "none"` on the root.

The resulting outer style must include:

```tsx
const positionStyle = getSubtitlePositionStyle(
  { ...style, position },
  width,
  height,
);

<div
  data-testid="subtitle-position-layer"
  style={{
    position: "absolute",
    width: "88%",
    display: "flex",
    justifyContent: "center",
    ...positionStyle,
  }}
>
```

Keep the inner word wrapping, reactions, animation, and background styles unchanged.

- [ ] **Step 4: Update the inline local-editor preview**

In `LocalEditorTab.jsx`, import `getSubtitlePositionStyle` and replace the `subtitlePositionClass(previewSubtitleStyle.position)` class with the returned style using the fixed social canvas dimensions:

```jsx
const previewSubtitlePosition = getSubtitlePositionStyle(
  previewSubtitleStyle,
  1080,
  1920,
);
```

Apply `previewSubtitlePosition` to the subtitle preview style object while keeping the existing `absolute`, width, wrapping, font, color, outline, and background classes/styles. Leave `subtitlePositionClass` exported for existing consumers/tests until the feature is fully verified.

- [ ] **Step 5: Run the preview tests and renderer build**

```powershell
cd dashboard
npx vitest run src/remotion/compositions/Subtitles.test.jsx src/components/local-editor/LocalEditorTab.test.jsx
cd ..\remotion
npm run build
```

Expected result: all targeted preview tests pass and the renderer typecheck exits 0.

- [ ] **Step 6: Commit preview placement**

```powershell
git add dashboard/src/components/local-editor/LocalEditorTab.jsx dashboard/src/remotion/compositions/Subtitles.tsx dashboard/src/remotion/compositions/Subtitles.test.jsx remotion/src/compositions/Subtitles.tsx
git commit -m "feat: render subtitles at custom positions"
```

### Task 4: Apply coordinates to canvas export and persistence contracts

**Files:**
- Modify: `dashboard/src/components/local-editor/localEditorExport.js`
- Test: `dashboard/src/components/local-editor/localEditorExport.test.js`
- Test: `dashboard/src/components/local-editor/localEditorRender.test.js`
- Test: `dashboard/src/components/local-editor/localEditorPersistence.test.js`

- [ ] **Step 1: Add failing export and persistence tests**

Add a pure canvas-origin assertion:

```js
it("centers a custom subtitle overlay on its configured canvas point", () => {
  expect(
    getSubtitleCanvasPosition(
      { position: "custom", positionX: 700, positionY: 420 },
      1080,
      1920,
      { height: 144, padding: 12 },
    ),
  ).toEqual({ x: 700, y: 360 });
});
```

Add render-prop coverage that calls `buildRemotionRenderProps` with custom subtitle style and expects `props.subtitles.style` to retain `position: "custom"`, `positionX`, and `positionY`. Add persistence coverage that normalizes a stored editor state and expects the custom coordinates to remain present.

- [ ] **Step 2: Run the focused export/render/persistence tests to verify RED**

```powershell
cd dashboard
npx vitest run src/components/local-editor/localEditorExport.test.js src/components/local-editor/localEditorRender.test.js src/components/local-editor/localEditorPersistence.test.js
```

Expected result: FAIL because `getSubtitleCanvasPosition` is not exported and the canvas draw path still only understands preset positions.

- [ ] **Step 3: Add the canvas coordinate helper and preserve style fields**

In `localEditorExport.js`, import `getSubtitlePositionCoordinates` and add:

```js
export const getSubtitleCanvasPosition = (
  style,
  canvasWidth,
  canvasHeight,
  metrics,
) => {
  const { x, y } = getSubtitlePositionCoordinates(style, canvasWidth, canvasHeight);
  const padding = Math.max(0, Number(metrics?.padding) || 0);
  const lineHeight = Math.max(0, Number(metrics?.height) || 0) - padding * 2;
  const desiredTextY = y - lineHeight / 2;
  return {
    x,
    y: clampOverlayY(desiredTextY, canvasHeight, metrics?.height, padding),
  };
};
```

Extend `subtitleVisualStyle` to return `positionX` and `positionY` when present. In `renderLocalVideo`, replace the hard-coded `canvas.width / 2` and preset-only `subtitleDesiredY` calculation with:

```js
const { x: subtitleX, y: subtitleY } = getSubtitleCanvasPosition(
  subtitleStyleValues,
  canvas.width,
  canvas.height,
  subtitleMetrics,
);
context.translate(subtitleX, subtitleY);
```

Keep the existing animation scale, opacity, font sizing, wrapping, colors, and `drawOverlay` call unchanged.

- [ ] **Step 4: Verify custom coordinates remain in existing render/persistence flows**

Do not add a new storage key or API field. The existing `normalizeSubtitleStyle`, `buildRemotionRenderProps`, editor history, and project persistence must carry the optional fields. Update only assertions needed to document that behavior.

- [ ] **Step 5: Run the focused tests to verify GREEN**

```powershell
cd dashboard
npx vitest run src/components/local-editor/localEditorExport.test.js src/components/local-editor/localEditorRender.test.js src/components/local-editor/localEditorPersistence.test.js
```

Expected result: all focused export/render/persistence tests pass.

- [ ] **Step 6: Commit export and persistence coverage**

```powershell
git add dashboard/src/components/local-editor/localEditorExport.js dashboard/src/components/local-editor/localEditorExport.test.js dashboard/src/components/local-editor/localEditorRender.test.js dashboard/src/components/local-editor/localEditorPersistence.test.js
git commit -m "feat: preserve subtitle coordinates through export"
```

### Task 5: Full verification, change-scope review, and live-app update

**Files:**
- Verify all files changed by Tasks 1–4.

- [ ] **Step 1: Run the complete dashboard quality gates**

From `dashboard`:

```powershell
npm run format
npm run format:check
npm run lint
npm test -- --run
```

Expected result: Prettier writes no unexpected changes, `format:check` passes, ESLint reports 0 errors and 0 warnings, and Vitest reports 0 failures.

- [ ] **Step 2: Run the standalone renderer build**

```powershell
cd ..\remotion
npm run build
```

Expected result: TypeScript exits 0.

- [ ] **Step 3: Inspect the final diff and GitNexus impact**

From the repository root:

```powershell
git status --short
git diff HEAD~4..HEAD --check
git diff HEAD~4..HEAD --stat
```

Run GitNexus before the final implementation commit/hand-off:

```text
detect_changes({ repo: "nier-platform", scope: "compare", base_ref: "main" })
```

Review that affected symbols are limited to subtitle style normalization, inspector state, subtitle composition positioning, canvas export, and their tests. Re-run `impact({ target_uid: "Function:dashboard/src/components/local-editor/localEditorStyles.js:normalizeSubtitleStyle", direction: "upstream", repo: "nier-platform" })` and confirm the previously identified CRITICAL shared path is covered by the full test suite.

- [ ] **Step 4: Commit any final formatting-only adjustments**

```powershell
git status --short
git add dashboard remotion
git commit -m "test: verify subtitle position controls"
```

Only stage files belonging to this feature; preserve unrelated user changes.

- [ ] **Step 5: Rebuild and restart the live local app**

From the repository root:

```powershell
.\scripts\manage-local.ps1 -Action Restart -Component frontend
```

Because the dashboard changes are frontend-only, restart the frontend component. Then verify:

```powershell
.\scripts\manage-local.ps1 -Action Status
```

Open the user-provided Brave URL, select Subtitles → Position, change X and Y, confirm the subtitle moves in the preview, and verify the values remain after a refresh or save-as-new-version flow. Report the implementation commit, test results, GitNexus scope, and live-app restart status.

## Plan self-review

- Spec coverage: UI controls and presets are covered by Task 2; coordinate schema and backward compatibility by Tasks 1–2; inline and Remotion preview parity by Task 3; browser canvas export and persistence by Task 4; required quality gates and live update by Task 5.
- Placeholder scan: no TODO, TBD, or unspecified implementation steps remain; every command has an expected result.
- Type consistency: all runtime boundaries use `position: "custom"`, optional numeric `positionX`, and optional numeric `positionY`; the dashboard and renderer helpers expose the same function names and semantics.
- Scope: no drag interaction, per-cue coordinates, new API route, or unrelated refactor is included.
