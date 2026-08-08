# Editor Actions Card

## Goal

Move the seven workflow actions out of the fixed, full-width strip beneath the
editor header and into the inspector so the workspace keeps its vertical space
and the video preview is not visually crowded.

## Design

- `EditorActionToolbar` remains the single owner of the seven workflow buttons,
  loading states, disabled states, and error message.
- The toolbar becomes a normal flow card rendered at the top of the right
  inspector, before the inspector controls and version history.
- The card has an `Actions` heading and uses a two-column grid at inspector
  widths, collapsing to one column on narrow screens.
- Existing button colors, labels, callbacks, loading indicators, and the
  accessible `Editor actions` region name remain unchanged.
- The fixed positioning, elevated z-index, backdrop blur, and full-width strip
  styling are removed so the card cannot cover the header, preview, or
  timeline.
- Header actions remain limited to undo/redo, export, reset, and close.

## Components and data flow

`FullScreenEditor` passes the existing `editorActions` object to
`EditorActionToolbar` inside the inspector. No callbacks, state ownership, or
API behavior changes. The toolbar receives the same props in both the local
editor and full-screen editor paths.

## Testing

- Keep the existing toolbar interaction and disabled-state tests.
- Add a regression assertion that the toolbar renders an `Actions` heading and
  uses the inspector-card layout rather than fixed positioning.
- Run the focused editor tests, the full dashboard test suite, and the
  dashboard production build.
