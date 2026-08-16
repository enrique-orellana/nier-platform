# Streamer Stack: Current Background Behavior

This document describes what OpenShorts currently does when a clip is rendered with
`layout_format=streamer_stack`. It is a behavior reference for reproducing the
result in DaVinci Resolve and for deciding what should change next.

## Short version

Streamer Stack creates a 1080×1920 vertical video by rendering the **same source
frame twice**:

```text
┌──────────────────────────┐
│                          │
│          FACECAM         │  30%, 38%, or 46% of the height
│                          │
├──────────────────────────┤
│                          │
│         GAMEPLAY         │  the remaining height
│                          │
└──────────────────────────┘
```

The upper copy is cropped around a detected person. The lower copy is cropped at
a fixed, slightly lower-than-center position. The two resized crops are stacked
with no gap, border, or overlay.

This is important: the current implementation does **not** receive separate
facecam and gameplay files. It does not use audio-based active-speaker detection,
face-recognition embeddings, or a predefined webcam rectangle. Both panels come
from the complete original frame.

## End-to-end flow

1. Clip discovery analyzes the source and records candidate start/end times.
2. The selected layout is stored with the clip metadata:
   - `standard`, or
   - `streamer_stack` plus `facecam_size`.
3. Discovery finishes without rendering the expensive vertical output.
4. Clicking **Analyze & Render** creates a child render job for one clip.
5. The worker loads the source and the previously computed analysis, trims the
   source to that clip, and processes the selected frames.
6. Every processed frame is converted into a two-panel vertical frame.
7. The generated video frames are encoded, the trimmed source audio is extracted,
   and the two streams are merged into the final MP4.

The main render path is `process_video_to_vertical()` in
[`main.py`](../main.py), while the panel composition is implemented in
[`streamer_layout.py`](../streamer_layout.py).

## Panel sizes

The output height is 1920 pixels. `facecam_size` controls the percentage of that
height allocated to the upper panel:

| Setting | Facecam height | Gameplay height |
| --- | ---: | ---: |
| `small` | 576 px / 30% | 1344 px / 70% |
| `medium` | 728 px / 38% | 1192 px / 62% |
| `large` | 882 px / 46% | 1038 px / 54% |

`medium` is the default. The widths of both panels are always 1080 pixels.

## How the Facecam panel is chosen

### 1. The source frame is analyzed

For Streamer Stack, the worker checks every second frame for a person. The
detector is YOLO, restricted to the `person` class. The code calls this result a
face candidate, but it is actually a person-detection result converted into an
upper-body/face approximation:

```text
detected person box
└── use the top 40% of the box as the face region
```

The candidate score is the area of that approximated face region. A larger visible
person therefore receives a stronger score.

If no candidate is available, the worker tries the largest detected person as a
fallback and again uses the top 40% of that person. If nothing is detected, the
last usable focus remains in place. At the beginning, before the first detection,
the fallback focus is the center of the source frame.

### 2. A lightweight tracker chooses the person

`SpeakerTracker` does not recognize people by their face. It tracks a candidate
primarily by horizontal center position:

- A candidate can match a previously seen candidate within 15% of the source
  width.
- A remembered candidate is forgotten after 30 source frames.
- Candidate scores decay by 15% on each detection cycle.
- The currently selected candidate receives a 3× stickiness bonus.
- Switching is held back for 30 source frames when the current person is still
  visible.

This gives the crop basic hysteresis so it does not immediately jump to every
nearby person. It is not a full multi-person tracker and it has no voice or
identity model.

The selected bounding box is converted into a normalized focus point:

```text
focus_x = person_center_x / source_width
focus_y = person_center_y / source_height
```

The focus coordinates are clamped to the 0–1 range.

### 3. The crop window is built around that focus

The upper panel uses the complete source frame, cropped to the panel's aspect
ratio and centered on the detected focus. It uses a 1.6× crop zoom before being
resized to 1080 pixels wide.

The crop is clamped at the source edges. Therefore, when the tracked person is
near the left, right, top, or bottom edge, the crop stops at that edge instead of
showing empty space.

There is no explicit smoothing of the crop position in the Streamer Stack path.
The tracker adds selection hysteresis, but the crop can still move when the
detected target changes.

## How the Gameplay panel is chosen

The lower panel is created independently from the same original source frame.
It does not reuse the upper crop and it does not follow the detected person.

Its fixed normalized focus is:

```text
focus_x = 0.50   # horizontal center
focus_y = 0.58   # slightly below vertical center
```

It uses a 1.12× crop zoom. The lower bias is intended to preserve more of the
gameplay area in landscape recordings, where a normal portrait crop would often
focus too high.

## Composition algorithm

For each source frame:

1. Calculate the facecam and gameplay panel heights.
2. Crop the source to the facecam aspect ratio around the tracked face focus.
3. Crop the source again to the gameplay aspect ratio around `(0.50, 0.58)`.
4. Resize the first crop to `(1080, facecam_height)`.
5. Resize the second crop to `(1080, gameplay_height)`.
6. Vertically concatenate them:

```text
output_frame = vertical_stack(facecam_crop, gameplay_crop)
```

The implementation is `compose_streamer_stack_frame()` in
[`streamer_layout.py`](../streamer_layout.py).

## Difference from normal 9:16

Normal 9:16 uses one portrait crop for the entire output. Its cameraman logic
tracks a subject across the full 1080×1920 frame and scene strategies can change
how the crop behaves.

Streamer Stack bypasses that single-camera composition. It always creates two
independent crops: a tracked upper crop and a fixed lower crop. Scene strategy
classification does not change the panel arrangement.

## Encoding and audio

The current output policy is:

- 1080×1920 pixels
- Source frame rate, capped at 60 FPS
- H.264 High Profile, Level 4.2
- `yuv420p`
- CRF 14 with the `veryslow` preset
- BT.709 color normalization
- AAC audio at 48 kHz and 192 kbps
- MP4 fast-start enabled

The worker first encodes the generated video frames, extracts the trimmed source
audio separately, and merges the two streams. If the source has no audio, the
video is kept without an audio stream.

## DaVinci Resolve equivalent

To reproduce the current result manually:

1. Create a 1080×1920 timeline using the source FPS.
2. Trim the source to the candidate clip's start and end.
3. Place the source on two video tracks.
4. On the upper track, create the facecam crop, use the selected panel height,
   apply the equivalent of 1.6× crop zoom, and keyframe the crop position around
   the detected person's head/chest.
5. On the lower track, create the gameplay crop, use the remaining panel height,
   apply the equivalent of 1.12× crop zoom, and keep its focus slightly below
   center.
6. Align the upper panel at the top of the frame and the gameplay panel directly
   beneath it.
7. Keep the original trimmed audio.
8. Export as a 1080×1920 H.264 MP4.

The important Resolve setup is two independently transformed copies of the same
clip. A single crop with a face tracker cannot reproduce the current behavior.

## Current limitations to discuss

These are behaviors of the current implementation, not necessarily the desired
final design:

- The upper panel may show more than a traditional webcam because it crops the
  full source frame around a detected person.
- The detector chooses visible people by size and position, not by identity or
  who is speaking.
- The upper crop can move abruptly because there is no dedicated position
  smoothing stage in this path.
- The gameplay panel is always fixed at the same normalized focus, regardless of
  where important gameplay UI appears.
- Both panels process the original frame independently, which increases work
  compared with a pipeline that first extracts a fixed facecam region.

These limitations are the main design questions for the next iteration: whether
the upper panel should use a fixed webcam region, whether it should follow a
specific tracked face, and whether the gameplay crop should also be dynamic.
