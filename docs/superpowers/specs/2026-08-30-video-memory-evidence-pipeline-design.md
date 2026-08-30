# Video Memory Evidence Pipeline Design

**Date:** 2026-08-30
**Status:** Proposed for implementation planning

## Goal

Add a source-centric Video Memory workflow that can inspect a long video once, cache synchronized transcript and visual evidence, and use Codex to return explainable clip candidates that can be rendered by the existing FFmpeg pipeline.

## Phase-one decisions

- OpenRouter is the only remote provider for transcription and bulk visual analysis.
- Codex is the reasoning provider for semantic transcript segmentation, evidence fusion, candidate ranking, and clip-boundary selection.
- Provider routing is stage-specific: transcription and vision use OpenRouter, while reasoning uses the connected Codex provider. A Codex selection must not accidentally route bulk vision work through Codex, and a missing provider credential must fail the affected stage clearly.
- FFmpeg, PySceneDetect, keyframe extraction, person/face metadata, caching, and rendering remain local in the existing worker environment.
- Phase one uses transcript segments and scene boundaries. It does not include WhisperX, pyannote, word-level timestamps, speaker labels, or audio-event classification.
- Visual analysis uses sampled keyframes, not the full source video. Codex receives only candidate evidence and selected keyframes, never the full video.
- A source analysis is reusable across ranking prompts. Changing the prompt or requested number of clips must not retranscribe or re-caption the source.
- The Video Memory feature is source-centric and separate from the existing Highlights result, but it reuses the current job lifecycle and deferred clip renderer.

## User workflow

1. The user creates a Video Memory project from a source video.
2. The system creates or loads a cached source analysis.
3. The worker detects scenes, extracts keyframes, transcribes the source through OpenRouter in bounded chunks, and asks an OpenRouter vision model for concise scene evidence.
4. Codex converts the transcript and visual evidence into semantic timeline segments and stores baseline candidate metadata.
5. The user enters a request such as “find three short moments where the speaker makes a surprising claim and reacts strongly.”
6. The system retrieves relevant timeline segments, sends their transcript, evidence, and selected keyframes to Codex, and receives ranked clip plans.
7. Each plan is expanded to include setup and payoff, constrained by the requested duration, and passed to the existing deferred renderer.
8. The UI shows each suggestion with start/end times, score, explanation, and evidence references. The user can preview or render the suggestion.

## Architecture

```text
Source video
    │
    ├── FFmpeg + PySceneDetect ── scenes, boundaries, keyframes
    ├── Existing person/face analysis ── visual metadata
    └── FFmpeg audio extraction
             │
             ├── OpenRouter STT ── transcript + segment timestamps
             └── OpenRouter vision ── scene descriptions + OCR/evidence
                         │
                         ▼
              Cached Video Memory manifest
                         │
              Codex semantic segmentation
                         │
                  Local timeline index
                         │
                    User query/prompt
                         │
              Local candidate retrieval
                         │
              Codex evidence-aware ranking
                         │
                 clip plans + explanations
                         │
               Existing deferred renderer
```

The Go control plane owns project and job lifecycle, authorization, persistence, and API responses. The Python worker owns media inspection, OpenRouter calls, evidence normalization, cache files, Codex requests, and clip-plan generation. The dashboard owns project creation, analysis progress, query submission, candidate display, preview, and render actions.

## Pipeline stages

### 1. Source identity and cache

The source cache is keyed by the existing source fingerprint plus an evidence-analysis version and the effective analysis settings. The key must include the transcription model, vision model, scene settings, keyframe policy, prompt/schema version, and provider configuration that changes output.

The cache is valid only when all of those values match. A source file change or analysis-version change creates a new manifest without deleting the previous one.

The existing source-analysis cache remains the owner of scene boundaries and reusable scene strategy data. Video Memory adds a separate evidence manifest that references those scene IDs and stores transcript, keyframe, and semantic evidence.

### 2. Local scene and keyframe evidence

Use the existing PySceneDetect-based scene analysis and source fingerprinting. For each scene, extract a small bounded set of representative frames: beginning, middle, end, and one additional motion/change frame when the scene is long or visually active. The extractor must enforce a maximum number of frames per scene and a maximum total frame count per source.

Keyframes are written under the source analysis directory with deterministic names derived from scene ID and timestamp. The manifest stores the timestamp, relative artifact path, image dimensions, and extraction settings.

Existing person/face counts and TRACK/GENERAL strategy metadata are included as evidence. No new tracking algorithm is required for this feature.

### 3. OpenRouter transcription

The worker extracts a compressed audio representation and sends bounded chunks through the existing OpenRouter transcription path. The complete source transcript is assembled using absolute timestamps and overlap de-duplication already used by the current highlight pipeline.

Phase-one transcript records contain:

```json
{
  "language": "en",
  "text": "full source text",
  "segments": [
    {"id": "tr_001", "start": 42.1, "end": 48.7, "text": "..."}
  ]
}
```

Only segment timestamps are required. The schema must leave room for a future `words` array and `speaker` field without requiring them in phase one.

A transcription failure marks the analysis job failed and leaves any prior valid manifest untouched. A later retry may reuse completed local scene/keyframe work.

### 4. OpenRouter visual evidence

The default vision model is configurable and initially set to `qwen/qwen3-vl-32b-instruct`. It receives a small group of keyframes for one scene together with timestamps and a strict JSON-output instruction. The prompt asks for observable evidence only:

- people and important objects
- visible actions or state changes
- camera/composition and visible emotion when clear
- on-screen text/OCR
- whether the scene appears visually useful for a short clip
- uncertainty when the frames are insufficient to establish an event

The result is stored per scene and linked to the exact keyframes used. Descriptions must not invent motion between frames. Claims such as “scores a goal” require either enough temporal evidence or an explicit uncertainty marker.

The vision stage is independently retryable. If it fails, transcript-only ranking remains available and the UI reports that visual evidence is incomplete.

### 5. Codex semantic segmentation

Codex receives bounded transcript windows, scene IDs, visual descriptions, OCR text, and local person/face metadata. It creates semantic timeline segments that may span multiple transcript segments or scenes. Each segment preserves absolute start/end times and references its source evidence.

The output schema is:

```json
{
  "segments": [
    {
      "id": "mem_001",
      "start": 128.0,
      "end": 169.0,
      "transcript": "...",
      "scene_ids": ["scene_14"],
      "evidence_refs": ["frame_scene_14_mid"],
      "topics": ["founder mistake"],
      "hook": "The biggest mistake founders make...",
      "setup": "...",
      "payoff": "..."
    }
  ]
}
```

Segmentation is query-independent and is cached. It must not return a clip plan that falls outside the source duration or its referenced evidence window.

### 6. Candidate retrieval and Codex ranking

The worker stores semantic segments in a lightweight local SQLite FTS5 index associated with the source manifest. The index is used only to narrow a user request to a bounded set of relevant segments; it is not the final judge.

For a query, local retrieval returns at most 30 segments with neighboring context. Codex receives those segments, their visual evidence, the user’s request, clip-count and duration constraints, and selected keyframes for the strongest candidates.

Codex returns:

```json
{
  "candidates": [
    {
      "start": 122.0,
      "end": 174.0,
      "score": 0.93,
      "reason": "Strong standalone claim followed by a visible reaction and conclusion.",
      "evidence_refs": ["mem_001", "frame_scene_14_mid"],
      "setup_start": 122.0,
      "event_start": 128.0,
      "payoff_end": 174.0
    }
  ]
}
```

The worker validates JSON, clamps timestamps to the source duration, rejects inverted or empty ranges, removes near-duplicate candidates, and applies requested duration limits. It does not use word-level snapping in phase one.

### 7. Clip rendering

Candidate plans are persisted before rendering. Preview and render actions reuse the existing deferred clip-render path, metadata format, source-analysis reuse, and FFmpeg extraction. The plan’s explanation and evidence references are retained in the clip metadata so the dashboard can display why the clip was suggested after rendering.

## Persistence and API shape

The feature should add a source-centric Video Memory project surface while reusing the existing job and artifact conventions.

The API needs these operations:

- create/list/get a Video Memory project
- start or retry source analysis
- get analysis status and manifest summary
- submit a natural-language query with clip constraints
- list query candidates with explanations and evidence references
- create or retrieve a deferred render for a candidate

The Go layer should persist project identity, source identity, latest analysis job, latest query job, and artifact references. Large transcripts, keyframe manifests, visual descriptions, and semantic segments remain worker artifacts rather than being copied into job rows.

AI settings must carry separate effective provider/model values for transcription, vision, and reasoning. The initial defaults are OpenRouter for transcription, `qwen/qwen3-vl-32b-instruct` through OpenRouter for vision, and the user’s connected Codex model for reasoning. The settings response should expose which stage is configured and whether its credential is available.

The dashboard should use a separate Video Memory tab or route. It should show source-analysis progress, a query form, candidate cards, timestamped evidence thumbnails, the Codex reason, and actions for preview/render. Existing Highlights UI and job behavior remain unchanged.

## Error handling

- Source probe or scene extraction failure: fail analysis with a user-visible error; no new manifest is published.
- OpenRouter transcription failure: retry the failed chunk; if retries fail, preserve the previous manifest and mark the new analysis failed.
- OpenRouter vision failure: record scene-level incomplete evidence and continue with transcript-only analysis.
- Codex segmentation failure: preserve transcript and visual evidence; allow segmentation retry without repeating upstream work.
- Codex ranking failure: preserve the query and allow retry; do not create render jobs without validated candidates.
- Render failure: use existing deferred-render failure and retry behavior.
- Cancellation: stop future chunks and avoid publishing a partial manifest as current.

## Cost and performance controls

- Transcribe the source once and cache it.
- Caption only representative keyframes, grouped by scene.
- Keep visual prompts concise and request compact JSON.
- Use local retrieval to cap Codex ranking context.
- Send keyframe images to Codex only for the strongest candidate windows.
- Record provider, model, request count, processed audio duration, frame count, and usage/cost metadata in the analysis manifest and query result.
- Make frame density, maximum frames, vision model, and ranking model configurable per analysis.

## Security and privacy

OpenRouter receives extracted audio and keyframe images. Codex receives transcript text, metadata, visual descriptions, and selected keyframes. API keys and Codex credentials remain server-side and are never written into manifests, job metadata, or dashboard payloads. Artifact URLs exposed to the dashboard must use the repository’s existing authenticated/download mechanism. The worker records provider and model identifiers, but never records secret values.

## Deferred phases

The following are intentionally excluded from phase one:

- word-level timestamps and sentence snapping
- speaker labels or diarization
- WhisperX and pyannote
- local or remote audio-event classification such as laughter, applause, or music
- embedding-based retrieval and cross-video memory
- domain-specific event detectors for sports and gaming
- joint audio-video models such as Qwen3-Omni

These additions can consume the same timeline/evidence interfaces later. Adding them must not invalidate phase-one transcript segments or candidate plans.

## Acceptance criteria

Phase one is complete when:

1. A source can be analyzed once and the resulting manifest can be reused for multiple queries.
2. A one-hour talking-head or tutorial video produces scene records, representative keyframes, a timestamped transcript, and visual evidence without word-level or speaker fields.
3. A natural-language query returns validated, ranked candidates with timestamps, scores, reasons, and evidence references.
4. A candidate can be previewed and rendered through the existing deferred renderer.
5. Retrying Codex ranking does not repeat transcription or visual analysis.
6. A vision failure still leaves a usable transcript-only path.
7. Existing Highlights, clip rendering, and unrelated face-tracking changes remain unaffected.
8. Backend, worker, and dashboard tests cover happy paths, cache reuse, malformed model output, partial evidence, retries, cancellation, and timestamp validation.
