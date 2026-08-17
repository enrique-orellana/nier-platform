# Clip Source Range Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display each clip’s source start/end and master duration on the result card.

**Architecture:** Add a small local time formatter and metadata row to `CardContent`. Use the clip’s existing duration fields, with graceful omission when the master duration is unavailable. Keep the API and rendering pipeline unchanged.

**Tech Stack:** React, Vitest, React Testing Library, Tailwind CSS.

---

### Task 1: Add the source-range card row

**Files:**
- Modify: `dashboard/src/components/ResultCard/CardContent.jsx`
- Test: `dashboard/src/components/ResultCard/CardContent.test.jsx`

- [ ] Write a failing test rendering a clip with `start: 176`, `end: 204`, and `master_duration: 3577`, then assert the row contains `Start 02:56 · End 03:24 · Master 59:37`.
- [ ] Run the focused Vitest test and confirm it fails because the row is absent.
- [ ] Add a local `formatSourceTime` helper and render the row beneath the existing clip metadata. Read the master duration from `clip.master_duration`, `clip.source_duration`, or `clip.duration_seconds` in that order.
- [ ] Re-run the focused test and confirm it passes.
- [ ] Run the dashboard test suite and build.
