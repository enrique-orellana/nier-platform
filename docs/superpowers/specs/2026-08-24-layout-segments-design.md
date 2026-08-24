# Per-Section Standard and Streamer Layouts

## Goal

Allow the editor to alternate between Standard and Streamer layouts across one continuous clip, using CapCut-style timeline cuts while keeping subtitles and hooks clean and continuous.

## Approved behavior

- The editor displays a dedicated `LAYOUT` track beneath the video track.
- A new clip starts with one full-duration `standard` layout segment.
- `Split at playhead` cuts the selected layout segment.
- Both resulting segments inherit the original segment's layout and transition settings.
- Selecting a layout segment exposes `Standard` and `Streamer` controls.
- Changing the layout affects only the selected segment.
- Streamer segments reuse the clip-level Streamer settings:
  - webcam region
  - gameplay region
  - facecam size
  - gameplay zoom
  - Streamer tracking setting
- Layout segments are contiguous, non-overlapping, and limited to the clip duration.
- Splitting at a segment boundary is ignored.
- Undo/redo covers split, layout changes, and transition changes.

## Transitions

- The default transition is `cut`.
- A segment boundary may optionally use `crossfade`.
- Crossfade duration defaults to 250 ms and is persisted with the boundary/segment data.
- Transitions affect only the video composition layer.
- Subtitles and hooks are not duplicated, crossfaded, or restarted during layout transitions.

## Overlay behavior

Subtitles, hooks, and their animations remain independent from the Layout track:

- Subtitles render as one continuous overlay track using the existing clip-relative timings.
- Each hook renders once for its configured duration.
- Hook position, animation, color, and styling remain stable across a layout boundary.
- The video composition changes underneath the overlays.
- Effects remain continuous and are not split automatically by layout cuts.

## Persistence format

The existing single-layout manifest remains valid. New or edited manifests may add layout segments under `layers.layout`:

```json
{
  "layers": {
    "layout": {
      "format": "standard",
      "facecam_size": "medium",
      "segments": [
        {
          "id": "layout-1",
          "startMs": 0,
          "endMs": 8000,
          "format": "standard",
          "transition": "cut"
        },
        {
          "id": "layout-2",
          "startMs": 8000,
          "endMs": 16000,
          "format": "streamer_stack",
          "transition": "crossfade",
          "transitionDurationMs": 250
        }
      ]
    }
  }
}
```

Compatibility rules:

- If `segments` is missing, the renderer treats the legacy `format` as one full-duration segment.
- The clip-level Streamer settings remain the source of truth for every Streamer segment.
- Saved versions, reloads, preview, and export must preserve the segment list.

## Rendering architecture

The layout resolver determines the active format from the current composition frame. The render order is:

1. Standard/Streamer video composition and optional transition.
2. Continuous video effects.
3. One subtitle layer.
4. One hook layer.

The preview and exported version must use the same layout-segment representation and resolver so they do not diverge.

## Editor interaction

- The Layout track uses the same timeline coordinate system as the existing video and subtitle tracks.
- Segment blocks are visually distinct: Standard uses the existing standard-track color and Streamer uses a separate highlighted color.
- The selected segment is visibly outlined.
- The segment inspector/toolbar contains:
  - layout buttons: `Standard`, `Streamer`
  - transition selector: `Cut`, `Crossfade`
  - crossfade duration control when `Crossfade` is selected
  - `Split at playhead`
- Segment selection does not alter subtitle, hook, audio, or effect selection.

## Error handling and validation

- Invalid layout formats fall back to `standard` or produce the existing validation error at the boundary where layout input is accepted.
- Segment times are clamped to the clip duration.
- Zero-length and overlapping segments are rejected or normalized before rendering.
- Crossfade durations are clamped so they fit within the adjacent segment durations.
- Missing Streamer regions continue to use the existing Streamer validation behavior.

## Testing requirements

### Timeline model

- Creates the default full-duration Standard segment.
- Splits an interior playhead into two contiguous segments.
- Preserves layout and transition settings on split.
- Ignores boundary splits.
- Changes only the selected segment's layout.
- Includes segment edits in undo/redo.

### Manifest and rendering

- Round-trips layout segments through manifest conversion.
- Resolves legacy single-layout manifests as one segment.
- Resolves Standard and Streamer formats at the correct frames.
- Applies optional crossfade only to the video composition.
- Keeps subtitles and hooks single-instance and stable across layout boundaries.
- Preserves segment data through save/load and version export.

### UI

- Renders the Layout track with correct segment widths and labels.
- Enables/disables split based on the selected segment and playhead position.
- Updates only the selected segment when Standard or Streamer is chosen.
- Shows the transition duration control only for Crossfade.

## Scope exclusions

- No independent Streamer-region editing per segment.
- No automatic splitting of subtitles, hooks, audio, or effects.
- No transition library beyond Cut and Crossfade in the first implementation.
- No pre-rendering of each segment as a separate video file.
