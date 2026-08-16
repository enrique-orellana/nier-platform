# Direct Video Decoding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decode AV1 sources directly with FFmpeg pipes so scene analysis and selected clip rendering do not re-encode the entire source.

**Architecture:** Create `video_frames.py` with a decode-only FFmpeg frame stream implementing the PySceneDetect `VideoStream` contract. Replace OpenCV file reads in source analysis and rendering with this stream, remove the encoded scene proxy and compatibility bridge, and retain only the final selected-clip MP4 encode.

**Tech Stack:** Python, FFmpeg subprocess pipes, NumPy, OpenCV frame operations, PySceneDetect 0.7, pytest/unittest, Kubernetes manifests.

---

### Task 1: Add the decode-only frame stream

**Files:**
- Create: `video_frames.py`
- Test: `tests/test_video_frames.py`

- [x] **Step 1: Write failing tests** for command construction, exact BGR frame reads, `decode=False` advancement, absolute frame numbering, and bounded end frames.

- [x] **Step 2: Run `python -m pytest tests/test_video_frames.py -q` and confirm the tests fail because `video_frames.py` does not exist.

- [x] **Step 3: Implement `FFmpegVideoStream` with `ffmpeg -i <source> -an -sn -dn -f rawvideo -pix_fmt bgr24 pipe:1`, metadata properties, frame-sized reads, restart-on-seek, and deterministic process cleanup.

- [x] **Step 4: Run `python -m pytest tests/test_video_frames.py -q` and confirm all new tests pass.

### Task 2: Replace source analysis file decoding

**Files:**
- Modify: `main.py:493-900`
- Modify: `tests/test_main_generation_pipeline.py`
- Remove: `video_decode.py` compatibility command usage after all callers are removed.

- [x] **Step 1: Add failing regression coverage proving AV1 source analysis uses the FFmpeg stream and does not call compatibility transcoding or create an encoded analysis proxy.

- [x] **Step 2: Run the focused regression test and confirm it fails against the current OpenCV/transcode implementation.

- [x] **Step 3: Use `MediaProbe` metadata directly, run `detect_scenes` through `FFmpegVideoStream`, and feed reduced decode-only frames into scene strategy analysis.

- [x] **Step 4: Run the focused source-analysis tests and the existing scene-analysis test group.

### Task 3: Replace clip-render OpenCV capture

**Files:**
- Modify: `main.py:1334-1610`
- Modify: `tests/test_main_generation_pipeline.py`
- Modify: `video_rendering.py` only if the reader needs a shared frame-range helper.

- [x] **Step 1: Add a failing render regression proving a selected AV1 clip is read through the FFmpeg stream and no compatibility working file is requested.

- [x] **Step 2: Run the regression test and confirm it fails before the reader integration.

- [x] **Step 3: Use the direct reader for the requested frame range, preserve the existing Streamer Stack composition, and keep audio extraction/muxing unchanged.

- [x] **Step 4: Run the focused render and Streamer Stack tests.

### Task 4: Remove obsolete compatibility bridge configuration

**Files:**
- Modify: `main.py`
- Delete: `host_ffmpeg_service.py`
- Delete: `tests/test_host_ffmpeg_service.py`
- Modify: `k8s/openshorts.yaml`
- Modify: `k8s/openshorts.env.example`
- Modify: `.gitignore`
- Modify: `tests/test_video_decode.py`

- [x] **Step 1: Remove the host AMF compatibility settings, staging mount, bridge service, and tests now that no pipeline path calls them.

- [x] **Step 2: Replace obsolete compatibility-command tests with a regression that asserts AV1 sources remain on the original path.

- [x] **Step 3: Run `rg -n -S 'prepare_opencv_video|OPENSHORTS_HOST_FFMPEG|h264_amf|build_decode_compatibility_command'` and confirm no active application path remains.

### Task 5: Verify the optimized pipeline

**Files:**
- No source changes.

- [x] **Step 1: Run `python -m py_compile video_frames.py main.py`.

- [x] **Step 2: Run focused tests for video frames, source analysis, rendering, Streamer Stack layout, media probing, and metrics.

- [x] **Step 3: Run `git diff --check`.

- [x] **Step 4: Perform an AV1 smoke test and verify no full-source compatibility output is created.

- [x] **Step 5: Run `mcp__gitnexus__detect_changes({repo: "openshorts"})` before any commit.
