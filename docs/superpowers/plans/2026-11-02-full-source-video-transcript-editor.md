# Full Source Video Transcript Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open the complete source video in the existing project editor and let a transcript correction update original subtitle tracks across generated clips without changing their ranges.

**Architecture:** Add a project source-transcript API backed by the existing source metadata and job result, including local and S3-backed metadata. Add a project-local source editor that reuses the existing video editor timeline with the master media and duration, then saves the edited timed transcript through that API; derive captions for each clip using its persisted source interval.

**Tech Stack:** React, existing editor timeline and adapters, Go `backend-go/internal/httpapi`, local output metadata, configured S3 store, Brave, repository-managed Docker workflow.

---

## Files and responsibilities

- `backend-go/internal/httpapi/project_handlers.go`: route source transcript requests and expose source metadata for project history.
- `backend-go/internal/httpapi/source_transcript_handlers.go` (new): load, validate, and persist the complete source transcript; regenerate original subtitle cues for current clips.
- `backend-go/internal/httpapi/deferred_clip_rendering.go`: reuse the existing generated-track refresh helper where its contract fits.
- `dashboard/src/components/ProjectLibrary.jsx`: show **Edit full video**, build source-mode editor inputs from the loaded project, and mount the source editor in project-local state.
- `dashboard/src/components/editor/SourceTranscriptEditor.jsx` (new): load the shared transcript and master source, create editor cues, and persist corrected cues without clip-version operations.
- `backend-go/internal/httpapi/clip_handlers.go`: hydrate a clip manifest response with current generated captions while preserving the stored manifest.
- `dashboard/src/components/local-editor/LocalEditorTab.jsx`: support the source editor title and save-only action, hiding video export for this mode.
- `dashboard/src/components/editor/sourceTranscriptEditorState.js` (new): convert the source transcript to editor cue state and apply edited cues back while retaining source timecodes and segment metadata.

## Task 1: Add the shared source transcript API

**Files:**
- Create `backend-go/internal/httpapi/source_transcript_handlers.go`.
- Modify `backend-go/internal/httpapi/project_handlers.go`.
- Reuse or modify `backend-go/internal/httpapi/deferred_clip_rendering.go`.

- [ ] Run GitNexus upstream impact for `projectRoutes`, `refreshGeneratedClipSubtitles`, and any helper that will be changed. Review the callers and affected flows before editing.
- [ ] Add `GET /api/projects/{projectID}/source-transcript` returning the full transcript, renewable master video URL, and authoritative source duration. Resolve data from the job result first, then local source metadata or `master/source_metadata.json` in S3.
- [ ] Add `PATCH /api/projects/{projectID}/source-transcript` accepting the corrected transcript. Reject malformed JSON, missing transcript segments, non-finite times, negative start times, and intervals where end is not after start.
- [ ] Rebuild only the original/generated transcript-derived cues for each existing clip using its current `start` and `end`. Preserve clip ranges, clip order, metadata, translated tracks, authored tracks, and subtitle styling.
- [ ] Persist the updated root transcript and per-clip derived tracks to the existing job result and available local/S3 metadata. Return a clear error on partial persistence so the UI can retain the draft for retry.
- [ ] Make project route dispatch handle the new source-transcript path for stored jobs and local metadata-backed history without weakening existing route access or changing other project endpoints.

## Task 2: Add a source-editor entry point in the project view

**Files:**
- Modify `dashboard/src/components/ProjectLibrary.jsx`.

- [ ] Add local `sourceEditorOpen` state to `ProjectLibrary`; leave global URL parsing and existing clip-editor routes untouched.
- [ ] Add **Edit full video** to the selected project view when source media and duration are available; disable it with a readable explanation when source data is missing.
- [ ] Mount `SourceTranscriptEditor` above the selected project detail and close it back to the same project without changing clip counts or clip state.
- [ ] Build the editor input from the project's authoritative master source URL and duration; do not add the source as a generated clip.

## Task 3: Reuse the existing editor for the entire source

**Files:**
- Create `dashboard/src/components/editor/SourceTranscriptEditor.jsx`.
- Modify `dashboard/src/components/local-editor/LocalEditorTab.jsx`.
- Create `dashboard/src/components/editor/sourceTranscriptEditorState.js`.

- [ ] Add `SourceTranscriptEditor` using the same `LocalEditorTab` timeline and subtitle cue editing used inside clip editing, without creating a fake generated clip or clip version.
- [ ] Fetch the shared transcript, master video URL, and source duration from `GET /api/projects/{projectID}/source-transcript`; initialize the editor at `0..source_duration` so both playback and timeline span the complete source.
- [ ] Add transcript conversion helpers that preserve transcript language, segment metadata, and source timecodes while mapping word-level transcript items to editor cues and edited cue text back to their original timed items.
- [ ] Add `editorTitle` and `hideExport` props to `LocalEditorTab`; show **Save subtitles to clips** in source mode, hide video export, and keep existing default and clip-mode controls unchanged.
- [ ] On save, send the updated transcript to `PATCH /api/projects/{projectID}/source-transcript`, show progress, retain unsaved changes on error, and show success only after the server confirms persistence.

## Task 4: Make existing clip manifests use the current shared transcript

**Files:**
- Modify `backend-go/internal/httpapi/clip_handlers.go`.
- Reuse `refreshGeneratedClipSubtitles` from `backend-go/internal/httpapi/deferred_clip_rendering.go`.

- [ ] On `GET /api/clip/{jobID}/{index}/manifest`, load the canonical source transcript and refresh only the manifest's original/generated subtitle track for the persisted clip range before returning it.
- [ ] Preserve subtitle style, translated tracks, authored tracks, manifest immutability on disk, and the current revision response contract.
- [ ] Preserve existing subtitle cue edit behavior and manifest immutability.

## Task 5: Apply and inspect the local change

**Files:** all files in Tasks 1–4.

- [ ] Run `gofmt` on modified Go files and `go build ./...` from `backend-go`.
- [ ] From `dashboard`, run `npm run format`, `npm run format:check`, and `npm run lint` as required by `AGENTS.md`.
- [ ] Review `git diff` and `git status`; stage only this feature. Run GitNexus `detect_changes()` before committing.
- [ ] Commit the feature with `feat: edit full source transcript across clips` after required checks pass.
- [ ] Restart the local application with `scripts/manage-local.ps1 -Action Restart`, then run `-Action Status` and relevant health checks.
- [ ] In Brave, open the supplied project URL, use **Edit full video**, and confirm the source plays from the beginning through its full duration with the full timed transcript visible. Do not change or save the user's transcript during this visual inspection.

## Self-review against the approved specification

- Full-source entry, playback, and timeline duration are covered by Tasks 2–3.
- Full timed transcript view and source-time preservation are covered by Tasks 1 and 3.
- Shared transcript persistence and regeneration for all current clip intervals are covered by Task 1.
- Fresh clip-editor captions and preserved translated/authored tracks are covered by Tasks 1 and 4.
- Unchanged clip boundaries and no AI reselection or automatic video render are explicit in Tasks 1, 2, and 5.
- Error handling, retryable draft, and success state are covered by Tasks 1 and 3.
- Existing clip routes and editor behavior are preserved by Tasks 2–4; after a source correction, clip editor manifests return current original/generated captions.
- No automated tests are added or run because the current task did not request tests; the plan uses formatting, lint, build, managed health checks, and a read-only Brave inspection.
