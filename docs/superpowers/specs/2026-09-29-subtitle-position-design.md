# Subtitle X/Y Position Controls

## Summary

Add track-wide subtitle positioning controls to the local clip editor. Users can keep the existing Top / Middle / Bottom presets or enter an exact X/Y location in the 1080 × 1920 output canvas. The position is stored with the existing subtitle style and is applied consistently to the editor preview, Remotion preview, backend render, and browser export.

## Decisions

- Position is track-wide, not per subtitle cue.
- X and Y are integer pixel coordinates in the output canvas.
- X is clamped to `0–1080`; Y is clamped to `0–1920`.
- Coordinates represent the visual center point of the subtitle group.
- Presets remain available and map to the existing visual anchors: top `12%`, middle `45%`, bottom `90%` of the output height; all presets use X `540`.
- Editing either coordinate switches the style to `custom` and preserves the other coordinate.
- Existing styles without coordinates continue to use their saved Top / Middle / Bottom position.
- Dragging subtitles in the video preview and per-cue positioning are out of scope.

## User experience

The existing Position section keeps its three preset buttons and adds two number inputs:

- `Subtitle X position` — range `0–1080`, step `1`
- `Subtitle Y position` — range `0–1920`, step `1`

When a preset is selected, its coordinate pair is shown. When a coordinate is edited, the preset buttons become inactive and the subtitle uses the custom point. Choosing a preset restores the corresponding preset coordinates. The inputs remain usable when no cues exist, but the existing empty-state guidance remains visible.

## Data and normalization

Extend `SubtitlePosition` with `custom` and extend `SubtitleStyle` with optional `positionX` and `positionY`. Add the same optional fields to the Zod subtitle style schema in both dashboard and renderer type definitions.

Add a shared positioning helper in each runtime boundary (dashboard and renderer) that:

1. Resolves preset coordinates from the output width and height.
2. Uses `positionX` / `positionY` for custom styles.
3. Rounds and clamps coordinates to the active output dimensions.
4. Returns percentages and a `translate(-50%, -50%)` transform for CSS positioning.

`normalizeSubtitleStyle` must retain old style shapes and must not invent custom coordinates for legacy preset styles. The inspector uses the resolver to display the effective coordinate pair. Custom coordinates are serialized through the existing editor history, project persistence, version manifest, and render props without a new endpoint.

Quick-pick templates continue to apply their existing visual styles. If a template specifies a preset position, it also clears any custom subtitle coordinates so the template's position is honored.

## Rendering and export

- The inline local-editor preview resolves the effective coordinates into percentages of its 9:16 preview frame.
- `dashboard/src/remotion/compositions/Subtitles.tsx` and `remotion/src/compositions/Subtitles.tsx` use the same center-point positioning contract for preview and rendered output.
- The browser canvas export path resolves the effective point against the actual canvas dimensions and centers the measured subtitle box on that point, while retaining its existing animation, wrapping, and clamping behavior.
- Existing subtitle reaction placement remains relative to the subtitle group and is not independently repositioned.

## Testing and verification

Add or update tests for:

- preset-to-coordinate resolution, custom coordinate rounding, and bounds clamping;
- style normalization of legacy and custom subtitle styles;
- inspector fields, preset selection, custom edits, and quick-pick reset behavior;
- inline preview and Remotion subtitle overlay placement;
- render props and browser canvas export placement.

Run the focused Vitest suites first, then the full dashboard formatter, formatter check, linter, and relevant test suite. Use GitNexus `detect_changes()` before the implementation commit and review the affected execution flows because the shared normalizer is a high-blast-radius symbol.

## Scope boundary

This change does not add preview dragging, keyframed positions, per-cue positioning, new API routes, or new subtitle style presets.
