# Full Source Video Transcript Editor

## Goal

Let a user open the complete source video in the existing project editor, review and correct its timed transcript, and have those corrections update the original subtitle track on every generated clip without changing any clip boundaries.

## User flow

1. On a project detail page, the user chooses **Edit full video**.
2. The existing full-screen editor opens in source mode, using the same source media shown in the project preview.
3. The preview and timeline cover the whole source from `0` to its known duration. The editor shows the complete original transcript as timed, editable subtitle cues.
4. Saving writes the corrected transcript to the project’s shared source record and refreshes the original/generated subtitle track for every existing clip using that clip’s current start and end times.
5. The project detail view reflects the updated transcript-derived captions after save.

## Editor behavior

- Reuse the existing full-screen editor and subtitle cue timeline; source mode changes the video and time range, not the editing experience.
- Resolve the source from the project’s persisted source metadata, including historical jobs stored in S3. Use renewable media URLs so the editor can stream the same source as the project preview.
- Keep source timecodes in the shared transcript. Convert them to editor-relative cue times only for display; convert edited cues back to source timecodes on save.
- Display all transcript segments across the source, not only the active generated clip’s range.
- If the source or transcript cannot be loaded, show a clear actionable error and do not open an empty editor.

## Save and propagation

- Persist the corrected source transcript as the shared source of truth.
- Rebuild the original/generated subtitle cues for every clip from that transcript and that clip’s existing source range.
- Preserve clip start/end times, clip ordering, selection metadata, subtitle style, translated tracks, and manually authored subtitle tracks.
- Update the stored project result and source metadata so reloading the project or opening a clip editor shows the same corrected captions.
- Show a saving state and a success or error result. If persistence is partial, report the failure and keep the editor draft available for retry; do not mark the change as applied.

## Boundaries

- Do not rerun AI clip selection or change clip cut points.
- Do not automatically render or re-encode the source or generated videos; this feature updates the transcript and editable subtitle tracks.
- Do not overwrite translated or manually authored subtitle tracks.
- Keep existing per-clip editing behavior and routes intact.

## Acceptance scenarios

- Opening **Edit full video** from a project plays the source and displays a timeline spanning its complete duration.
- Transcript cues before, within, and after every generated clip are visible and editable in that editor.
- Saving a correction updates the source transcript and the original subtitle track of every clip that overlaps the edited source time.
- A clip editor opened after saving shows the corrected text at the same clip-relative times; its source start and end remain unchanged.
- Translated or manually authored tracks remain intact.
- Reloading the project preserves the saved transcript and updated original tracks.
- Existing clip editor URLs continue to open the selected clip with its prior range.
