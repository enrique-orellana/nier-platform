# Local editor timeline cue actions

## Goal

Add the timeline cue-editing actions shown in the editor reference: split the selected cue at the playhead, delete the selected cue's left portion, and delete its right portion.

## Design

- Add three compact buttons to the existing local-editor timeline action toolbar.
- Buttons are disabled unless a subtitle cue is selected and the playhead is strictly inside that cue. This avoids creating zero-length cues or silently editing the wrong track.
- Split preserves the original cue's text/style metadata, creates a second cue with a unique id, and selects the right-hand result.
- Delete left trims the selected cue start to the playhead; delete right trims its end to the playhead. The resulting cue remains selected.
- The actions are undoable through the existing editor history and also respond to `Ctrl/Cmd+B`, `Q`, and `W` while the timeline workspace is focused. Existing text-entry controls and marker shortcuts remain unaffected.

## Implementation boundaries

- Keep the timeline component presentational. The parent editor owns history, selection, and cue updates.
- Put split/trim calculations in pure timeline-model helpers so the edge conditions are directly unit tested.
- Reuse the existing timeline update and history pathways rather than adding a second mutation mechanism.

## Verification

- Unit tests cover split metadata/ids and left/right trim boundaries.
- Local-editor tests cover button enablement, action dispatch, selection, keyboard shortcuts, and undo history integration.
- Run the dashboard formatter, format check, lint, focused tests, and production build.
