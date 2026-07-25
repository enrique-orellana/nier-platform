# Frame-Accurate Subtitle Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate subtitle lead/lag by producing each clip from a frame-accurate video trim and an audio trim taken from the same source timeline, so the stored transcript and rendered media share one deterministic zero-based clock.

**Architecture:** Remove the stream-copy intermediate clip. The vertical renderer will accept an optional source trim, decode the original source, emit only the exact source-frame interval, and extract audio with an exact timestamp trim/reset before the final master merge. The transcript endpoint will continue to express words relative to the requested clip start; a regression test will verify that the media and caption clocks use the same trim origin.

**Tech Stack:** Python, OpenCV, FFmpeg, pytest, existing H.264/MP4 master export policy.

---

## Task 1: Add pure trim/timeline helpers and regression tests

**Files:** `main.py`, `tests/test_clip_timeline.py`

- [x] Add small, dependency-light helpers that normalize source FPS and convert a requested `[start, end)` range to integer source frame bounds plus the corresponding effective trim times.
- [x] Add tests for fractional starts, end clamping, invalid/empty ranges, and the invariant that audio trim and emitted video frames use the same effective start/end timestamps.
- [x] Run the focused test and confirm it fails before the implementation is complete.

## Task 2: Make the vertical renderer trim the original source directly

**Files:** `main.py`

- [x] Extend `process_video_to_vertical()` with optional `start_sec` and `end_sec` arguments while preserving whole-video behavior.
- [x] Read the original source from frame zero, emit only frames in the computed interval, and keep scene/crop analysis in the source frame coordinate system.
- [x] Ensure output frame count/progress handling and scene-boundary selection remain correct for a trimmed interval.
- [x] Replace stream-copy audio extraction with an FFmpeg timestamp trim that resets PTS to zero and re-encodes audio under the existing master audio policy.
- [x] Merge with `-shortest` and the existing master video policy so the final MP4 has one synchronized, zero-based timeline.

## Task 3: Remove the inaccurate intermediate stream-copy cut

**Files:** `main.py`

- [x] Pass each clip's source `start`/`end` directly to `process_video_to_vertical()`.
- [x] Delete the temporary `-c:v copy -c:a copy -avoid_negative_ts make_zero` cut path and its cleanup logic.
- [x] Keep manifest and metadata timestamps in the original source coordinate system for future rerenders.

## Task 4: Verify end-to-end timing and protect existing behavior

**Files:** `tests/test_clip_timeline.py`, `tests/test_master_policy.py` (only if needed)

- [x] Add a mocked/integration-style test proving the renderer receives the same effective trim origin for video and audio.
- [x] Run the full Python test suite and the existing renderer tests/build.
- [ ] Probe a generated MP4 with FFprobe to verify H.264, `yuv420p`, the requested FPS, zero-based streams, and matching audio/video duration.
- [x] Report any preserved uncommitted user changes separately; do not overwrite them.
