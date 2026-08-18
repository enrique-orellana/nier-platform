# Preserve Native Mobile Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure standard 9:16 clip rendering uses the canonical 1080×1920 mobile canvas so outputs do not become smaller 810×1440 files.

**Architecture:** Reuse the existing `choose_master_spec(source_media, strategy="crop")` export-policy path for standard rendering, matching Streamer Stack behavior. Add a regression test that exercises `process_video_to_vertical` with a 1440-pixel-tall source and verifies the raw-video encoder and output validator receive 1080×1920 dimensions.

**Tech Stack:** Python, FFmpeg command construction, `unittest.mock`, GitNexus.

---

### Task 1: Add the failing standard-render resolution regression test

**Files:**
- Modify: `tests/test_main_generation_pipeline.py` near `test_streamer_render_validates_master_dimensions_fps_and_audio`

- [x] **Step 1: Write the failing test**

Add `test_standard_render_uses_canonical_mobile_dimensions` with a `SourceAnalysis` of 810×1440, patch the frame stream/process/detection/validation boundaries, and assert the FFmpeg raw-video input uses `1080x1920` and validation expects 1080×1920.

- [x] **Step 2: Run the focused test and verify RED**

Run:

```powershell
python -m pytest tests/test_main_generation_pipeline.py -k standard_render_uses_canonical_mobile_dimensions -q
```

Expected: FAIL because the current standard branch constructs an `810x1440` raw-video input and validates those dimensions.

### Task 2: Make standard rendering use the master export policy

**Files:**
- Modify: `main.py:1298-1306`

- [x] **Step 1: Implement the minimal fix**

Compute `master_spec = choose_master_spec(source_media, strategy="crop")` before the layout branch and use `master_spec.width` and `master_spec.height` for both standard and Streamer Stack layouts. Preserve the existing layout-specific composition behavior and source FPS cap.

- [x] **Step 2: Run the focused regression test and verify GREEN**

Run:

```powershell
python -m pytest tests/test_main_generation_pipeline.py -k standard_render_uses_canonical_mobile_dimensions -q
```

Expected: PASS.

### Task 3: Run regression coverage and inspect affected scope

- [x] **Step 1: Run related Python tests**

```powershell
python -m pytest tests/test_main_generation_pipeline.py tests/test_master_policy.py tests/test_video_output_validation.py -q
```

- [x] **Step 2: Run GitNexus change detection**

```text
detect_changes({scope: "all", repo: "openshorts"})
```

Confirm only the intended standard-render symbol and its tests/pipeline are affected.

- [x] **Step 3: Review the final diff and report the output contract**

Confirm standard mobile outputs are 1080×1920, source FPS remains capped at 60, and no unrelated working-tree changes were modified.
