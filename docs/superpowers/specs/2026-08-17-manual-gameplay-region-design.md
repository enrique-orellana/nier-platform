# Manual Streamer Stack Gameplay Region

## Goal

Make Streamer Stack usable without mandatory face/person recognition. For each
clip, the user manually selects both the webcam area shown in the upper panel
and the gameplay/screen area shown below it. The gameplay area uses a fill-style
mobile crop so the lower panel is completely filled, even when that means
cropping the edges of the selected rectangle.

Face/person tracking remains available as an explicit per-clip option, but it is
disabled by default. When disabled, Streamer Stack must not load or execute the
detector/tracker for that clip.

## User experience

### Per-clip controls

For a `streamer_stack` clip, the result card exposes:

1. `Select Webcam Area` or `Edit Webcam Area`.
2. `Select Gameplay Area` or `Edit Gameplay Area`.
3. `Use Face/Person Tracking`, an unchecked toggle by default.
4. `Analyze & Render`.

The render action remains disabled until both normalized rectangles are saved.
The existing facecam-size setting (`small`, `medium`, or `large`) continues to
control the upper panel height.

The selector interaction is consistent for both rectangles: show the source
video, darken the unselected area, and allow the user to draw, move, resize, or
reset the selected rectangle. The current rectangle is displayed on the source
frame before saving.

Standard 9:16 clips do not show or require these controls and keep their current
behavior.

## Layout behavior

The output remains 1080×1920 with the existing facecam-size split:

- The selected webcam rectangle is cropped to the upper panel aspect ratio and
  resized to the full panel width.
- The selected gameplay rectangle is cropped to the lower panel aspect ratio,
  centered within the selected rectangle, and resized to fill the lower panel.
- No detector-driven focus is applied when tracking is disabled.

This is the selected “manual fill” behavior: the lower panel has no letterbox
padding, but the source rectangle can lose content at its edges when its aspect
ratio differs from the lower panel.

When tracking is enabled, detection is limited to candidates inside the manual
gameplay rectangle and outside the manual webcam rectangle. The tracker may
adjust the lower-panel crop focus within the selected gameplay bounds. If no
usable candidate is found, rendering falls back to the centered manual
gameplay crop. The webcam panel remains based on the manually selected webcam
rectangle.

## Data and API contract

Clip metadata gains:

```json
{
  "webcam_region": {"x": 0.02, "y": 0.10, "width": 0.26, "height": 0.35},
  "gameplay_region": {"x": 0.28, "y": 0.08, "width": 0.70, "height": 0.84},
  "streamer_tracking_enabled": false
}
```

All rectangle coordinates are normalized to the source frame and must have
positive dimensions while remaining inside `[0, 1]`.

The backend adds per-clip persistence endpoints for the gameplay rectangle and
tracking flag. Saving either selection updates the parent deferred job result
and its metadata sidecar atomically. Starting a child render copies both
regions and the tracking setting into child metadata.

The render request rejects a Streamer Stack clip with a clear `409` response if
the webcam or gameplay rectangle is missing or invalid. A missing tracking flag
means `false` for backward compatibility.

## Processing flow

1. Clip discovery continues to find and persist clips without rendering.
2. The user selects the webcam and gameplay rectangles for an individual clip.
3. The user optionally enables face/person tracking for that clip.
4. Analyze & Render starts the deferred child render.
5. The worker validates the layout and both rectangles before opening expensive
   detector resources.
6. The worker crops the webcam rectangle for the upper panel.
7. If tracking is disabled, the worker crops the gameplay rectangle directly.
8. If tracking is enabled, the worker detects candidates only within the
   gameplay region, tracks a focus, and clamps the resulting crop to that
   region. Detection failure falls back to the centered manual crop.
9. The composed frame is encoded with the existing output policy and merged
   with the trimmed source audio.

## Error handling and compatibility

- Invalid coordinates are rejected consistently by the Python and Go layers.
- Missing gameplay selection prevents accidental rendering with an unintended
  centered crop.
- Detector initialization or inference errors are avoided entirely when the
  tracking toggle is off.
- Tracking errors do not invalidate the manual composition; they fall back to
  the saved gameplay rectangle and are reported in job logs when applicable.
- Existing standard clips are unaffected.
- Existing Streamer Stack clips that only have a webcam rectangle will need a
  gameplay rectangle selected before their next render, but their saved source
  and prior outputs remain intact.

## Testing

### Python

- Normalize and validate gameplay rectangles.
- Crop gameplay regions with fill-style aspect handling.
- Verify Streamer Stack skips detector/tracker calls when tracking is disabled.
- Verify enabled tracking is bounded by the manual gameplay region.
- Verify detector failure falls back to the centered manual gameplay crop.
- Verify standard layout behavior is unchanged.

### Go

- Persist gameplay rectangles and the tracking flag.
- Reject incomplete or invalid Streamer Stack render requests.
- Copy the new fields into child render metadata.
- Preserve atomic sidecar updates.

### Frontend

- Draw, move, resize, reset, and save the gameplay selector.
- Keep the per-clip state independent between result cards.
- Gate Streamer Stack rendering until both regions are saved.
- Default the tracking toggle to off and send the selected value.
- Leave standard 9:16 controls unchanged.

## Non-goals

- Animated or keyframed gameplay rectangles.
- Automatic webcam-region discovery.
- Face identity recognition or speaker identification.
- Changes to normal 9:16 cropping.
- New encoding formats or GPU-specific encoder behavior.
