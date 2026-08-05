# Local Editor Subtitle Generation Design

## Goal

Allow the standalone `/editor` to generate timed subtitles from its uploaded local video while keeping the existing browser editor workflow, subtitle styling, and undo/redo history intact.

## Scope

- Add a `Generate subtitles` control to the existing collapsed-by-default Subtitles panel.
- Send the local video to the OpenShorts backend through a dedicated multipart endpoint.
- Transcribe with the existing local `faster-whisper` integration using the multilingual `large-v3` model.
- Convert transcript segments into the local editor cue shape: `id`, `text`, `startMs`, and `endMs`.
- Replace existing subtitle cues only after successful transcription and record the replacement as one editor history action.
- Preserve the current subtitle style, imported-cue behavior, table/timeline editing, persistence, and undo/redo.

## Model decision

`faster-whisper` is the current local inference engine and `large-v3` is the model. It remains the default because the editor must support multilingual videos and word-level timing without sending media to a third-party service. A future model benchmark can add an alternate backend, but is outside this change.

## Architecture and data flow

1. The user selects a video in `/editor`.
2. The editor posts the `File` as multipart form data to `/api/local-editor/transcribe`.
3. The backend writes the upload to a temporary file in the configured upload directory.
4. A worker thread calls the existing `transcribe_video` function so the async API remains responsive.
5. The endpoint returns detected language and normalized transcript segments.
6. The editor clamps valid segments to the loaded video duration, filters invalid/empty cues, and commits the generated cue set through `commitEdit`.
7. The generated cues are immediately available in the preview, timeline, cue table, subtitle inspector, export, persistence, and history controls.

## UI behavior

- The generation action is visible inside the expanded Subtitles panel beside Import subtitles.
- While generating, the action is disabled and displays a spinner/`Transcribing…` label.
- Existing cues remain untouched while generation is running.
- A failed request displays an inline error and leaves the current cue set unchanged.
- If cues already exist, the user confirms replacement before the request starts.
- Empty transcripts are treated as an error rather than clearing the current subtitles.

## Validation and cleanup

- The endpoint accepts only video uploads and rejects missing/invalid files.
- Temporary files are removed in a `finally` block.
- The editor ignores empty text and non-positive cue durations and clamps all remaining cues to the actual duration.
- Backend errors return an actionable message without leaking temporary filesystem paths.

## Testing

- Backend tests cover a successful multipart transcription response and a rejected invalid upload; the model call is isolated behind the existing transcription function.
- Local editor tests cover the generate button request, generated cues appearing in the timeline/table, replacement confirmation, error preservation, and one-step Undo removing the generated cue set.
- Full frontend tests, lint, and production build must pass before deployment.

