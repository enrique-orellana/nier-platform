# Shared Local Editor Playback Clock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement this plan task-by-task.

**Goal:** Make Local Editor playback deterministic by giving the editor one shared source of truth for clip-relative time, transport state, duration, playback rate, loop state, and seek revisions.

**Architecture:** A small React playback-clock controller owns transport state and exposes derived frame/time values. Local Editor provides that controller around the preview and timeline. RemotionPreview consumes the controller when present and passes its current clip-relative time into the composition. ShortVideo uses that controlled time for audio, subtitles, and Standard/Streamer visual synchronization, while retaining an explicit fallback for standalone preview consumers that do not provide a controller.

**Tech Stack:** React 18, Remotion Player, TypeScript/TSX compositions, Vitest, Testing Library, Prettier, ESLint.

### Task 1: Lock the single-owner contract with failing tests

- [ ] Add unit tests for the clock reducer/controller: clamped seeks, atomic seek revisions, duration changes, reset behavior, and frame conversion.
- [ ] Add a RemotionPreview regression test proving a provided clock controls Player frame/playback and passes `playbackTimeMs` to composition input props.
- [ ] Add a ShortVideo regression test proving controlled playback time synchronizes a visual media element even when the composition frame is stale.
- [ ] Run only these tests and confirm they fail for the missing shared-clock behavior.

### Task 2: Implement and provide the shared playback clock

- [ ] Add the tested playback-clock module with reducer state, functional setters, `seekTo`, `resetPlayback`, derived current frame, and a React context provider/consumer.
- [ ] Replace LocalEditorTab’s independent playback state with the controller while keeping mute state separate because it is an audio UI preference rather than a timeline clock value.
- [ ] Wrap the Local Editor tree in the provider and route existing seek, keyboard, transport, media-time, lifecycle, and timeline updates through the controller.

### Task 3: Make preview and composition consumers derive from the same clock

- [ ] Make RemotionPreview prefer the shared controller over duplicated transport props when it is present, while preserving existing prop-driven behavior for other callers.
- [ ] Pass the controller’s clip-relative time through Remotion input props so the composition does not depend on an isolated internal media clock.
- [ ] Make ShortVideo use controlled playback time for subtitles and Standard/Streamer visual media synchronization; retain fallback clock state only for standalone previews without a controller.
- [ ] Ensure only the dedicated audio media element publishes native media time back to Local Editor.

### Task 4: Verify regressions and live behavior

- [ ] Run focused playback, preview, and composition tests, then the full dashboard test suite.
- [ ] Run `npm run format`, `npm run format:check`, `npm run lint`, and `npm run build` from `dashboard`.
- [ ] Run GitNexus `detect_changes({scope:"all",repo:"nier-platform"})`, review the affected preview/timeline flows, and inspect the final diff without staging unrelated `AGENTS.md`/`CLAUDE.md` edits.
- [ ] Commit the implementation, restart the frontend with the repository-managed workflow, check service health, and smoke-test `/editor` in the user-requested in-app browser.
