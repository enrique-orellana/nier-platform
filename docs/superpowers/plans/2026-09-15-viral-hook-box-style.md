# Viral Hook Box Style Implementation Plan

## Goal

Add a `Box style` setting to viral hooks with `Rounded` (existing default) and `Headline cards` (separate rectangular card for each non-empty explicit line), while keeping text/font/color/size/position/timing/animation independently configurable across preview and export paths.

## Files and responsibilities

- `dashboard/src/remotion/lib/types.ts` and `remotion/src/lib/types.ts`
  - Add the optional `boxStyle` type and schema field.
  - Keep the field optional so old payloads default safely.
- `dashboard/src/remotion/lib/hookVisual.js` and `remotion/src/lib/hookVisual.ts`
  - Add shared box-style normalization and line splitting.
  - Keep the existing rounded style output unchanged.
  - Add headline-card geometry and line-stack helpers.
- `dashboard/src/remotion/compositions/HookOverlay.tsx` and `remotion/src/compositions/HookOverlay.tsx`
  - Render the hook as one animated group.
  - Render one child card per non-empty explicit line for `headline_cards`.
  - Preserve the existing single-box behavior for rounded hooks.
- `dashboard/src/components/local-editor/LocalEditorHookInspector.jsx`
  - Add `Box style` controls and the line-break hint.
  - Change only `boxStyle` when a choice is selected.
- `dashboard/src/components/local-editor/LocalEditorHookInspector.test.jsx`
  - Verify both choices and that unrelated hook fields are preserved.
- `dashboard/src/components/local-editor/localEditorRender.js`
  - Preserve `boxStyle` while normalizing render props.
- `dashboard/src/components/local-editor/localEditorRender.test.js`
  - Verify the render contract carries the new field and defaults remain safe.
- `dashboard/src/components/local-editor/LocalEditorTab.jsx`
  - Make the native preview fallback use the same line/card helpers and box treatment.
- `dashboard/src/components/local-editor/localEditorExport.js`
  - Draw headline cards in browser canvas export with the same geometry and configured visual properties.
- `dashboard/src/components/local-editor/localEditorExport.test.js`
  - Verify the canvas drawing path creates one background card per non-empty line.
- `dashboard/src/remotion/lib/hookVisual.test.js` and `dashboard/src/remotion/compositions/HookOverlay.test.jsx`
  - Add helper and composition regression coverage for defaults, styles, empty lines, and grouped animation.

## Implementation sequence

### 1. Establish failing tests

Add tests for the new box-style normalization, line splitting, inspector control, render-prop preservation, Remotion card rendering, and canvas export drawing. Run the focused dashboard tests and confirm they fail for the missing behavior.

### 2. Implement the shared contract

Add `boxStyle?: "rounded" | "headline_cards"` to both HookConfig interfaces and optional schema fields. Normalize missing or unknown values to `rounded`. Add helpers that split explicit newlines, remove empty lines only for headline cards, and return style values while leaving configured colors, font, size, alignment, and animation untouched.

### 3. Update both Remotion compositions

Use the shared helpers in both composition copies. Preserve the current rounded DOM shape and styles. For headline cards, place the non-empty line cards in a vertically stacked group anchored by the existing position style and apply the existing animation style to the group.

### 4. Update editor controls and previews

Add the two-option box-style selector to the Viral Hook inspector. Ensure `onChange` receives only the changed `boxStyle` field. Add the line-break hint. Update the native preview fallback to render the same card stack, and ensure `buildRemotionRenderProps` carries the field unchanged.

### 5. Update browser canvas export

Refactor the hook drawing portion to use the shared line/card behavior. Draw card backgrounds and text using the configured hook properties, with the existing animation transform/opacity applied to the whole group. Keep rounded hooks on the current drawing path.

### 6. Verify and polish

Run focused tests, then the full required dashboard formatting/lint checks. Inspect the diff and GitNexus change impact. Restart the frontend component, check service status, and manually verify in Brave that switching box style does not alter the other hook controls and that explicit line breaks produce separate cards in preview and export.

## Test commands

From `dashboard`:

```powershell
npm run test -- --run src/remotion/lib/hookVisual.test.js src/remotion/compositions/HookOverlay.test.jsx src/components/local-editor/LocalEditorHookInspector.test.jsx src/components/local-editor/localEditorRender.test.js src/components/local-editor/localEditorExport.test.js
npm run format
npm run format:check
npm run lint
```

Then run the repository’s relevant render-service/remotion type check if available, followed by the Brave smoke test and live frontend restart.
