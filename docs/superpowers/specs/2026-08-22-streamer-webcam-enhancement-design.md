# Streamer Stack Traditional Webcam Enhancement

## Goal

Make a low-resolution webcam crop in the upper Streamer Stack panel look
cleaner and crisper without AI inference, new metadata, or a new per-clip
control.

## Scope

The enhancement applies only to the selected webcam crop used by the upper
panel. Gameplay cropping, panel proportions, tracking, face focus, saved
regions, and output dimensions remain unchanged.

This is a perceptual enhancement, not detail recovery. It must not claim to
reconstruct information that was not captured by the source webcam.

## Design

`crop_webcam_region()` will keep its existing source-region validation and
aspect-ratio crop. After that crop is selected, it will pass the pixels through
a small `enhance_webcam_crop()` helper:

1. Resize to the panel dimensions with `INTER_LINEAR` when the crop is being
   enlarged, preserving `INTER_AREA` for downscaling. Linear interpolation is
   intentionally used instead of Lanczos because Lanczos ringing becomes
   visible around high-contrast webcam edges when the source is very small.
2. Build a Gaussian-blurred copy of the resized image.
3. Apply a very subtle unsharp mask with `cv2.addWeighted`, using the resized
   image as the base and the blurred image as the low-frequency component. The
   low amount is intentional so frame-to-frame webcam noise does not shimmer.

The helper will validate positive target dimensions, preserve the input image
type/channel layout, and return the requested dimensions. The existing final
same-size resize in `compose_streamer_stack_frame()` remains unchanged so this
feature does not widen the composition change.

## Data flow

```text
source frame
  -> normalized webcam bounds
  -> aspect-ratio webcam crop
  -> linear upscale or area downscale
  -> very mild unsharp mask
  -> upper Streamer Stack panel
```

No AI model, network call, new dependency, or persisted option is introduced.

## Testing

Add unit coverage in `tests/test_streamer_layout.py` for the new helper's
dimensions and for the webcam crop's sharper edge response relative to the
current area-upscaled baseline. Keep the existing composition tests unchanged
to demonstrate that the panel arrangement and gameplay path continue to work.
