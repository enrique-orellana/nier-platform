# Viral Hook Pixel Coordinate Positioning

## Goal

Allow the Local Editor's Viral Hook to be positioned with explicit pixel coordinates while preserving the existing Top, Center, and Bottom presets. The hook's coordinate is its visual center point, measured from the top-left of the output video canvas.

## User behavior

- The Layout section keeps the existing `Top`, `Center`, and `Bottom` preset buttons.
- The section also shows `X (px)` and `Y (px)` number inputs.
- The inputs always display the currently resolved position, including the values produced by a preset.
- Editing either coordinate switches the hook to `Custom` and stores the edited coordinates.
- Selecting a preset restores its standard position and clears the custom coordinates.
- Coordinates are integer pixels and are clamped to the output canvas bounds.
- A small `Custom` indicator makes the current positioning mode explicit.

## Data contract

Extend the hook configuration with:

- `position: "top" | "center" | "bottom" | "custom"`
- optional `positionX: number`
- optional `positionY: number`

Custom coordinates are stored only when the hook is in `custom` mode. Existing manifests that contain only a legacy preset continue to render with their current behavior.

Preset coordinates are resolved from the render dimensions:

- `center`: `(width / 2, height / 2)`
- `top`: `(width / 2, height * 0.08)` for standard layouts
- `bottom`: `(width / 2, height * 0.82)` for standard layouts
- `streamer_stack` top: `(width / 2, current facecam boundary Y)`

The resolved coordinate helper is the single source of truth for the inspector, Remotion preview/export, and the native canvas fallback. Custom pixel coordinates are converted to percentages only at the display layer so preview and render share the same output-space position.

## Components and flow

1. `LocalEditorHookInspector` renders the preset buttons, coordinate inputs, and custom-mode indicator.
2. Editing an input sends a normalized hook through the existing `onChange`/history path.
3. Local editor state and version manifests persist the position mode and custom coordinates.
4. `buildRemotionRenderProps` forwards the complete hook position contract to browser and backend render jobs.
5. The shared hook visual helper resolves preset or custom coordinates for Remotion and the native preview/export path.

No drag interaction is included in this change; numeric pixel inputs are the positioning control.

## Validation and compatibility

- Non-finite values are rejected or replaced with the current resolved value.
- `X` is clamped to `0..outputWidth`; `Y` is clamped to `0..outputHeight`.
- Output dimensions come from the active render configuration, with the existing vertical-video dimensions as fallback.
- Missing or invalid position data falls back to the legacy preset behavior.
- Existing color, size, timing, entrance, and streamer-stack behavior remain unchanged.

## Verification

Add regression coverage for:

- preset coordinate resolution, including streamer-stack boundaries;
- switching to `custom` when X or Y is edited;
- resetting custom positioning through a preset;
- coordinate clamping and invalid input handling;
- manifest/render-prop persistence;
- identical custom positioning in Remotion and native preview paths.

Run the dashboard formatter, format check, lint, focused tests, and production build before implementation is considered complete.

## Impact note

The shared hook-position helper has a high GitNexus blast-radius classification because it feeds LocalEditor, Full Screen Editor, and application render flows. The implementation will preserve the old preset branch and add custom positioning behind an explicit mode so legacy data remains backward-compatible.
