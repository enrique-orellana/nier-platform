# Direct Video Decoding Design

## Goal

Remove the full-source AV1-to-H.264 compatibility transcode from the analysis and rendering pipeline. AV1 input must be decoded directly by FFmpeg into frames, leaving the original source untouched and avoiding a second full-length encoded video.

## Architecture

Add a small FFmpeg-backed frame-stream adapter that exposes decoded BGR frames without producing an intermediate video file. The adapter will provide the metadata and seek/read behavior required by PySceneDetect, while the existing scene analysis, YOLO analysis, and clip compositor consume frames from the same decode-only primitive.

`build_source_analysis_for_job` will use `ffprobe` metadata instead of `cv2.VideoCapture`, run PySceneDetect against the FFmpeg frame stream, and run scene strategy sampling against reduced frames from a second decode-only stream. `process_video_to_vertical` will decode only the requested clip range directly from the original source.

The final selected clip still requires one output encode because the product must create an MP4 artifact. This change removes the unnecessary full-video compatibility encode; final encoder optimization remains a separate concern.

## Behavior and failure handling

- The decoder must fail clearly if FFmpeg exits before a complete frame is read.
- Frame numbers must remain absolute when a stream starts at a requested frame.
- Scene detection must preserve the existing frame-skip setting and cached scene boundaries.
- Deferred rendering must continue to use the durable original source path.
- The obsolete host AMF compatibility bridge and its Kubernetes staging mount will be removed because direct decoding makes that path unnecessary.

## Verification

- Unit tests cover FFmpeg command construction, exact frame reads, frame skipping, and bounded ranges.
- Existing scene-analysis and streamer-render tests continue to pass.
- A live smoke test will confirm an AV1 source starts scene analysis without creating `.openshorts-av1-*` or `_scene_analysis_proxy.mp4` encoded intermediates.
