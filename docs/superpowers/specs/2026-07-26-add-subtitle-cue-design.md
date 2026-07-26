# Add Subtitle Cue Design

## Goal

Allow an editor to create a new subtitle cue at the current shared playhead position, then edit it using the existing subtitle inspector and save it as part of the next immutable version.

## Approved interaction

- The Inspector shows an `Add subtitle cue` action when a subtitle track is available.
- The new cue is inserted into the currently active subtitle track.
- Its start is the current playhead, converted to milliseconds and clamped to the clip duration.
- Its default end is `min(start + 2000ms, duration)`; if less than one second remains, the cue is one frame long.
- The cue starts with blank text, is selected immediately, and receives focus in the text editor.
- Existing drag, resize, inline-edit, delete, translation-track, and version-save behavior remains unchanged.

## Data flow

The editor state remains the source of truth. Cue creation adds a normalized timeline item to the active `subtitles-*` track. `editorStateToManifest()` serializes it into the track's `cues` and `captions` arrays, so the existing immutable render/version endpoint persists it without a new backend API.

## Validation

- Do not create a cue when no subtitle track exists; show an actionable empty state directing the user to select/generate a track.
- Clamp start/end to the clip duration and preserve a positive frame-aligned duration.
- Generate a stable unique item id that cannot collide with existing cues.

## Testing

- Unit test cue creation at a non-zero playhead, including duration clamping and selection.
- Verify the new item serializes into both `subtitle_tracks[].cues` and `subtitle_tracks[].captions`.
- Verify the inspector opens with the new cue and existing delete/edit behavior still works.
