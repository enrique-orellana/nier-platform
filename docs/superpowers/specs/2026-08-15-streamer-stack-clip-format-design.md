# Streamer Stack clip format

## Goal

Add a first-class streamer-style output format to the Clip Generator for single-recording videos that contain both a streamer facecam and gameplay. The format should produce a publish-ready 9:16 clip with the facecam above gameplay, matching the supplied reference, while preserving the existing Standard 9:16 crop and the current optional subtitle workflow.

## User-facing behavior

The Clip Generator adds a format selector:

- `Standard 9:16`: the existing behavior and default for backward compatibility.
- `Streamer Stack`: a facecam panel above a gameplay panel.

When `Streamer Stack` is selected:

- Facecam size is selectable as Small, Medium, or Large.
- Medium is the default.
- The AI-generated `viral_hook_text` is enabled by default.
- The hook can be disabled before generation.
- When enabled, the hook uses bold yellow text with a black outline and is placed across the facecam/gameplay boundary, matching the reference style.
- Subtitles remain independent and optional through the existing subtitle workflow.

The selector is part of the existing Clip Generator input flow, before the user starts processing a video. The selected settings apply to every clip in that generation job.

## Rendering model

The new layout is rendered during clip generation from the same source recording. It does not require separate facecam and gameplay files, a browser render, or a second manual composition step.

The output remains the existing master canvas: 1080x1920 at the source-compatible FPS, with audio preserved.

The Streamer Stack geometry uses normalized facecam panel heights:

- Small: 30% of the output height.
- Medium: 38% of the output height.
- Large: 46% of the output height.

The remaining height is the gameplay panel. Each panel is rendered independently:

1. The facecam panel uses the existing face/person tracking signals with adaptive zoom and a bounded crop. This keeps the streamer visible even when the source is horizontal or the facecam is a small region of the recording.
2. The gameplay panel uses a stable center/lower-biased crop of the same source frame. It must not inherit the facecam tracker’s horizontal movement.
3. The two panels are stacked into the output canvas with no unintended gap. The hook is composited after the panels so it can cross the boundary cleanly.

If no face is detected for a frame or scene, the facecam crop falls back to a centered crop. A missing hook string does not fail the render; it simply produces the layout without the hook.

## Data flow

The settings travel through the existing generation path:

1. `MediaInput` collects the format, facecam size, and hook-enabled state.
2. `App` includes those values in the existing `/api/process` request for both file and MinIO/URL inputs.
3. `app.py` validates the values, records them with the job, and forwards them to the Python worker command.
4. `main.py` accepts the layout settings, keeps the existing Standard path unchanged, and passes the settings through `render_clip_plan` into the per-clip renderer.
5. The clip manifest records the selected layout settings in its export policy and layer metadata.

The persisted format identifier is `streamer_stack`; requests that omit the new fields resolve to `standard` for backward compatibility. Invalid user input is rejected before the job is queued.

## Hook and subtitle behavior

The Streamer Stack generation path uses the existing clip-level `viral_hook_text` value. Hook rendering is enabled by default for this format and uses a dedicated streamer visual treatment. The existing hook action and its current styling remain unchanged for Standard clips and for later manual hook edits.

Subtitles are not automatically burned by the new format. Existing subtitle generation, translation, and editor controls remain available after the clip is generated. Applying subtitles to a Streamer Stack clip should operate on the already-composed 9:16 output.

## Backward compatibility

- Standard 9:16 remains the default and keeps its current tracking, output, and metadata behavior.
- Existing API clients that do not send the new fields continue to receive Standard output.
- Existing manifests without layout metadata remain readable.
- Existing ResultCard hook and subtitle actions continue to work against either output format.

## Validation and tests

The implementation will add focused coverage for:

- Format and facecam-size defaults in the Clip Generator input.
- Request payload propagation for file and remote-source processing.
- Backend validation and worker command propagation.
- Streamer Stack panel geometry for Small, Medium, and Large settings.
- Center-crop fallback when tracking has no face target.
- Hook enabled, disabled, and missing-text behavior.
- Preservation of Standard output behavior.
- Manifest metadata for the selected layout.
- Final output dimensions, FPS, and audio readiness.

Verification will include the focused Python and dashboard test suites, the dashboard production build, and GitNexus change-impact detection over the resulting diff.

## Scope boundaries

This feature does not add separate source tracks, automatic semantic detection of arbitrary overlay regions, a new subtitle system, or a new editor timeline track. The first version assumes the input is one recording containing both the streamer and gameplay and uses the existing tracking/cropping infrastructure plus explicit Small/Medium/Large framing presets.
