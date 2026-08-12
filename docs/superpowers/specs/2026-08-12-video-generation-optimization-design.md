# Video Generation Optimization Design

**Date:** 2026-08-12  
**Status:** Approved for planning  
**Scope:** Long-video clip generation in `main.py`

## Goal

Significantly reduce the time and compute cost of generating 3–15 clips while preserving the current crop, face-tracking, person-tracking, audio, and export quality. The first implementation must optimize repeated work before changing visual-quality settings or adding broad parallelism.

## Current problem

The current job pipeline performs the following once per clip:

- Full-source scene detection.
- Full-scene face sampling and scene strategy classification.
- Source decoding from the beginning of the file until the clip end.
- Per-clip video encoding.
- Per-clip audio extraction.

For the observed 38-minute source with 15 clips, clip processing produced 668 seconds of output but decoded approximately 940,962 source frames—about 6.9 full-source equivalents—before counting the 15 repeated scene-analysis passes. The backend has four CPU cores and eight GiB of memory, so unbounded per-clip parallelism would trade one bottleneck for CPU contention.

## Recommended architecture

Use a hybrid pipeline with one source-analysis pass and direct per-clip rendering.

### 1. Prepare the source once

Keep the existing source preparation behavior:

- Probe the original source.
- Transcode AV1 sources once to an H.264 working copy when the OpenCV decoder cannot read AV1.
- Preserve the original source for manifests and rerenders.
- Use the working copy for transcription, scene analysis, and clip rendering.

The AV1 compatibility transcode remains a fixed per-job cost and is not repeated per clip.

### 2. Analyze the source once

Create a source-analysis result containing:

- Source FPS and total frame count.
- Effective source dimensions.
- Scene boundaries from `ContentDetector`.
- One tracking strategy per scene (`TRACK` or `GENERAL`).
- Analysis/version metadata for invalidation.

Run `detect_scenes()` and `analyze_scenes_strategy()` once before the clip loop. Pass the resulting analysis object into every clip render. The existing detection algorithms and thresholds remain unchanged in the first optimization pass, so framing behavior stays consistent.

The analysis may be persisted beside the job metadata as a cache artifact. Cache reuse is valid only when the source identity, media probe values, analysis version, and relevant policy values match. A cache miss must safely recompute the analysis.

### 3. Render only each requested clip range

Change the clip renderer to accept the already-computed source analysis and frame range.

For each clip:

1. Convert timestamps to the existing frame-aligned `ClipFrameRange`.
2. Seek the decoder to the clip start, allowing decoder keyframe preroll as required.
3. Decode and process frames only through the clip end.
4. Reuse the cached scene boundaries and scene strategies while applying the current MediaPipe/YOLO tracking logic to frames in the clip.
5. Encode the processed frames with the existing export policy.
6. Extract only the clip’s audio interval using direct start/duration seeking.
7. Merge and validate the final MP4 before it is considered ready.

The crop, tracking, resize, frame format, codec, CRF, and audio settings remain unchanged initially. This isolates the performance improvement from visual-quality changes.

### 4. Preserve correctness during partial work

Each final clip must be validated before upload and before being reported as ready. Validation must confirm:

- A video stream exists.
- The video codec and pixel format satisfy the export policy.
- The output has a positive frame count and duration.
- Audio is present when the source clip has audio.
- Output dimensions and FPS match the requested master policy.

Temporary video and audio files must never be uploaded or exposed as final project clips. A failed or invalid clip must be marked failed rather than producing a nominal success.

### 5. Add stage-level observability

Record per-job and per-clip timing for:

- Source preparation/transcode.
- Transcription.
- AI clip planning.
- One-time scene analysis.
- Decoder seek/preroll.
- Frame processing.
- Video encode.
- Audio extraction/merge.
- Validation.
- Upload.

Also record source frames decoded, output frames written, output bytes, and cache hit/miss status. The metrics must make it possible to compare the old and optimized paths without guessing.

## Quality strategy

Quality is a hard requirement.

- Do not change face detection, person detection, speaker selection, crop smoothing, or scene strategy in the first implementation.
- Reuse the same scene classification for all clips that currently independently calculate it.
- Keep the existing master export policy, including H.264, CRF 14, and `veryslow`, during the first benchmark.
- Compare representative clips from landscape, single-speaker, group, and no-face footage before considering encoder changes.
- Any later encoder-preset experiment must use the same CRF and be accepted only after visual and playback validation.

## Performance strategy

The first optimization target is eliminating multiplied work, not reducing output quality.

Expected reductions:

- Scene detection: from once per clip to once per job.
- Scene strategy analysis: from once per clip to once per job.
- Source decoding: from repeated decode-to-end behavior to clip-range decoding with keyframe overhead.
- Audio scanning: from full-source behavior per clip to direct clip-range extraction.

Do not add parallel clip rendering in the first pass. Once the optimized serial path is benchmarked, a bounded concurrency experiment may use at most two clip workers on the current four-CPU backend. Parallelism is optional and must not increase invalid-output or out-of-memory rates.

## Alternatives considered

### Cache-only optimization

Cache scene detection and scene strategy results but retain the current decoder behavior. This is low risk but leaves substantial repeated frame decoding and is insufficient as the primary solution.

### One-pass multi-output renderer

Decode the source once and fan frames out to multiple clip encoders. This may minimize source reads but adds complex lifecycle, buffering, and failure handling for 15 outputs. It is deferred until the hybrid path is measured.

### Faster encoder preset as the first change

Changing `veryslow` immediately could reduce wall-clock time, but it changes compression efficiency and may increase output size. It is deferred until repeated analysis and decode work are removed and a quality benchmark exists.

## Testing and acceptance criteria

Tests must be written before implementation changes.

Unit and integration coverage must verify:

- Scene detection is invoked once for a multi-clip job.
- Scene strategy analysis is invoked once for a multi-clip job.
- Every clip renderer receives the shared source-analysis object.
- Decoder positioning starts at or before the requested frame and does not process the entire source by default.
- Audio commands contain the requested start and duration.
- Cache hits require matching source and analysis metadata.
- Cache mismatches recompute analysis.
- Invalid outputs are rejected and not uploaded.
- Temporary files are not published.
- AV1 compatibility preparation still occurs once and produces a valid working source.

Benchmark acceptance for a representative 15-clip source:

- The optimized path must preserve valid video/audio streams and current output dimensions/FPS.
- Scene detection and strategy analysis must each execute once.
- Total decoded frames must be close to requested clip frames plus decoder preroll, rather than multiple full-source equivalents.
- No clip may be smaller than a valid encoded output threshold or contain zero video frames.
- Wall-clock time and CPU time must be recorded for comparison with the current baseline.

No implementation code is included in this design approval. The next step is to produce an implementation plan with task-level changes and tests.
