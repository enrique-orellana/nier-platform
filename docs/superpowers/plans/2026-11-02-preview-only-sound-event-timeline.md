# Preview-Only Sound Event Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show detected sound events on a clip timeline and optionally as preview-only labels, without adding them to final renders or subtitles.

**Architecture:** Extend the existing clip transcript endpoint to return validated sound events clipped and offset to the selected clip. Fetch those events when the clip editor opens, normalize them into editor-relative milliseconds, and pass them to separate timeline and preview-only overlay components. Keep the overlay outside the Remotion composition and saved manifest.

**Tech Stack:** Go HTTP API, React, existing LocalEditor timeline and Remotion preview, Tailwind CSS.

---

## File map

- Modify `backend-go/internal/httpapi/clip_handlers.go`: extend `clipTranscript` response with clip-relative sound events.
- Modify `dashboard/src/components/editor/FullScreenEditor.jsx`: load sound events for the active clip and pass them to the local editor.
- Create `dashboard/src/components/local-editor/soundEventTimeline.js`: validate event records, convert seconds to milliseconds, and find the highest-confidence event active at a playhead time.
- Create `dashboard/src/components/local-editor/SoundEventTrack.jsx`: render non-draggable, selectable event cues on a dedicated Sounds lane.
- Create `dashboard/src/components/local-editor/SoundEventPreviewOverlay.jsx`: display the active label over the preview only.
- Modify `dashboard/src/components/local-editor/LocalEditorTimeline.jsx`: add the Sounds lane and its preview visibility toggle.
- Modify `dashboard/src/components/local-editor/LocalEditorTab.jsx`: own preview-only visibility state, normalize incoming events, pass them to the timeline, and position the overlay above the editor preview.

## Task 1: Return sound events for the selected clip

**Files:**
- Modify `backend-go/internal/httpapi/clip_handlers.go` in `clipTranscript`.

- [ ] Before editing `clipTranscript`, run GitNexus upstream impact analysis and report any HIGH or CRITICAL risk.
- [ ] Read the persisted `transcript.events` records alongside the existing transcript segments.
- [ ] Add the standard-library `math` import and reject `NaN`/infinite `start` or `end` values with `math.IsNaN` and `math.IsInf`.
- [ ] For each event, require finite numeric `start` and `end`, `end > start`, and a non-empty label; ignore invalid records.
- [ ] Keep events overlapping `[clipStart, clipEnd)`, clamp their bounds to that interval, and convert them to clip-relative seconds:

```go
relativeStart := math.Max(eventStart, clipStart) - clipStart
relativeEnd := math.Min(eventEnd, clipEnd) - clipStart
```

- [ ] Return the current `captions`, `durationSec`, and `language` fields plus `sound_events`, each with `start`, `end`, `label`, `confidence`, and `source`. Return an empty array when there are no events.
- [ ] Run `gofmt` on the modified Go file and `go build ./...` from `backend-go`.

## Task 2: Add reusable sound-event presentation components

**Files:**
- Create `dashboard/src/components/local-editor/soundEventTimeline.js`.
- Create `dashboard/src/components/local-editor/SoundEventTrack.jsx`.
- Create `dashboard/src/components/local-editor/SoundEventPreviewOverlay.jsx`.

- [ ] Normalize only records with a non-empty label and finite, increasing times; clamp times to `durationMs`, convert seconds to milliseconds, and assign stable IDs from label and rounded bounds.
- [ ] Implement `activeSoundEventAt(events, playheadMs)` to return the active event with the greatest confidence, or `null` if no event covers the playhead.
- [ ] Implement `SoundEventTrack` as a lane with a fixed `Sounds` label and positioned event buttons. Clicking an event calls `onSelect(event)`; do not implement dragging or time editing.
- [ ] Include the label and confidence in each event button's accessible name and title; use a distinct lane color from subtitle and layout tracks.
- [ ] Implement `SoundEventPreviewOverlay` as a pointer-ignored visual label with no Remotion or manifest integration.

## Task 3: Fetch events and connect them to the local editor

**Files:**
- Modify `dashboard/src/components/editor/FullScreenEditor.jsx`.
- Modify `dashboard/src/components/local-editor/LocalEditorTab.jsx`.
- Modify `dashboard/src/components/local-editor/LocalEditorTimeline.jsx`.

- [ ] Before editing `FullScreenEditor`, `LocalEditorTab`, and `LocalEditorTimeline`, run GitNexus upstream impact analysis for each component and report any HIGH or CRITICAL risk.
- [ ] In `FullScreenEditor`, fetch the clip transcript endpoint when the editor is open or the active job/clip changes. Set events to `[]` for non-success responses, malformed payloads, or request errors, and cancel state updates after unmount.
- [ ] Pass the fetched array to `LocalEditorTab` as `initialSoundEvents`.
- [ ] In `LocalEditorTab`, normalize the events against the editor clip duration and keep `showSoundEventsInPreview` as local UI state, enabled by default and reset when the active clip changes.
- [ ] In `LocalEditorTimeline`, render `SoundEventTrack` alongside the existing subtitle and layout lanes. Add a labeled checkbox named `Show sound labels in preview` that controls only preview visibility.
- [ ] Selecting a sound cue seeks to its start and selects it without opening the subtitle inspector or modifying the cue.
- [ ] Position `SoundEventPreviewOverlay` above the video stage and feed it the highest-confidence event active at `playheadMs` only while the toggle is enabled.
- [ ] Keep event data out of `RemotionPreview` props, subtitle tracks, local editor export state, saved manifests, and render requests.

## Task 4: Format, validate, and apply the feature

**Files:**
- All files listed above.
- `docs/superpowers/plans/2026-11-02-preview-only-sound-event-timeline.md`.

- [ ] Run `npm run format`, `npm run format:check`, and `npm run lint` from `dashboard`.
- [ ] Run `go build ./...` from `backend-go` after the final Go changes.
- [ ] Review `git status --short` and the complete diff; stage only the plan and feature files.
- [ ] Run GitNexus `detect-changes` on the staged diff. If it reports stale index state, refresh the index and restore any generated root context files before continuing.
- [ ] Commit the implementation after required checks pass.
- [ ] Restart the local app using `scripts/manage-local.ps1 -Action Restart` because both frontend and backend changed.
- [ ] Run `scripts/manage-local.ps1 -Action Status` and verify the relevant services are healthy.
- [ ] In Brave, open a project with sound events, use **Edit Timeline**, verify the Sounds lane and preview toggle, click an event to seek, and confirm the event label is outside the video composition and absent when using the normal final render path.
