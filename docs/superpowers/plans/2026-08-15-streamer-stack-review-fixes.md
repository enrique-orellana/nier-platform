# Streamer Stack Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Streamer Stack hooks consistent across Remotion, the Go/Python worker fallback, and the legacy app route, while making gameplay framing lower-biased and covering the reviewed regressions.

**Architecture:** Carry the existing clip-level `layout_format` and `facecam_size` into the Remotion hook configuration. Use the same facecam ratio table for backend hook boundary placement, and use a small gameplay crop zoom so the lower focus is effective for horizontal recordings. Add focused regression tests at each active boundary.

**Tech Stack:** Python, Go, React/TypeScript, Remotion, pytest, Vitest, Go tests.

---

### Task 1: Add failing regression tests for hook routing and framing

**Files:**
- Modify: `tests/test_hooks.py`
- Modify: `tests/test_streamer_layout.py`
- Modify: `dashboard/src/remotion/compositions/HookOverlay.test.jsx`
- Modify: `dashboard/src/remotion/lib/hookVisual.test.js`

- [x] **Step 1: Write tests proving the worker passes streamer hook metadata and backend placement follows the selected facecam size.**
- [x] **Step 2: Write a test proving horizontal gameplay framing is lower-biased.**
- [x] **Step 3: Write Remotion helper/component tests proving streamer hooks use the boundary position and yellow outlined text.**
- [x] **Step 4: Run the new focused tests and verify they fail for the reviewed reasons.**

### Task 2: Fix backend hook styling and boundary placement

**Files:**
- Modify: `hooks.py`
- Modify: `app.py`
- Modify: `python_worker.py`

- [x] **Step 1: Add a `facecam_size` argument to `add_hook_to_video` and center the overlay image on the selected panel boundary.**
- [x] **Step 2: Pass clip-level layout and facecam metadata from the legacy worker hook path.**
- [x] **Step 3: Pass `facecam_size` from the legacy FastAPI hook route.**
- [x] **Step 4: Run Python hook and worker tests.**

### Task 3: Fix Remotion hook styling and active dashboard wiring

**Files:**
- Modify: `dashboard/src/remotion/lib/types.ts`
- Modify: `dashboard/src/remotion/lib/hookVisual.js`
- Modify: `dashboard/src/remotion/compositions/HookOverlay.tsx`
- Modify: `dashboard/src/components/HookModal.jsx`
- Modify: `dashboard/src/components/ResultCard.jsx`

- [x] **Step 1: Extend hook configuration with optional layout metadata.**
- [x] **Step 2: Add shared streamer boundary and visual style helpers.**
- [x] **Step 3: Carry clip metadata into the hook modal and Remotion config.**
- [x] **Step 4: Run the focused dashboard hook tests.**

### Task 4: Make gameplay framing lower-biased and verify the complete change

**Files:**
- Modify: `streamer_layout.py`
- Modify: `tests/test_main_generation_pipeline.py`

- [x] **Step 1: Apply a bounded gameplay zoom while preserving the stable horizontal center.**
- [x] **Step 2: Add coverage for Streamer Stack output metadata and the render contract.**
- [x] **Step 3: Run focused Python, dashboard, and Go tests.**
- [x] **Step 4: Run lint, build, diff checks, and GitNexus change detection.**
