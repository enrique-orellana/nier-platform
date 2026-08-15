# Dashboard Test and Streamer Render Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize the local-editor project-list regression test and add an integration test that validates the real Streamer Stack FFmpeg output.

**Architecture:** Keep production local-editor behavior unchanged and make the project-list test wait for the actual async project action. Test the streamer compositor with a real synthetic source and FFmpeg, then inspect the output panels for distinct facecam/gameplay content and expected dimensions/audio.

**Tech Stack:** React, Vitest, Testing Library, Python, OpenCV, NumPy, FFmpeg, pytest.

---

### Task 1: Repair local-editor project list lifecycle

**Files:**
- Test: `dashboard/src/components/local-editor/LocalEditorTab.test.jsx`

- [x] **Step 1: Add a focused assertion that the reopened project dialog retains the stored project.**

- [x] **Step 2: Run the focused test and confirm it fails at the project-list lifecycle.**

- [x] **Step 3: Make the smallest test synchronization correction by waiting for the actual delete control inside the reopened dialog.**

- [x] **Step 4: Run the focused test and the complete LocalEditorTab test file.**

### Task 2: Add real Streamer Stack render coverage

**Files:**
- Modify: `tests/test_main_generation_pipeline.py`
- Modify: `main.py` only if the integration test exposes a production defect

- [x] **Step 1: Add a failing integration test using a synthetic black/white source, real `compose_streamer_stack_frame`, and the existing FFmpeg process path.**

- [x] **Step 2: Run the test and confirm it fails because the current test mocks the compositor or because the output contract is not asserted.**

- [x] **Step 3: Remove only the unnecessary compositor mock and assert dimensions, audio, and distinct top/bottom panel content from the produced file.**

- [x] **Step 4: Run the focused integration test and all Python tests.**

### Task 3: Final verification

- [x] **Step 1: Run the changed dashboard tests.**

- [x] **Step 2: Run dashboard lint, Python tests, and Go tests.**

- [x] **Step 3: Run `git diff --check` and GitNexus `detect_changes()` before committing.**
