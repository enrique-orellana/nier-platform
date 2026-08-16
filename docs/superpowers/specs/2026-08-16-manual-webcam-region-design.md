# Manual Webcam Region per Clip

## Status

Approved interaction direction: one static webcam rectangle selected separately
for each clip before rendering.

## Problem

The current Streamer Stack path uses person detection on the complete source
frame to choose the Facecam crop. In recordings that contain both a webcam and
game characters, the detector can select the wrong person or jump between people.

The user needs direct control over the webcam region. The selected webcam area
must be used for the Facecam panel, and person detection must operate only in the
remaining gameplay area.

## Goals

- Let the user select one webcam rectangle for each discovered clip.
- Show the complete source frame while selecting, so the coordinates are based on
  the original landscape video rather than the vertically cropped card preview.
- Store the selection with the individual clip.
- Use the selected rectangle as the Facecam source for the entire clip.
- Exclude the selected rectangle from person/face detection.
- Preserve deferred rendering: selection happens after discovery and before the
  user clicks **Analyze & Render**.
- Keep the existing Standard 9:16 behavior unchanged.

## Non-goals

- No automatic webcam-region detection.
- No keyframed or moving webcam rectangle in the first version.
- No face-recognition identity model.
- No project-wide webcam template; each clip owns its own selection.
- No change to scene discovery or clip candidate generation.

## User flow

1. The user opens a discovered clip in the Projects view.
2. For a Streamer Stack clip, the card shows **Select Webcam Area**.
3. The user opens the selector and sees the full source preview for that clip's
   start/end range.
4. The user draws, moves, or resizes one rectangle around the webcam.
5. The preview visibly distinguishes:
   - the selected webcam region, and
   - the inverse gameplay/detection region.
6. The user clicks **Save Area**.
7. The selection is persisted for that clip and the card shows the saved state.
8. **Analyze & Render** is enabled only after a valid webcam region is saved.
9. Rendering uses the saved region and the inverse detection mask.

The first version treats the selection as static for the whole clip. If the
webcam moves later, the next design can add keyframes without changing the
stored coordinate model's basic meaning.

## Data contract

Store the rectangle in normalized source coordinates so it remains valid across
preview sizes and source resolutions:

```json
{
  "webcam_region": {
    "x": 0.02,
    "y": 0.18,
    "width": 0.23,
    "height": 0.43
  }
}
```

Rules:

- All values are floats from 0.0 to 1.0.
- `x + width` and `y + height` must not exceed 1.0.
- Width and height must be greater than zero.
- The region belongs to one clip, not the parent project defaults.
- Missing `webcam_region` is invalid for Streamer Stack rendering and should
  keep the render action disabled with an actionable message.
- Standard 9:16 clips do not require this field.

The value must travel through the existing deferred-render path:

```text
selector UI
  → clip metadata / project result
  → per-clip save API
  → child render-job metadata
  → Python deferred render
  → clip manifest
  → Streamer Stack frame compositor
```

## API behavior

Add a per-clip update endpoint alongside the existing render route:

```text
PATCH /api/jobs/{job_id}/clips/{clip_index}/webcam-region
```

Request body:

```json
{
  "webcam_region": {
    "x": 0.02,
    "y": 0.18,
    "width": 0.23,
    "height": 0.43
  }
}
```

The backend validates the normalized rectangle, updates only the requested
clip's persisted metadata, and returns the saved clip plus the normalized region.
The endpoint must reject invalid clip indexes, malformed JSON, out-of-range
coordinates, and updates for a non-deferred or missing parent job.

The existing `POST /api/jobs/{job_id}/clips/{clip_index}/render` route copies the
saved region into the child job metadata. A render request without the required
region is rejected before a child job is created.

## Rendering behavior

### Facecam panel

The selected source rectangle replaces the current detector-driven Facecam
focus. The renderer crops from that rectangle, preserves its aspect ratio as
much as possible, and fills the configured Streamer Stack Facecam panel (`small`,
`medium`, or `large`). It does not run person detection inside the selected
region.

If the selected rectangle does not exactly match the panel aspect ratio, the
renderer center-crops the selected region to the panel ratio before resizing. It
must not stretch the user's webcam image.

### Gameplay panel and detection mask

The selected region is converted to source pixels for every processed frame.
Person/face candidates whose detection box intersects that region are discarded.
The same exclusion is applied to the fallback person detector.

The remaining candidates are available to gameplay framing/tracking. This means
the user's webcam cannot become the gameplay tracking target, while in-game
characters or other people outside the selected region can still be detected.

If no valid gameplay candidate exists, the renderer keeps the previous gameplay
focus or uses the existing fixed lower-biased fallback. It does not fall back to
detecting inside the webcam rectangle.

### Output composition

The output remains the current Streamer Stack composition:

```text
upper panel  = selected webcam region, fitted to the Facecam panel
lower panel  = gameplay crop, using only detection candidates outside the ROI
output       = vertical stack with no gap
```

The existing `facecam_size` controls the panel boundary. The manual webcam region
controls the source content of that upper panel; these are separate settings.

## Frontend design

The selector should be a focused modal or expanded card state, not a new page.

Required behavior:

- Render the source preview with `object-contain` so the full source frame is
  visible.
- Draw the rectangle in a positioned overlay using the video's displayed bounds.
- Convert pointer coordinates from displayed pixels to normalized source values.
- Support drag-to-move and corner/edge resize within the source frame.
- Display a red or orange outline for the webcam region and a visible mask/label
  for the excluded detection region.
- Restore a previously saved rectangle when reopening the selector.
- Save through the per-clip API and surface validation/network errors.
- Disable **Analyze & Render** until Streamer Stack has a valid saved region.
- Leave Standard 9:16 clips on the existing render path without this requirement.

The card preview may continue to use the existing timestamp-limited source video,
but the selection surface must use the full landscape geometry rather than the
card's 9:16 `object-cover` presentation.

## Error handling

- Invalid region: keep the selector open and show the violated boundary.
- Save failure: retain the unsaved rectangle in the modal and show a retryable
  error.
- Render without a region: return a clear validation error and do not enqueue a
  child job.
- Older Streamer Stack clips without a region: show **Select Webcam Area** and
  require selection before rendering.
- Detection failure outside the region: use the existing fallback focus, never the
  webcam ROI.

## Testing plan

### Frontend

- The selector displays the full source frame and a saved rectangle.
- Dragging and resizing produce normalized coordinates bounded to 0–1.
- Saving calls the correct per-clip endpoint with the expected payload.
- Streamer Stack cannot render until a valid region exists.
- Standard 9:16 still renders without a webcam-region requirement.
- Existing candidate preview and timestamp loop behavior remain intact.

### Backend

- Valid region updates persist only the requested clip.
- Invalid coordinates and malformed requests are rejected.
- The render route propagates `webcam_region` into the child job metadata.
- A missing region prevents Streamer Stack child-job creation.

### Python renderer

- A selected webcam region is converted correctly from normalized to pixel
  coordinates.
- Candidate boxes intersecting the region are excluded.
- The fallback detector receives the same exclusion.
- The upper panel uses the manual ROI rather than the detector focus.
- The lower panel still renders when no gameplay candidate is found.
- Standard layout behavior is unchanged.

## Acceptance criteria

The feature is ready when a user can select the webcam rectangle independently on
each discovered Streamer Stack clip, save it, and render the clip while verifying
that the webcam cannot be selected by gameplay detection. The resulting upper
panel must come from the manually selected webcam area, and existing Standard
9:16 clips must continue to work unchanged.
