# Lossless Timestamped Clip Discovery Design

**Date:** 2026-09-01

**Status:** Proposed design for review

## Problem

OpenShorts can receive word-level transcript timestamps, but the current analysis prompts intentionally reduce transcripts to timestamped segments. Both analysis paths also use disjoint prompt chunks. A strong moment that crosses a chunk boundary can therefore lack context in every request, and the model must guess precise boundaries from coarse segment timestamps.

The objective is to make clip discovery boundary-safe and timestamp-precise without changing the public clip response shape.

## Decision

Use an analysis-only canonical transcript timeline and overlapping discovery windows.

The canonical timeline preserves:

- Complete segment text and segment start/end timestamps.
- Every valid word with absolute start/end timestamps when available.
- Stable IDs assigned once per analysis request.
- Explicit segment-level fallback when word timestamps are unavailable.

Each model request contains:

- A contiguous core range owned by that request.
- At least 61 seconds of context on either side where available.
- Complete transcript records intersecting the context.
- Compact word timestamp arrays.
- Absolute source-video timestamps.
- The core/context metadata required for candidate ownership.

The model returns start/end unit IDs. The backend resolves those IDs to canonical timestamps and uses those timestamps as authoritative.

## Guarantee boundary

The system guarantees input coverage, not model judgment.

For every valid candidate interval of 15–60 seconds, there must be at least one successful model request whose context contains the complete interval. This removes losses caused by chunk boundaries.

The model may still fail to recognize an interesting moment. That is measured as model recall and is not represented as a hard correctness guarantee.

## Canonical transcript representation

Add a focused module named transcript_windows.py. It owns analysis data preparation and does not replace the public transcript schema.

Internally, use a structure equivalent to:

~~~json
{
  "timestamp_mode": "word",
  "segments": [
    [12, 180.000, 186.400, "The complete segment text", [981, 982, 983]]
  ],
  "words": [
    [981, 180.120, 180.540, "The"],
    [982, 180.560, 181.020, "complete"],
    [983, 181.040, 181.600, "segment"]
  ]
}
~~~

For segment-only transcripts:

~~~json
{
  "timestamp_mode": "segment",
  "segments": [
    [12, 180.000, 186.400, "The complete segment text", []]
  ],
  "words": []
}
~~~

Rules:

- Normalize provider aliases: word/text and start/end or s/e.
- Normalize whitespace and round timestamps to three decimals.
- Reject empty text and non-positive intervals.
- Sort by absolute start/end.
- Preserve segment text even when word timestamps are present; word timestamps provide precision, while segment text preserves punctuation and complete context.
- Do not fabricate word timestamps from segment text.
- IDs are assigned after normalization and sorting, then reused in every overlapping window.
- The canonical analysis timeline is separate from subtitle/public transcript merging in the first implementation.

## Window construction

Use these defaults:

~~~python
MAX_CLIP_DURATION_SECONDS = 60.0
ANALYSIS_OVERLAP_SECONDS = 61.0
DEFAULT_CORE_SECONDS = 90.0
~~~

Partition the source into contiguous core ranges:

~~~text
core_0 = [0, core_end_0)
core_1 = [core_end_0, core_end_1)
...
core_last ends at video_duration
~~~

For every core range:

~~~text
context_start = max(0, core_start - ANALYSIS_OVERLAP_SECONDS)
context_end = min(video_duration, core_end + ANALYSIS_OVERLAP_SECONDS)
~~~

Include every complete segment and word record intersecting the context range. Never split a segment, word, or JSON record in the middle.

The planner grows each core only while the complete serialized prompt payload fits the configured budget. Payload sizing includes:

- Window metadata.
- Complete transcript data.
- Source context.
- Prompt instructions.
- A safety allowance for model output instructions.

Use compact arrays before reducing content. If even the minimum lossless window cannot fit, raise an explicit error and mark analysis incomplete; never silently remove timestamps or transcript text.

The planner must guarantee:

- Core ranges are contiguous and gap-free.
- Every source-time interval belongs to one core.
- Every unit needed by a candidate is present in at least one context window.
- Adjacent request coverage overlaps by at least 61 seconds wherever both sides exist.
- The planner always advances through silent gaps and malformed records.

## Model contract

Both prompts retain their existing domain-specific quality instructions but share the timestamp contract.

The prompt must state:

- All timestamps are absolute source-video seconds.
- Context is provided for comprehension.
- Only candidates whose start unit belongs to the current core should be returned.
- The final requested clip count does not limit discovery in the current window.
- Candidate end units may be in right-side context.
- Unit IDs are authoritative; returned decimal timestamps are echoes for validation.

Candidate shape:

~~~json
{
  "start_unit_id": 981,
  "end_unit_id": 1042,
  "start": 180.120,
  "end": 239.880,
  "score": 0.92
}
~~~

For segment-only transcripts, the model returns segment IDs instead. Older models that return only numeric start/end remain supported as a compatibility fallback and are marked as approximate.

## Discovery and selection

The pipeline must use this order:

~~~text
canonical transcript
  -> overlapping windows
  -> one discovery call per window
  -> retry failed windows once
  -> resolve unit IDs to canonical timestamps
  -> deduplicate overlapping-window results
  -> globally rank/diversify
  -> apply final target clip count
~~~

The final target count must never be divided among windows.

Use a generous discovery result limit independent of the requested final count. If a model returns exactly the per-window discovery limit, record the window as saturated and issue one continuation request asking for additional candidates not represented by the returned unit-ID pairs.

Candidate deduplication rules:

1. Exact matching start/end unit IDs are duplicates.
2. Candidates with IoU at least 0.75 and boundaries within three seconds are duplicates.
3. Keep the highest-scoring candidate and preserve its metadata.
4. Do not remove merely overlapping but materially different candidates before global selection.

For ID-backed candidates:

- Resolve start from the start unit start timestamp.
- Resolve end from the end unit end timestamp.
- Validate source bounds and duration.
- Do not run broad post-resolution boundary snapping.
- Apply existing snapping only to numeric fallback candidates without valid unit IDs.

## Failure and observability behavior

Each window call has an explicit status:

- planned
- started
- succeeded
- retried
- failed
- saturated

Retry a failed window once. After retry, compare successful core ranges against the source duration.

If any core range is missing:

- Do not report coverage as complete.
- Include the missing ranges and failed window IDs in logs/result metadata.
- Use the existing transcript fallback or return the existing error path according to the caller’s current behavior.
- Never silently proceed as if the complete source was analyzed.

Log for every window:

- window index and total;
- core start/end;
- context start/end;
- timestamp mode;
- unit and segment counts;
- prompt character count;
- attempt number;
- raw candidate count;
- resolved candidate count;
- deduplicated candidate count;
- saturation or failure status.

## Compatibility and rollout

Do not change merge_transcript_segments in the first implementation unless tests demonstrate that its public output is insufficient. The analysis timeline will deduplicate analysis units independently, reducing regression risk for subtitles and existing worker consumers.

Keep:

- Existing OpenRouter 30-second audio chunking and selected-range time semantics.
- Existing fallback clip generation.
- Existing top-level shorts/highlights response shapes.
- Existing provider/model configuration.
- Existing LM Studio minimum-duration stretching, applied before canonical ID resolution only when required by that provider.

Roll out in phases:

1. Implement and test transcript_windows.py without changing callers.
2. Migrate main.py clip discovery.
3. Validate logs, boundary recall, and canonical bounds on real videos.
4. Migrate highlight_generation.py.
5. Compare candidate counts, duplicate rates, prompt sizes, latency, and fallback rates before tuning core size or overlap.

## Testing strategy

Unit tests must cover:

- Provider timestamp aliases.
- Word normalization and deterministic IDs.
- Complete segment text preservation.
- Segment-only fallback without fabricated words.
- Contiguous core coverage.
- At least 61 seconds of overlap.
- A synthetic 15–60 second interval crossing every generated core boundary.
- No word/segment record splitting.
- Full-payload size enforcement.
- Explicit failure when minimum lossless context cannot fit.
- Candidate ID resolution overriding intentionally incorrect model floats.
- Rejection of invalid IDs, durations, and out-of-range candidates.
- Exact and near-duplicate candidate removal.
- Saturated-window continuation.
- Failed-window retry and incomplete-coverage reporting.
- Backwards compatibility for numeric-only model results.

Integration tests must cover both main.py:get_viral_clips and highlight_generation.py:rank_highlights:

- Multiple windows are sent for oversized transcripts.
- Every prompt contains core/context metadata and timestamped units.
- Final target count is applied only after global collection.
- A candidate returned from a boundary window is emitted once with canonical bounds.
- Existing fallback behavior remains unchanged when no usable candidates exist.

## Alternatives rejected

### Disjoint chunks with larger text payloads

Rejected because a candidate crossing a boundary can still be split between requests, regardless of timestamp precision.

### Segment timestamps only

Rejected because the model cannot reliably choose word-accurate boundaries inside a long segment.

### Word timestamps without overlap

Rejected because precise timestamps do not provide semantic context across chunk boundaries.

### Overlap plus final global ranking, without core ownership

Rejected because the same candidate can be emitted multiple times and boundary candidates can be inconsistently scored. Core ownership makes deduplication deterministic.

### Changing public transcript merging first

Rejected because it expands the regression surface before proving the analysis requirement needs that change.

## Success metrics

Compare before and after on a fixed evaluation set:

- Percentage of known boundary-crossing moments returned.
- Timestamp error against canonical word boundaries.
- Duplicate candidate rate before/after deduplication.
- Percentage of analyses with complete core coverage.
- Average prompt size and number of model calls.
- Retry and fallback rates.
- End-to-end latency.

The implementation is ready when boundary-induced misses are zero in deterministic tests, canonical ID-backed boundaries are stable, complete coverage is observable, and the existing Python test suite passes.

