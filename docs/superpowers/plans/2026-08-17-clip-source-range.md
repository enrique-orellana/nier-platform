# Clip Source Range Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display each clip’s source start/end and master duration on the result card.

**Architecture:** Add an additive `source_duration_seconds` result field from the persisted source asset, pass it through `App` to `ResultCard`, and render a small local time formatter and metadata row in `CardContent`. Omit the master value when unavailable; leave video processing unchanged.

**Tech Stack:** Python/FastAPI result shaping, React, Vitest, React Testing Library, Tailwind CSS.

---

### Task 1: Add the source-range card row

**Files:**
- Modify: `app.py:194`
- Test: `tests/test_source_context_rehydration.py`
- Modify: `dashboard/src/App.jsx`
- Modify: `dashboard/src/components/ResultCard/CardContent.jsx`
- Modify: `dashboard/src/components/ResultCard.jsx`
- Test: `dashboard/src/components/ResultCard/CardContent.test.jsx`

- [ ] Write a failing backend test asserting `source_duration_seconds` is derived from `source_asset.probe.duration_seconds`.
- [ ] Run the focused backend test and confirm it fails because the result field is absent.
- [ ] Add the additive result field without changing existing result fields.
- [ ] Re-run the focused backend test and confirm it passes.
- [ ] Write a failing dashboard test rendering a clip with `start: 176`, `end: 204`, and `masterDuration: 3577`, then assert the row contains `Start 02:56 · End 03:24 · Master 59:37`.
- [ ] Run the focused Vitest test and confirm it fails because the row is absent.
- [ ] Add a local `formatSourceTime` helper, pass the result duration through `App` and `ResultCard`, and render the row beneath the existing clip metadata.
- [ ] Re-run the focused dashboard test and confirm it passes.
- [ ] Run the dashboard test suite and build.
