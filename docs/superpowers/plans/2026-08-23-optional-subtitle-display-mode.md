# Optional Subtitle Display Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted subtitle display-mode toggle that keeps preview and rendered exports identical.

**Architecture:** Store `displayMode` beside the existing subtitle style fields. Normalize missing values to `phrase`, then let both Remotion composition copies choose either all block words or only the active timed word. The existing manifest/version persistence already carries the style object unchanged.

**Tech Stack:** React, Vitest, TypeScript, Remotion, Zod, Vite, Docker Compose.

---

### Task 1: Define and normalize the display mode

**Files:**
- Modify: `remotion/src/lib/types.ts`
- Modify: `dashboard/src/remotion/lib/types.ts`
- Modify: `dashboard/src/components/local-editor/localEditorStyles.js`
- Modify: `remotion/src/compositions/Subtitles.tsx`
- Modify: `dashboard/src/remotion/compositions/Subtitles.tsx`
- Test: `dashboard/src/remotion/compositions/Subtitles.test.jsx`

- [ ] **Step 1: Write failing tests** for legacy normalization and `single-word` normalization.
- [ ] **Step 2: Run the focused subtitle tests and verify the new assertions fail because `displayMode` is absent.
- [ ] **Step 3: Add `displayMode: "phrase" | "single-word"` to both style types and schemas, default it to `phrase`, and normalize unsupported values to `phrase`.
- [ ] **Step 4: Run the focused subtitle tests and verify they pass.

### Task 2: Render the selected display mode

**Files:**
- Modify: `remotion/src/compositions/Subtitles.tsx`
- Modify: `dashboard/src/remotion/compositions/Subtitles.tsx`
- Test: `dashboard/src/remotion/compositions/Subtitles.test.jsx`

- [ ] **Step 1: Add a failing pure-behavior test around the word-selection helper for phrase and single-word modes.
- [ ] **Step 2: Run the focused test and verify it fails because both modes currently render every block word.
- [ ] **Step 3: Implement the helper and render only the active word when `displayMode` is `single-word`.
- [ ] **Step 4: Run the focused test and verify it passes.

### Task 3: Add the preview toggle

**Files:**
- Modify: `dashboard/src/components/local-editor/LocalEditorSubtitleStyleInspector.jsx`
- Test: `dashboard/src/components/local-editor/LocalEditorSubtitleStyleInspector.test.jsx`

- [ ] **Step 1: Add a failing UI test that clicks `One word at a time` and expects `onChange` to receive `displayMode: "single-word"`, then clicks again and expects `phrase`.
- [ ] **Step 2: Run the focused UI test and verify it fails because the toggle does not exist.
- [ ] **Step 3: Add an accessible switch using the normalized style value and existing editor button styles.
- [ ] **Step 4: Run the focused UI test and verify it passes.

### Task 4: Verify, detect scope, commit, and deploy

**Files:**
- No additional source files.

- [ ] **Step 1: Run the dashboard targeted tests, format, format check, lint, and build.
- [ ] **Step 2: Run the render-service tests and build.
- [ ] **Step 3: Run GitNexus `detect_changes` and confirm only subtitle configuration, preview, and renderer flows are affected.
- [ ] **Step 4: Commit with `feat: add optional single-word subtitle display`.
- [ ] **Step 5: Rebuild `frontend` and `renderer` with Docker Compose and verify their health endpoints return HTTP 200.
