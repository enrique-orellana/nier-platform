import json

from transcript_windows import (
    build_analysis_timeline,
    build_analysis_windows,
    compact_timeline_for_prompt,
    dedupe_clip_candidates,
    resolve_candidate_bounds,
    timeline_units_by_id,
)


def _transcript_with_words():
    return {
        "segments": [
            {
                "start": 0,
                "end": 4,
                "text": "Hello world.",
                "words": [
                    {"word": "Hello", "start": 0, "end": 1},
                    {"word": "world", "start": 1, "end": 2},
                ],
            },
            {
                "start": 3.5,
                "end": 8,
                "text": "World again, with complete context.",
                "words": [
                    {"word": "world", "start": 1, "end": 2},
                    {"word": "again", "start": 4, "end": 5},
                    {"word": "with", "start": 5, "end": 6},
                    {"word": "complete", "start": 6, "end": 7},
                    {"word": "context", "start": 7, "end": 8},
                ],
            },
        ]
    }


def test_analysis_timeline_preserves_segments_and_deduplicates_words():
    timeline = build_analysis_timeline(_transcript_with_words(), 10)

    assert timeline["timestamp_mode"] == "word"
    assert [segment[3] for segment in timeline["segments"]] == [
        "Hello world.",
        "World again, with complete context.",
    ]
    assert len(timeline["words"]) == 6
    assert timeline["segments"][0][4]
    assert timeline["segments"][1][4]
    assert len(set(timeline["segments"][0][4])) == 2


def test_analysis_timeline_falls_back_to_complete_segments_without_words():
    timeline = build_analysis_timeline(
        {
            "segments": [
                {"start": 2, "end": 5, "text": "A complete segment."},
                {"start": 5, "end": 8, "text": "Another complete segment."},
            ]
        },
        10,
    )

    assert timeline["timestamp_mode"] == "segment"
    assert timeline["words"] == []
    assert timeline["segments"][0] == [0, 2.0, 5.0, "A complete segment.", []]


def test_analysis_timeline_accepts_s_and_e_aliases_and_rounds_timestamps():
    timeline = build_analysis_timeline(
        {
            "segments": [{
                "s": 5.0004,
                "e": 7.0004,
                "text": "Alias words",
                "words": [
                    {"text": "Alias", "s": 5.1004, "e": 5.6004},
                    {"text": "words", "s": 5.7004, "e": 6.4004},
                ],
            }]
        },
        10,
    )

    assert timeline == {
        "timestamp_mode": "word",
        "segments": [[0, 5.0, 7.0, "Alias words", [0, 1]]],
        "words": [[0, 5.1, 5.6, "Alias"], [1, 5.7, 6.4, "words"]],
    }


def test_compact_prompt_payload_keeps_complete_segments_and_words():
    timeline = build_analysis_timeline(_transcript_with_words(), 10)

    payload = compact_timeline_for_prompt(timeline, 0, 8)
    encoded = json.dumps(payload, ensure_ascii=False)

    assert payload["segments"][0][3] == "Hello world."
    assert payload["segments"][1][3] == "World again, with complete context."
    assert all(len(word) == 4 for word in payload["words"])
    assert "complete context" in encoded


def test_analysis_windows_are_gap_free_and_cover_maximum_clip_intervals():
    transcript = {
        "segments": [
            {"start": index, "end": index + 1, "text": f"word {index}"}
            for index in range(240)
        ]
    }
    timeline = build_analysis_timeline(transcript, 240)
    windows = build_analysis_windows(
        timeline,
        240,
        core_seconds=90,
        overlap_seconds=61,
        max_prompt_chars=20_000,
        prompt_overhead_chars=500,
    )

    assert windows[0]["core_start"] == 0
    assert windows[-1]["core_end"] == 240
    assert all(
        current["core_end"] == following["core_start"]
        for current, following in zip(windows, windows[1:])
    )
    assert all(window["context_end"] - window["context_start"] >= 61 for window in windows[:-1])

    for window in windows:
        candidate_start = window["core_start"]
        candidate_end = min(candidate_start + 60, 240)
        assert window["context_start"] <= candidate_start
        assert window["context_end"] >= candidate_end

    boundaries = [window["core_start"] for window in windows[1:]]
    for boundary in boundaries:
        for offset in range(61):
            candidate_start = boundary - 61 + offset
            candidate_end = candidate_start + 60
            assert any(
                window["context_start"] <= candidate_start
                and window["context_end"] >= candidate_end
                for window in windows
            )


def test_resolve_candidate_bounds_prefers_canonical_word_ids_and_tracks_float_fallback():
    timeline = build_analysis_timeline(
        {
            "segments": [
                {
                    "start": 10,
                    "end": 50,
                    "text": "A long candidate with exact word bounds.",
                    "words": [
                        {"word": "A", "start": 10, "end": 20},
                        {"word": "long", "start": 20, "end": 30},
                        {"word": "candidate", "start": 30, "end": 40},
                        {"word": "bounds", "start": 40, "end": 50},
                    ],
                }
            ]
        },
        60,
    )
    indexed = timeline_units_by_id(timeline)

    canonical = resolve_candidate_bounds(
        {"start_word_id": 0, "end_word_id": 3, "score": 0.9},
        indexed,
        60,
        core_start=0,
        core_end=60,
    )
    legacy = resolve_candidate_bounds(
        {"start": 11, "end": 49, "score": 0.5},
        indexed,
        60,
        core_start=0,
        core_end=60,
    )

    assert canonical["start"] == 10
    assert canonical["end"] == 50
    assert canonical["bounds_source"] == "canonical_unit"
    assert legacy["bounds_source"] == "model_float"


def test_dedupe_clip_candidates_keeps_best_overlap_and_distinct_moments():
    candidates = dedupe_clip_candidates(
        [
            {"start": 10, "end": 40, "score": 0.6, "start_word_id": 1, "end_word_id": 4},
            {"start": 11, "end": 41, "score": 0.9, "start_word_id": 2, "end_word_id": 5},
            {"start": 100, "end": 130, "score": 0.7},
        ]
    )

    assert [(item["start"], item["score"]) for item in candidates] == [
        (0 + 11, 0.9),
        (100, 0.7),
    ]
