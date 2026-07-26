# Inline Subtitle Cue Editing Design

## Goal

Make subtitle cues visible and manually editable directly in the full-screen editor timeline, while preserving separate original and translated tracks.

## Behavior

- Normalize subtitle data from both `manifest.subtitle_tracks` and the legacy `manifest.layers.subtitles` shape.
- Render every cue as a labeled bar on its language track, with start/end positions expressed in seconds and snapped to the editor FPS.
- Single-click selects a cue. Enter or double-click enters inline text-edit mode inside the cue bar.
- Enter or blur commits text; Escape restores the previous text.
- Dragging moves a cue by frame-snapped increments. Start/end handles resize it with a one-frame minimum and bounded duration.
- Existing original and translated tracks remain separate; changing one cue does not mutate another track.
- The draft adapter writes edited cue text and millisecond boundaries back into the corresponding subtitle track without mutating the saved manifest.

## UI boundaries

`DesignComboTimeline` owns cue visibility, selection, inline editing, drag/resize, and keyboard commit/cancel. `FullScreenEditor` remains the draft owner. The existing subtitle inspector remains available for precise numeric timing and track selection, but inline text editing is the primary path.

## Validation

- Adapter tests cover legacy subtitle fallback and manifest round-trip immutability.
- Timeline tests cover visible cue labels, Enter/double-click editing, Escape cancellation, and frame-snapped movement.
- Full-screen editor tests cover selecting a subtitle cue and committing inline text into draft state.
- Run the dashboard test suite, lint, and build before deployment.
