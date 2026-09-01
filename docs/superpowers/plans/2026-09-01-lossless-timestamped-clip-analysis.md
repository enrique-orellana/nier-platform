# Lossless Timestamped Clip Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Send complete absolute timestamp data to the clip-analysis model while using budget-safe overlapping windows so clip candidates are precise and are not lost merely because they cross a chunk boundary.

**Architecture:** Normalize each transcript into one canonical, globally indexed timeline of timestamped words, with timestamped segments as an explicit fallback when word data is unavailable. Analyze contiguous core ranges surrounded by at least 61 seconds of context, ask every window for candidates independently, resolve returned unit IDs back to canonical timestamps, then deduplicate and rank candidates globally.

**Tech Stack:** Python, JSON prompts, pytest, existing main.py clip generation, highlight_generation.py long-form highlights, OpenRouter/Gemini/Ollama-compatible chat_json calls, GitNexus impact/change analysis.

---

## Scope and current behavior

The change covers both model-analysis paths:

- main.py:_clip_analysis_chunks currently sends {start, end, text} and drops word timestamps.
- main.py:get_viral_clips uses non-overlapping analysis chunks and divides the final target count across them, which can suppress strong candidates in a busy chunk.
- highlight_generation.py:_analysis_chunks has the same segment-only, non-overlapping behavior.
- highlight_generation.py:transcribe_video_with_config already requests segment and word timestamps for OpenRouter transcription and applies chunk-relative offsets before returning the transcript.
- highlight_generation.py:merge_transcript_segments removes only duplicate complete segment text; overlap deduplication must also preserve a canonical word timeline.

The public candidate shape remains backwards-compatible: callers still receive start, end, score, reason/metadata, and text fields. Internal start_word_id/end_word_id or start_segment_id/end_segment_id fields make model-selected bounds deterministic and may be retained for debugging.

GitNexus impact checks for the affected symbols are currently LOW risk. The largest direct scope is the handle_request highlight-generation flow through rank_highlights; public transcript merging and transcription are intentionally outside the first production change. Re-run the checks after re-indexing before implementation and before every commit.

## Files and responsibilities

- Create: transcript_windows.py — canonical timestamped-unit normalization, lossless overlapping-window construction, candidate-bound resolution, and candidate deduplication.
- Modify: main.py:139-185 — update the clip-analysis prompt and constants to describe the window/unit contract.
- Modify: main.py:2358-2577 — replace local segment-only chunking, analyze every window with a broad per-window candidate limit, resolve IDs, deduplicate, and select final clips.
- Modify: highlight_generation.py:18-44 — update the long-form highlight prompt and constants.
- Modify: highlight_generation.py:62-117 — preserve and merge word timestamps while retaining the existing transcription chunk API.
- Modify: highlight_generation.py:209-345 — use the shared analysis windows, resolve exact bounds, and deduplicate candidates globally.
- Create: tests/test_transcript_windows.py — focused tests for timeline normalization, overlap invariants, packing, ID resolution, and deduplication.
- Modify: tests/test_clip_analysis_prompt.py — update prompt assertions and add a boundary-crossing candidate test for get_viral_clips.
- Modify: tests/test_highlight_generation.py — update analysis-chunk expectations and add word-merge/boundary coverage tests.

## Invariants to preserve

1. All timestamps sent to the model and returned to the API are absolute seconds from the source video start.
2. Word/unit records are never split in the middle. If only segment timestamps exist, the system must not invent word timestamps.
3. Every core range is covered exactly once by the window planner.
4. Adjacent model windows contain at least MAX_CLIP_DURATION_SECONDS + 1 seconds of temporal overlap, currently 61 seconds for the existing 60-second maximum clip.
5. A candidate may use context to understand a moment, but its start unit must belong to the window’s core range. This gives every candidate one owning window and avoids duplicate ownership.
6. The final target count is applied only after all windows have returned candidates.
7. A model-provided float timestamp is treated as an echo/check value when unit IDs are present; canonical unit timestamps win.
8. If a prompt cannot fit even the minimum lossless window after compact serialization, fail that analysis request explicitly instead of silently dropping transcript data.

## Approved design corrections

The following rules supersede any earlier task example that conflicts with them:

- The shared representation preserves complete segments and a separate word array. It is not a flat replacement for the public transcript schema.
- The first implementation does not change merge_transcript_segments or OpenRouter transcription behavior. Analysis-only deduplication is lower risk.
- The planner must test actual candidate containment, not merely that adjacent context ranges overlap.
- A hard per-window candidate limit cannot claim exhaustive model recall. Use a generous discovery limit, mark a window saturated when the limit is reached, and issue one continuation request for additional unit-ID pairs.
- A failed window is retried once. Missing core coverage is reported as incomplete and cannot be presented as a complete analysis.
- Canonical-unit candidates bypass broad boundary snapping. Existing snapping remains only for numeric-only legacy responses.

## Task 0: Refresh code intelligence and establish a baseline

**Files:** None modified.

- [ ] **Step 1: Refresh GitNexus because the indexed repository is three commits behind.**

Run from D:\workspace\openshorts:

~~~powershell
node .gitnexus/run.cjs analyze
~~~

Expected: the index completes successfully and reports the current nier-platform revision.

- [ ] **Step 2: Re-run pre-change impact analysis after indexing.**

Run GitNexus impact with direction "upstream" for these targets and file hints:

~~~text
_clip_analysis_chunks              main.py
get_viral_clips                    main.py
_analysis_chunks                   highlight_generation.py
rank_highlights                    highlight_generation.py
~~~

Expected: no HIGH or CRITICAL result. If any target becomes HIGH or CRITICAL, stop implementation and review its direct callers before editing it.

- [ ] **Step 3: Run the existing focused tests before changing behavior.**

~~~powershell
pytest -q tests/test_clip_analysis_prompt.py tests/test_highlight_generation.py
~~~

Expected: the current focused suite passes. Save the result as the baseline for the implementation session.

## Task 1: Define the canonical analysis timeline

**Files:**

- Create: transcript_windows.py
- Test: tests/test_transcript_windows.py

- [ ] **Step 1: Add failing tests for complete segment text, word timing, fallback, and aliases.**

Use a timeline shape with separate complete segments and word arrays:

~~~python
from transcript_windows import build_analysis_timeline


def test_analysis_timeline_preserves_complete_segments_and_word_timestamps():
    transcript = {
        "segments": [{
            "start": 12.0,
            "end": 14.0,
            "text": "Hello world",
            "words": [
                {"word": "Hello", "start": 12.125, "end": 12.600},
                {"word": "world", "start": 12.650, "end": 13.400},
            ],
        }]
    }

    assert build_analysis_timeline(transcript, 60.0) == {
        "timestamp_mode": "word",
        "segments": [[0, 12.0, 14.0, "Hello world", [0, 1]]],
        "words": [
            [0, 12.125, 12.600, "Hello"],
            [1, 12.650, 13.400, "world"],
        ],
    }


def test_analysis_timeline_uses_segment_fallback_without_fabricating_words():
    transcript = {
        "segments": [{
            "start": 20.0,
            "end": 24.5,
            "text": "Only segment timing",
        }]
    }

    assert build_analysis_timeline(transcript, 60.0) == {
        "timestamp_mode": "segment",
        "segments": [[0, 20.0, 24.5, "Only segment timing", []]],
        "words": [],
    }
~~~

- [ ] **Step 2: Run the new tests to confirm the API is not implemented yet.**

~~~powershell
pytest -q tests/test_transcript_windows.py
~~~

Expected: FAIL because transcript_windows.py and build_analysis_timeline do not exist.

- [ ] **Step 3: Implement the analysis-only timeline API.**

Define:

~~~python
def build_analysis_timeline(
    transcript: Mapping[str, Any],
    video_duration: float,
    *,
    time_origin_seconds: float = 0.0,
) -> dict[str, Any]:
    """Preserve complete segments and precise words without mutating transcript."""


def compact_timeline_for_prompt(
    timeline: Mapping[str, Any],
    *,
    context_start: float,
    context_end: float,
) -> dict[str, Any]:
    """Serialize complete intersecting segments and words compactly."""


def timeline_units_by_id(
    timeline: Mapping[str, Any],
) -> dict[tuple[str, int], dict[str, Any]]:
    """Index word and segment records for candidate resolution."""
~~~

Requirements:

- Accept provider aliases word/text and start/end or s/e.
- Normalize whitespace, round timestamps to three decimals, and reject invalid records.
- Preserve complete segment text even when words exist.
- Keep valid words for precision. If a segment has partial word data, retain both the segment and valid words.
- Assign deterministic IDs after sorting, with separate word and segment namespaces.
- Deduplicate repeated analysis words using normalized text plus three-decimal start/end timestamps; do not mutate the public transcript or remove legitimately repeated words at different timestamps.
- Apply time_origin_seconds only for callers analyzing a local range. Full-source callers pass zero.
- Never mutate or replace the public transcript returned by the existing worker.

- [ ] **Step 4: Add alias and partial-word tests, then run the shared tests.**

~~~python
def test_analysis_timeline_accepts_s_and_e_aliases():
    transcript = {
        "segments": [{
            "s": 5.0,
            "e": 7.0,
            "text": "Alias words",
            "words": [
                {"text": "Alias", "s": 5.1, "e": 5.6},
                {"text": "words", "s": 5.7, "e": 6.4},
            ],
        }]
    }

    assert build_analysis_timeline(transcript, 10.0)["words"] == [
        [0, 5.1, 5.6, "Alias"],
        [1, 5.7, 6.4, "words"],
    ]
~~~

Add a duplicate-overlap fixture with the same word text and identical timestamps in two segments. Assert the analysis timeline contains that word once, while two identical words at different timestamps remain two records.

~~~powershell
pytest -q tests/test_transcript_windows.py
~~~

Expected: PASS.

- [ ] **Step 5: Commit the timeline contract.**

Run GitNexus detect_changes with scope "all". Verify only transcript_windows.py and tests/test_transcript_windows.py are affected.

~~~powershell
git add transcript_windows.py tests/test_transcript_windows.py
git commit -m "feat: add canonical analysis transcript timeline"
~~~

## Task 2: Implement lossless, overlapping analysis-window packing

**Files:**

- Modify: transcript_windows.py
- Test: tests/test_transcript_windows.py

Use the canonical timeline returned by build_analysis_timeline from Task 1. The window planner must consume that timeline, not the raw transcript, and the compact payload must preserve complete segments plus the separate word array.

- [ ] **Step 1: Add failing tests for overlap, boundary inclusion, and whole-unit packing.**

Append:

~~~python
from transcript_windows import build_analysis_timeline, build_analysis_windows, compact_timeline_for_prompt


def _timeline_transcript(duration=240.0):
    return {
        "segments": [
            {
                "start": float(index * 10),
                "end": float(index * 10 + 9),
                "text": f"segment {index}",
                "words": [
                    {
                        "word": f"segment-{index}",
                        "start": float(index * 10),
                        "end": float(index * 10 + 9),
                    }
                ],
            }
            for index in range(int(duration // 10))
        ]
    }


def test_analysis_windows_have_contiguous_cores_and_sixty_one_seconds_of_context():
    windows = build_analysis_windows(
        build_analysis_timeline(_timeline_transcript(), 240.0),
        240.0,
        max_prompt_chars=32000,
        prompt_overhead_chars=4000,
        overlap_seconds=61.0,
    )

    assert windows[0]["core_start"] == 0.0
    assert windows[-1]["core_end"] == 240.0
    for previous, current in zip(windows, windows[1:]):
        assert previous["core_end"] == current["core_start"]
        assert previous["context_end"] >= current["core_start"] + 61.0
        assert current["context_start"] <= previous["core_end"] - 61.0


def test_compact_timeline_for_prompt_preserves_segments_and_words():
    timeline = build_analysis_timeline(_timeline_transcript(20.0), 20.0)

    payload = compact_timeline_for_prompt(
        timeline,
        context_start=0.0,
        context_end=20.0,
    )

    assert payload["timestamp_mode"] == "word"
    assert payload["segments"]
    assert payload["words"]
    assert payload["words"][0][1:3] == [0.0, 9.0]
~~~

Add a boundary test that selects a candidate interval crossing a core boundary and asserts one window contains all units from its start through end. Also iterate over every generated core boundary and candidate start in the preceding 61 seconds, construct an interval ending at start + 60 seconds, and assert that one window contains both endpoints and every intersecting transcript unit. This is the actual no-boundary-loss property; a generic context-overlap assertion is not sufficient.

- [ ] **Step 2: Run the tests to verify the window behavior fails.**

~~~powershell
pytest -q tests/test_transcript_windows.py
~~~

Expected: FAIL because the window builder and compact serializer are not implemented.

- [ ] **Step 3: Implement the window planner.**

Define the planner as:

~~~python
def build_analysis_windows(
    timeline: Mapping[str, Any],
    video_duration: float,
    *,
    max_prompt_chars: int,
    prompt_overhead_chars: int,
    core_seconds: float = 90.0,
    overlap_seconds: float = 61.0,
) -> list[dict[str, Any]]:
    """Return gap-free core ranges with complete overlapping context."""
~~~

Call compact_timeline_for_prompt for the records in each context range. The planner returns core/context metadata plus the selected compact segment and word records.

Use these constants and rules:

~~~python
MAX_CLIP_DURATION_SECONDS = 60.0
DEFAULT_ANALYSIS_OVERLAP_SECONDS = 61.0
DEFAULT_CORE_SECONDS = 90.0
~~~

For each contiguous core range [core_start, core_end):

~~~text
context_start = max(0, core_start - overlap_seconds)
context_end   = min(video_duration, core_end + overlap_seconds)
units         = every unit intersecting [context_start, context_end]
~~~

Grow the core only at unit boundaries while the complete compact JSON payload remains within the available max_prompt_chars budget after prompt_overhead_chars is reserved. Always advance by at least one second or one valid unit so silent/malformed gaps cannot create an infinite loop.

The implementation must:

- Measure the complete window payload, including metadata and units, not only the unit array.
- Keep every source-time interval in exactly one core range.
- Keep every unit in at least one context window.
- Never split a word or segment record to satisfy the budget.
- Use compact arrays before considering an error.
- Raise ValueError("lossless timestamped transcript window exceeds the prompt budget") if even the minimum lossless context cannot fit. Do not silently remove timestamps or text.

- [ ] **Step 4: Add an impossible-budget regression test and run the tests.**

~~~python
import pytest


def test_analysis_windows_fail_instead_of_dropping_lossless_context():
    with pytest.raises(ValueError, match="lossless timestamped transcript window exceeds"):
        build_analysis_windows(
            build_analysis_timeline(_timeline_transcript(120.0), 120.0),
            120.0,
            max_prompt_chars=100,
            prompt_overhead_chars=90,
            overlap_seconds=61.0,
        )
~~~

Run:

~~~powershell
pytest -q tests/test_transcript_windows.py
~~~

Expected: PASS.

- [ ] **Step 5: Commit the window planner.**

Run GitNexus detect_changes with scope "all"; expected files are transcript_windows.py and tests/test_transcript_windows.py.

~~~powershell
git add transcript_windows.py tests/test_transcript_windows.py
git commit -m "feat: build lossless overlapping transcript windows"
~~~

## Task 3: Resolve canonical bounds and deduplicate model candidates

**Files:**

- Modify: transcript_windows.py
- Test: tests/test_transcript_windows.py

- [ ] **Step 1: Add failing tests for ID-backed precision and ownership.**

Define the resolver contract:

~~~python
def resolve_candidate_bounds(
    candidate: Mapping[str, Any],
    indexed_units: Mapping[tuple[str, int], Mapping[str, Any]],
    video_duration: float,
    *,
    timestamp_mode: str,
    core_start: float | None = None,
    core_end: float | None = None,
) -> dict[str, Any] | None:
    """Validate ownership and derive canonical absolute bounds."""


def dedupe_clip_candidates(
    candidates: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """Remove exact and near-identical overlap results."""
~~~

Add tests that return incorrect model floats alongside valid IDs and assert canonical timestamps win. Add tests that reject unknown IDs, reversed IDs, candidates outside the 15–60 second range, and IDs whose start is outside the current core. Add a segment-mode test that resolves segment IDs without claiming word precision.

- [ ] **Step 2: Run the new tests and verify they fail.**

~~~powershell
pytest -q tests/test_transcript_windows.py
~~~

Expected: FAIL because candidate resolution and deduplication are not implemented.

- [ ] **Step 3: Implement canonical resolution and global deduplication.**

When valid word IDs or segment IDs are present:

- Derive start from the start unit and end from the end unit.
- Ignore model float drift and set bounds_source to canonical_unit.
- Validate source bounds, unit ordering, core ownership, score, and the existing 15–60 second duration contract.
- For numeric-only legacy candidates, require the float start to lie in the owning core and set bounds_source to model_float.
- Collapse identical unit-ID pairs.
- Collapse candidates with IoU at least 0.75 and boundary differences no greater than three seconds, retaining the highest score.
- Preserve materially different overlapping candidates for final global selection.

- [ ] **Step 4: Run the shared tests.**

~~~powershell
pytest -q tests/test_transcript_windows.py
~~~

Expected: PASS.

- [ ] **Step 5: Commit candidate handling.**

Run GitNexus detect_changes with scope "all", then commit:

~~~powershell
git add transcript_windows.py tests/test_transcript_windows.py
git commit -m "feat: resolve and deduplicate timestamped clip candidates"
~~~

## Task 4: Update the clip-analysis prompt and get_viral_clips

**Files:**

- Modify: main.py:139-185
- Modify: main.py:2358-2577
- Test: tests/test_clip_analysis_prompt.py

- [ ] **Step 1: Add failing prompt-contract and candidate-ownership tests.**

Update the fake model response to include unit IDs and add assertions equivalent to:

~~~python
def test_get_viral_clips_sends_absolute_word_units_and_core_metadata(monkeypatch):
    prompts = []
    monkeypatch.setattr(main, "load_ai_config", lambda: _config())

    def fake_chat_json(_config, prompt, **_kwargs):
        prompts.append(prompt)
        return {
            "shorts": [{
                "start_word_id": 5,
                "end_word_id": 8,
                "start": 0.0,
                "end": 0.0,
                "score": 0.9,
            }]
        }

    monkeypatch.setattr(main, "chat_json", fake_chat_json)
    transcript = {
        "segments": [
            {
                "start": index * 10,
                "end": index * 10 + 9,
                "text": f"segment {index}",
                "words": [{
                    "word": f"segment-{index}",
                    "start": index * 10,
                    "end": index * 10 + 9,
                }],
            }
            for index in range(24)
        ]
    }

    result = main.get_viral_clips(transcript, 240.0, target_clips=2)

    assert prompts
    assert all("core_start" in prompt for prompt in prompts)
    assert all("timestamp_mode" in prompt for prompt in prompts)
    assert result["shorts"][0]["start"] == 50.0
    assert result["shorts"][0]["end"] == 89.0


def test_get_viral_clips_collects_candidates_before_applying_final_target(monkeypatch):
    prompts = []
    monkeypatch.setattr(main, "load_ai_config", lambda: _config())

    def fake_chat_json(_config, prompt, **_kwargs):
        prompts.append(prompt)
        return {
            "shorts": [
                {"start": 20.0, "end": 35.0, "score": 0.80},
                {"start": 40.0, "end": 58.0, "score": 0.79},
            ]
        }

    monkeypatch.setattr(main, "chat_json", fake_chat_json)
    result = main.get_viral_clips(
        _long_timestamped_transcript(),
        240.0,
        target_clips=2,
    )

    assert len(prompts) > 1
    assert result["shorts"]
~~~

Define _long_timestamped_transcript() using 24 ten-second timestamped segments so the fixture exceeds one analysis payload.

- [ ] **Step 2: Run the focused clip tests and confirm the new contract fails.**

~~~powershell
pytest -q tests/test_clip_analysis_prompt.py
~~~

Expected: FAIL because the current prompt has no window metadata/word units and the current implementation does not resolve unit IDs.

- [ ] **Step 3: Replace the clip prompt contract.**

Retain the existing viral-clip quality rules, but replace the transcript section with:

~~~text
WINDOW_METADATA:
{window_metadata}

TIMESTAMPED_TRANSCRIPT:
Segments are [SEGMENT_ID, ABSOLUTE_START_SECONDS, ABSOLUTE_END_SECONDS, COMPLETE_TEXT, WORD_IDS].
Words are [WORD_ID, ABSOLUTE_START_SECONDS, ABSOLUTE_END_SECONDS, TEXT].
The window includes context for comprehension, but only return candidates whose
start_word_id belongs to CORE_START <= start < CORE_END. For segment-only data,
use start_segment_id instead. The end may be in right-side context. Return every
strong candidate in this window, up to MAX_CANDIDATES_PER_WINDOW.
TARGET_CLIP_COUNT is the final global count and must not limit discovery here.
{timestamped_transcript}
~~~

Require every candidate to include:

~~~json
{
  "start_word_id": 981,
  "end_word_id": 1042,
  "start": 180.120,
  "end": 239.880,
  "score": 0.92
}
~~~

State explicitly that the backend overwrites start and end from the unit IDs, so the model must select boundary units rather than invent decimal timestamps.

- [ ] **Step 4: Replace _clip_analysis_chunks with shared-window calls.**

Import build_analysis_timeline, build_analysis_windows, compact_timeline_for_prompt, timeline_units_by_id, resolve_candidate_bounds, and dedupe_clip_candidates from transcript_windows.py.

The new get_viral_clips flow must:

1. Build the canonical analysis timeline and timeline_units_by_id once.
2. Build windows using the prompt budget minus a conservative allowance for prompt text and source context.
3. Serialize each window with absolute core/context ranges and compact units.
4. Use a generous fixed MAX_CANDIDATES_PER_WINDOW = 12, independent of target_clips. If a response returns exactly 12 candidates, issue one continuation request asking for additional candidates with new unit-ID pairs and record the window as saturated.
5. Call chat_json once per window and collect all valid shorts, including the existing alternate response keys.
6. Resolve ID-backed candidates before global ranking; retain float fallback for older models.
7. Deduplicate with dedupe_clip_candidates.
8. Sort by score, apply final target_clips limit, then run existing LM Studio stretching and _snap_clip_boundaries compatibility logic.
9. Return the same top-level response shape and existing transcript fallback if no usable candidates remain.

Remove the old per_chunk_target calculation. Retry an exception or malformed response once per window. Track planned, started, retried, succeeded, saturated, and failed states. After retries, compare successful core ranges with the source duration; missing ranges make the result incomplete and must be included in fallback metadata/logs.

Use a generous fixed MAX_CANDIDATES_PER_WINDOW = 12, independent of target_clips. If a response returns exactly 12 candidates, issue one continuation request with the same window and a list of already-returned unit-ID pairs, asking only for additional candidates. Log each window’s core range, context range, unit count, prompt character count, attempt, saturation state, and candidate count.

For canonical-unit candidates, do not run broad _snap_clip_boundaries after ID resolution. For LM Studio duration stretching, expand to neighboring canonical word boundaries and update the selected IDs; use the existing snap helper only for numeric-only legacy candidates.

Keep _clip_analysis_chunks as a thin compatibility wrapper around the shared planner until all callers are migrated. It must return the new window dictionaries, including core/context metadata, rather than the old list of bare segments; update its direct test accordingly.

- [ ] **Step 5: Run clip and focused regression tests.**

~~~powershell
pytest -q tests/test_clip_analysis_prompt.py
pytest -q tests/test_clip_analysis_prompt.py tests/test_highlight_generation.py
~~~

Expected: PASS, including prompt-size and boundary-snapping tests.

- [ ] **Step 6: Commit the clip-generator integration.**

Run GitNexus detect_changes with scope "all". Expected implementation changes are limited to main.py, the shared utility, and the clip tests.

~~~powershell
git add main.py tests/test_clip_analysis_prompt.py transcript_windows.py
git commit -m "feat: analyze clips with overlapping word-timestamp windows"
~~~

## Task 5: Preserve the public transcript merge and validate the first migration

**Files:**

- Do not modify: highlight_generation.py:62-92 or highlight_generation.py:159-205 in this phase.
- Test: tests/test_highlight_generation.py

- [ ] **Step 1: Keep public transcript behavior covered.**

Retain the existing duplicate-segment and OpenRouter transcription tests. Add one assertion that the analysis-only timeline deduplicates repeated word IDs without changing the public transcript returned by merge_transcript_segments.

- [ ] **Step 2: Run the existing transcription regression suite.**

~~~powershell
pytest -q tests/test_highlight_generation.py
~~~

Expected: PASS. A failure here blocks the next migration phase; do not repair it by changing public transcript merging as part of this feature.

- [ ] **Step 3: Commit only test coverage if it changed.**

Run GitNexus detect_changes with scope "all". Expected production symbol changes: none.

~~~powershell
git add tests/test_highlight_generation.py
git commit -m "test: protect public transcript merge behavior"
~~~

## Task 6: Update long-form highlight analysis to use the same contract

**Files:**

- Modify: highlight_generation.py:18-44
- Modify: highlight_generation.py:209-345
- Test: tests/test_highlight_generation.py

- [ ] **Step 1: Add failing tests for word-unit prompts and boundary ownership.**

Rename test_analysis_chunks_use_timestamped_segments_without_word_data to test_analysis_windows_preserve_word_data and update it to assert complete segments plus compact word timestamps instead of asserting that all word data is removed. Add:

~~~python
def test_rank_highlights_uses_overlapping_word_windows_and_resolves_bounds(monkeypatch):
    config = Mock(
        normalized_provider=lambda: "ollama",
        analyze_model="qwen",
        is_gemini=lambda: False,
    )
    monkeypatch.setattr(
        highlight_generation,
        "load_ai_config",
        lambda _headers=None: config,
    )
    prompts = []

    def fake_chat_json(_config, prompt, **_kwargs):
        prompts.append(prompt)
        return {
            "highlights": [{
                "start_word_id": 2,
                "end_word_id": 5,
                "start": 0,
                "end": 0,
                "score": 0.91,
                "reason": "boundary-safe candidate",
                "text": "A complete moment",
            }]
        }

    monkeypatch.setattr(highlight_generation, "chat_json", fake_chat_json)

    result = highlight_generation.rank_highlights(
        _long_timestamped_transcript(),
        240.0,
    )

    assert len(prompts) > 1
    assert all("core_start" in prompt for prompt in prompts)
    assert result["candidates"][0]["start"] == 20.0
    assert result["candidates"][0]["end"] == 59.0
~~~

- [ ] **Step 2: Run the focused tests and confirm the old implementation fails.**

~~~powershell
pytest -q tests/test_highlight_generation.py -k "analysis_chunks or overlapping_word_windows"
~~~

Expected: FAIL because _analysis_chunks currently removes words and returns disjoint payloads.

- [ ] **Step 3: Update HIGHLIGHT_PROMPT with the shared window contract.**

Keep the existing highlight-selection quality rules, but require:

- WINDOW_METADATA containing core_start, core_end, context_start, and context_end.
- Complete segment records plus compact word records [id, absolute_start, absolute_end, text].
- Candidates whose start unit lies in the core range.
- start_word_id and end_word_id on word-mode candidates, or start_segment_id and end_segment_id for segment-mode candidates.
- Up to twelve candidates per window, independent of final reel duration; a saturated response receives one continuation request.
- Absolute seconds in the response, with the explicit instruction that IDs are authoritative.

- [ ] **Step 4: Replace _analysis_chunks and update rank_highlights.**

Use the shared window planner and candidate resolver. Preserve the existing rank_highlights result keys and keep chunks_analyzed equal to the number of windows.

Extend logs with:

~~~text
AI analysis window 1/N core=0.000-90.000 context=0.000-151.000 units=... prompt_chars=...
~~~

Collect candidates from every window, retry failed windows once, resolve canonical bounds, deduplicate them, and only then return the candidates list. Do not apply final reel duration or target selection before global collection. If any core range remains missing, return the existing fallback/error shape with explicit incomplete-coverage metadata rather than silently treating the analysis as complete.

Keep _analysis_chunks as a thin compatibility wrapper around the shared planner if existing tests or worker code still import it. The wrapper must return the new window dictionaries and must not reintroduce a second segment-only chunking implementation.

- [ ] **Step 5: Run the full Python test suite.**

~~~powershell
pytest -q
~~~

Expected: PASS with no regressions in highlight generation, subtitles, AI clients, or worker request handling.

- [ ] **Step 6: Commit the highlight integration.**

Run GitNexus detect_changes with scope "all", review affected handle_request, and commit only intended files.

~~~powershell
git add highlight_generation.py tests/test_highlight_generation.py transcript_windows.py
git commit -m "feat: preserve exact timestamps in highlight analysis"
~~~

## Task 7: Add regression coverage for recall and precision guarantees

**Files:**

- Modify: tests/test_transcript_windows.py
- Modify: tests/test_clip_analysis_prompt.py
- Modify: tests/test_highlight_generation.py

- [ ] **Step 1: Add a synthetic cross-boundary recall test.**

Use a candidate interval whose start is in one core and whose end is up to 60 seconds later. Assert that at least one serialized window contains every unit from its start through its end, even when the interval crosses a core boundary.

- [ ] **Step 2: Add a precision test.**

Return intentionally incorrect float timestamps alongside valid unit IDs. Assert that the resulting candidate uses canonical word start/end rather than the incorrect model floats.

- [ ] **Step 3: Add a global deduplication test.**

Return the same candidate from two overlapping windows with slightly different scores and floats. Assert that exactly one candidate survives and that its canonical bounds and higher score are retained.

- [ ] **Step 4: Add a no-word-data compatibility test.**

Provide only segment timestamps and verify analysis still works, returns segment-level bounds, and does not claim bounds_source == canonical_unit for fabricated word data.

- [ ] **Step 5: Run focused and complete suites.**

~~~powershell
pytest -q tests/test_transcript_windows.py tests/test_clip_analysis_prompt.py tests/test_highlight_generation.py
pytest -q
~~~

Expected: all tests pass.

## Task 8: Final review and live verification

**Files:**

- Modify: only planned Python modules and tests.
- Test: focused and complete Python suites.

- [ ] **Step 1: Verify runtime logs expose coverage information.**

For each analysis request, confirm logs include total windows, current core/context ranges, timestamp mode, unit count, prompt character count, raw candidates, resolved candidates, and post-dedup candidate counts.

- [ ] **Step 2: Run compilation and the full test suite.**

~~~powershell
python -m compileall main.py highlight_generation.py transcript_windows.py
pytest -q
~~~

Expected: compilation succeeds and all tests pass.

- [ ] **Step 3: Review the worktree and GitNexus change scope.**

~~~powershell
git status --short
git diff --check
git diff --stat
~~~

Run GitNexus detect_changes with scope "all" and verify only planned Python modules and tests changed. For regression review, also run detect_changes with scope "compare" and base_ref "main".

- [ ] **Step 4: Commit only after final checks pass.**

~~~powershell
git add transcript_windows.py main.py highlight_generation.py tests/test_transcript_windows.py tests/test_clip_analysis_prompt.py tests/test_highlight_generation.py
git commit -m "feat: make timestamped clip discovery lossless across chunks"
~~~

- [ ] **Step 5: Apply and smoke-test the live local app if implementation is requested.**

Because this plan changes backend/worker Python code, run:

~~~powershell
.\scripts\manage-local.ps1 -Action Restart -Component backend
.\scripts\manage-local.ps1 -Action Status
~~~

Run one short source and one source longer than the analysis prompt budget. Confirm logs show multiple overlapping windows and that a manually known moment crossing a window boundary produces one correctly bounded clip.

## Acceptance criteria

- The model receives absolute timestamped words whenever word timestamps exist.
- Adjacent analysis windows overlap by at least 61 seconds for the current 60-second maximum clip.
- A 15–60 second candidate crossing a window boundary is present in at least one complete model window.
- Final clip bounds are resolved from canonical unit timestamps, not model float drift.
- Duplicate candidates from overlap are collapsed before the final target limit is applied.
- The final target count no longer limits discovery within individual windows.
- Deterministic tests cover every generated boundary and prove every valid 15-60 second interval is represented in at least one window.
- Saturated windows receive one continuation request, and failed windows receive one retry.
- Missing core coverage is surfaced as incomplete rather than reported as a complete analysis.
- Segment-only transcripts continue to work without fabricated word precision.
- Public transcript merging is unchanged in the first implementation.
- Existing OpenRouter transcription, fallback clipping, highlight generation, and public response shapes remain compatible.
- The full Python test suite passes, GitNexus reports only expected changes, and the backend restart succeeds when live verification is requested.
