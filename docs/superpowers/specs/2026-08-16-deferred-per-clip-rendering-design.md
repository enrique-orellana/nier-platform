# Deferred per-clip rendering

**Date:** 2026-08-16  
**Status:** Design approved for review  
**Scope:** Long-video clip discovery and optional Streamer Stack rendering

## Goal

Let users discover candidate clips quickly, inspect the results, and explicitly choose which clips receive face analysis, scene-aware tracking, vertical composition, encoding, and upload. The expensive work must happen per clip only after the user clicks that clip's action.

## User-facing behavior

The Clip Generator becomes a two-stage workflow:

1. `Generate Clips` prepares the source, creates the transcript, and asks the AI to identify candidate moments. It does not run face analysis or vertical rendering.
2. Each candidate result card displays an `Analyze & Render` button.
3. Clicking a button queues only that clip for face analysis, scene-aware tracking, Streamer Stack or Standard composition, encoding, validation, and upload.
4. Each clip displays its own state: `Found`, `Queued`, `Analyzing`, `Rendering`, `Ready`, or `Failed`.
5. A failed clip can be retried independently. A ready clip is idempotent and is not rendered again unless the user explicitly retries or requests a new version.

Streamer Stack keeps its selected facecam size and applies it only during the per-clip render. Standard 9:16 uses the same staged workflow so the user can also defer its expensive conversion.

## Recommended architecture

### Discovery parent job

The existing process request gains a staged/deferred mode used by the dashboard. The parent job persists:

- A durable source reference and the retained working/output directory.
- Source metadata needed for clip timestamps and later rendering.
- The transcript and AI clip plan.
- Layout format and facecam-size settings.
- Per-clip render state and any completed output metadata.

The discovery phase may download/copy the source and transcribe it because those artifacts are required to find clips. It must not build source-wide scene strategies, run face recognition, or render vertical output. AV1/OpenCV compatibility conversion is deferred until the first render that needs it and then cached for subsequent clips.

The parent remains available in a `clips_ready` state after discovery. The normal job status endpoint returns the candidate clips and their individual states so the browser can render buttons immediately and resume after refresh.

### Per-clip render job

The dashboard sends a dedicated render request containing the parent job ID and clip index. The control plane validates that the parent exists, the index is valid, and the clip is not already ready. It creates or queues one child render operation and updates the clip state.

The Python worker receives the persisted clip range and layout settings. It lazily performs the expensive work for that range only:

1. Prepare or reuse the OpenCV-compatible source.
2. Build scene boundaries and face/scene strategy data for the selected range, or use the existing bounded tracking fallback when no scene strategy is required.
3. Decode only the requested clip range, including keyframe preroll.
4. Run face/person analysis during composition.
5. Compose the requested layout, encode video, extract the clip audio, merge, validate, and publish the final artifact.

Analysis artifacts are cached per parent job and clip range. A second clip must not invalidate or repeat the first clip's completed render.

## API and persistence contract

- Add a dashboard-controlled deferred flag to the existing process request while preserving current behavior for older clients that omit it.
- Return a successful discovery response with the parent job ID and `clips_ready` state rather than waiting for all renders.
- Add a per-clip render endpoint under the existing job API, using the parent job ID and clip index.
- Extend job/result serialization with per-clip status, progress/log messages, output metadata, and errors.
- Keep the existing status polling mechanism; it must report parent discovery completion separately from child render progress.
- Reject render requests for expired jobs, unknown clips, duplicate active requests, and incompatible layout metadata with clear client errors.

The source and transcript remain retained under the current job retention policy. If the user clicks after retention, the UI shows that the source expired and asks them to run discovery again.

## UI changes

- Keep the existing input form and layout controls.
- Change the initial processing state to show discovery progress and then candidate cards.
- Add an `Analyze & Render` action to every candidate card.
- Disable only the clicked card while it is queued or processing; other cards remain actionable.
- Show per-clip progress and errors without replacing the complete candidate list.
- Preserve existing preview, hook, subtitle, editor, and download actions after a clip reaches `Ready`.
- Keep a retry action for failed clips and prevent duplicate requests from double-clicks.

## Error handling and concurrency

- Discovery failure fails the parent job and leaves no renderable candidates.
- A render failure changes only that clip to `Failed`; other clips remain available.
- The worker scheduler limits concurrent render jobs according to the existing resource budget, initially serializing renders to avoid GPU/CPU contention.
- The render endpoint is idempotent for an already-ready clip and returns its existing result.
- Temporary files are never exposed as final clips; validation must pass before a clip becomes `Ready`.

## Backward compatibility

- Existing API clients without deferred mode retain the current automatic end-to-end behavior.
- Existing Standard and Streamer Stack manifests remain readable.
- Existing completed clip actions continue to work.
- The new per-clip endpoint uses the same output and manifest schema as current renders.

## Testing and acceptance criteria

Backend and worker tests must verify:

- Discovery does not call face analysis, scene strategy analysis, or vertical rendering.
- Discovery persists the clip plan and returns `clips_ready` with per-clip `Found` states.
- Rendering one clip transitions only that clip through queued/analyzing/rendering/ready states.
- Other clips remain untouched when one clip is rendered or fails.
- Duplicate render requests are rejected or return the existing active/ready operation.
- Retried failures can complete successfully.
- Streamer Stack and Standard layout metadata reach the worker unchanged.
- Source preparation and expensive analysis are cached and reused per clip where valid.
- Final validation and artifact publication remain unchanged.

Dashboard tests must verify:

- Candidate cards show individual render buttons after discovery.
- Clicking one button updates only that card.
- Other cards remain clickable while the selected card renders.
- Failed clips show retry and ready clips show the existing actions.
- Refreshing/resuming a job restores per-clip states.

Performance acceptance is comparative rather than a fixed wall-clock promise: the discovery phase must omit the measured source-wide scene/face work and all vertical rendering, and a clip render must process only the selected range plus decoder preroll.

## Scope boundaries

This change does not add automatic selection of which candidate to render, multi-user authorization, a new editor timeline, or unbounded parallel rendering. It focuses on making the existing candidate list actionable one clip at a time.
