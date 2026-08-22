# Local editor cue UI

## Goal

Make subtitle cues feel editable and scannable without adding more permanent chrome to the compact editor timeline.

## Approved direction

Use the editor-first timeline treatment (option A):

- Normal cues remain compact purple blocks with readable leading text and ellipsis when space is limited.
- The cue under the playhead gets a distinct cyan current-state treatment.
- The selected cue gets a bright focus border and a subtle cyan relationship to the playhead.
- Hovering a cue reveals lightweight editing affordances rather than making every cue visually busy.
- Cue selection remains synchronized between the timeline and cue table.
- Existing cue resizing, double-click editing, keyboard selection, and table editing remain intact.

## Interaction details

- Click selects a cue.
- Double-click opens the existing cue editor.
- The current cue is derived from the playhead and is visually distinct from the selected cue.
- The cue text is available in a native tooltip when the rendered block is too narrow.
- Resize handles remain available at the cue edges and are visible on hover/selection.

## Scope

The change is limited to `LocalEditorTimeline` and `SubtitleCueTable` presentation and interaction affordances. No subtitle data model or persistence format changes are needed.

## Verification

- Add component tests for current/selected/hover states and cue accessibility labels.
- Run focused local-editor tests, then dashboard formatting and lint checks.
