# Per-Segment Streamer Gameplay Framing

## Goal

Allow the editor to choose the exact gameplay portion shown by each Streamer
layout segment. A clip can alternate between Standard and Streamer layouts,
and every Streamer segment can use a different gameplay framing while the
webcam settings, subtitles, hooks, audio, and effects remain continuous.

This specification extends the existing layout-segment behavior and supersedes
the earlier rule that all Streamer segments must use one shared gameplay crop.

## Approved interaction

When a Streamer segment is selected in the Layout track, the timeline toolbar
shows a compact crop/framing action. Standard segments do not show this action.

Activating it enters gameplay-framing mode in the preview:

1. The selected Streamer gameplay panel becomes an interactive source view.
2. The effective gameplay crop is shown as a bright frame; the area outside it
   is dimmed.
3. Dragging the frame pans the gameplay focus.
4. Corner handles and the mouse wheel adjust the crop zoom.
5. The frame is constrained to the clip's existing `gameplay_region`, so the
   user cannot expose the webcam or an unrelated source area.
6. Reset removes the segment override and returns to the clip-level framing.
7. Clicking away or choosing Done exits framing mode without changing timeline
   selection.

The frame represents the actual gameplay panel crop derived from the output
dimensions and the selected facecam size. The UI must not promise a fixed crop
shape when the facecam size changes; it always mirrors the crop used by the
renderer.

## Data model

The existing clip-level settings remain valid and continue to provide defaults:

```json
{
  "gameplay_region": {"x": 0.28, "y": 0.08, "width": 0.70, "height": 0.84},
  "gameplay_zoom": 1.0
}
```

Each `LayoutSegmentConfig` gains optional overrides:

```json
{
  "id": "layout-2",
  "startMs": 8000,
  "endMs": 16000,
  "format": "streamer_stack",
  "gameplay_focus": {"x": 0.62, "y": 0.44},
  "gameplay_zoom": 1.18
}
```

`gameplay_focus` is a normalized source point and `gameplay_zoom` uses the
existing bounded zoom range. The renderer resolves them as:

- segment override when present;
- otherwise the clip-level value;
- otherwise the existing centered/default behavior.

The outer clip-level `gameplay_region` remains the source boundary. The segment
override changes the focus and zoom inside that boundary rather than replacing
the validated gameplay area. This preserves the existing manual gameplay
selection and prevents a segment edit from accidentally including the webcam.

Splitting a segment copies its framing overrides into both resulting segments.
Resetting a segment removes only that segment's overrides. Older manifests with
no segment framing fields render exactly as before.

## Preview and rendering architecture

The preview and final renderer use one crop-resolution contract:

```text
effective gameplay region
  + effective zoom
  + effective focus
  + source dimensions
  + current gameplay-panel dimensions
  -> normalized crop rectangle
```

The existing crop math remains the source of truth. The interactive editor uses
the same normalized crop rectangle to draw the frame, while Remotion uses it to
position the video. No per-segment video files or extra transcodes are created.

During a layout transition, the previous and active Streamer layers each use
their own resolved framing. Standard layers continue to use their current
behavior. Only the video layout changes; subtitles, hooks, audio, and effects
remain single continuous layers.

## Persistence

- The local editor snapshot stores the optional framing fields in each layout
  segment.
- The version manifest stores them under `layers.layout.segments`.
- Save/load, undo/redo, version export, preview props, and render props preserve
  the fields without requiring a new API endpoint.
- The Remotion input schema validates normalized focus coordinates and the
  existing zoom bounds while retaining backward compatibility with old
  manifests.

## Performance and safety

- Pointer movement updates the visible frame locally and does not create an
  undo entry for every pointer event.
- A single edit is committed on pointer-up, with a small throttled preview
  update if needed.
- Crop math is pure arithmetic; it does not decode a second video or run
  tracking during dragging.
- Invalid or out-of-range persisted values fall back to the clip-level framing
  rather than producing an invalid render.
- The framing controls are unavailable for Standard segments and when no valid
  gameplay region exists.

## Testing

### Timeline and persistence

- Segment framing fields round-trip through normalization and local editor
  persistence.
- Splitting copies focus and zoom to both new segments.
- Reset removes only the selected segment override.
- Undo/redo treats one completed drag as one edit.
- Legacy manifests without segment framing fields retain existing behavior.

### Crop resolution and composition

- Segment values override clip-level focus and zoom.
- Missing segment values inherit clip-level values.
- Focus remains bounded to the gameplay region.
- Resolved crops match the actual gameplay panel dimensions for each facecam
  size.
- Standard/Streamer transitions use the correct framing for each layer.
- Subtitles and hooks remain unaffected at layout boundaries.

### UI

- The framing action appears only for a selected Streamer segment.
- The crop frame, dimmed outside area, drag, resize/zoom, reset, and Done
  behavior are accessible and responsive.
- Deselecting the Layout track closes framing mode without selecting another
  timeline track.

## Non-goals

- Independent webcam framing per layout segment.
- Animated/keyframed gameplay focus within one segment.
- Automatic gameplay-region detection or tracker changes.
- Additional transition types.
- Per-segment subtitle, hook, audio, or effects tracks.
