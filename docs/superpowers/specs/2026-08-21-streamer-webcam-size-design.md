# Streamer Stack Per-Clip Webcam Size

## Goal

Add a webcam panel-size selection to the existing Streamer Stack “Select Webcam Area” modal. The setting is saved for the current clip alongside its webcam source rectangle, defaults to that clip’s existing configuration, and preserves the current behavior for older clips without a saved value.

## User experience

When a user opens “Select Webcam Area” or “Edit Webcam Area” for a Streamer Stack clip:

- The existing source-video rectangle editor remains unchanged.
- The modal shows a `Webcam panel size` selection with `Small`, `Medium`, and `Large` options.
- The selection initializes from the clip’s saved `facecam_size`.
- If the clip has no saved value, the selection uses the existing default, `Medium`.
- Saving persists both the normalized webcam rectangle and the selected panel size for that clip.
- Cancelling or closing the modal leaves both values unchanged.

The webcam rectangle determines which source pixels are used. The panel-size setting determines the height split in the final 9:16 Streamer Stack output; it does not resize or alter the source rectangle itself.

## Architecture

Reuse the existing `facecam_size` field and Streamer Stack rendering path. Extend the current per-clip webcam-region save operation so one save updates both related settings. The saved clip metadata already flows through deferred rendering and the Python compositor, which already supports `small`, `medium`, and `large` panel ratios.

### Dashboard

- Extend `WebcamRegionSelector` and the shared source-region modal with an optional webcam-size selector, keeping the gameplay selector unchanged.
- Initialize the selector from `clip.facecam_size || "medium"` in `ResultCard`.
- Include the selected size in the existing webcam save callback.
- Update the selected clip’s local state with both the returned webcam region and `facecam_size` after a successful save.
- Keep save, loading, error, and cancel behavior consistent with the existing webcam-region modal.

### API and persistence

- Extend the existing `PATCH /api/jobs/{job_id}/clips/{clip_index}/webcam-region` payload to accept `facecam_size` in addition to `webcam_region`.
- Validate `facecam_size` against `small`, `medium`, and `large`; reject invalid values without changing the clip.
- Persist both fields in the selected clip result and its metadata sidecar using the existing atomic update path.
- Return both saved fields in the successful response.
- Preserve neighboring clips and all unrelated metadata.

### Rendering

- Keep the existing `facecam_size` propagation from clip metadata into deferred child-job metadata.
- Keep the existing Python validation and `streamer_panel_heights` behavior.
- No new upscaling, source-crop behavior, output resolution, or gameplay-panel behavior is in scope.

## Error handling

- Missing or invalid webcam rectangles continue to use the existing validation errors.
- Missing `facecam_size` is treated as `medium` for backwards compatibility.
- Invalid `facecam_size` returns a client error and leaves the selected clip unchanged.
- If persistence fails, the modal remains open and the dashboard restores the prior local values, matching the current webcam save failure behavior.

## Testing

Add or update focused coverage for:

- Modal initialization from `small`, `medium`, `large`, and missing values.
- Saving sends both `webcam_region` and `facecam_size`.
- A successful response updates only the selected clip’s two fields.
- A failed save does not close the modal or alter the selected clip locally.
- The API accepts all three supported sizes and rejects invalid values.
- The API response and persisted metadata contain the saved size.
- Deferred rendering forwards the per-clip size and continues to render with the selected panel height.
- Existing gameplay-region and standard-layout flows remain unchanged.

## Out of scope

- Custom numeric sliders or arbitrary panel ratios.
- Automatic webcam-size detection.
- Changes to the selected source rectangle based on panel size.
- AI upscaling, sharpening, denoising, or other webcam-quality enhancement.
- Applying a size change to every clip in a job.
