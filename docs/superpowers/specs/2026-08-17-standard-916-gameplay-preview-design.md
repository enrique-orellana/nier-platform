# Standard 9:16 Gameplay Preview

**Date:** 2026-08-17
**Status:** Approved for implementation planning

## Goal

Let users preview each clip's manually selected gameplay region inside a Standard 9:16 mobile frame before running face analysis or rendering.

## User experience

Each clip receives a `Preview 9:16` action. The action opens a modal containing:

- the source video paused at the clip start;
- the selected gameplay region composed into a 9:16 frame;
- play/pause controls for checking framing over time;
- zoom out, zoom in, and reset controls;
- a close action.

The preview is per clip and does not alter the existing source-video player. It is preview-only: zoom changes are local UI state and are not persisted or sent to the render API.

If a clip has no valid saved `gameplay_region`, the preview action is disabled and communicates that the gameplay area must be selected first.

## Framing rules

The saved gameplay rectangle is normalized to the source video dimensions and used as the preview source area.

- Zoom `1.0` center-crops the selected gameplay area to fill the 9:16 frame.
- Zooming out reveals more of the selected gameplay area and permits letterboxing when the source no longer fills the frame.
- Zooming in enlarges the selected gameplay area around its center.
- Playback keeps the same crop and zoom while the video time advances.

The feature does not change Streamer Stack composition, face/person tracking, standard rendering, or persisted clip metadata.

## Components and data flow

Add a reusable frontend `Standard916Preview` modal. `ResultCard` supplies:

- the source video URL;
- clip start and end times;
- the normalized `gameplay_region`;
- close state.

The preview component owns temporary zoom and playback state. No new backend route or database field is required.

## Validation

Add frontend tests covering:

1. `Preview 9:16` is disabled when no valid gameplay region exists.
2. Opening the action displays the selected gameplay region in a 9:16 preview.
3. Zoom out and zoom in update the preview transform.
4. Reset returns to zoom `1.0`.
5. Close removes the modal without changing clip metadata.

Run the focused dashboard tests and production build before committing the implementation.
