import pytest

from highlight_selection import normalize_target, select_segments


def candidate(start, end, score, text="moment"):
    return {
        "start": start,
        "end": end,
        "score": score,
        "reason": "strong moment",
        "text": text,
    }


def test_normalize_target_defaults_to_twelve_minimum_and_twenty_ideal():
    target = normalize_target(1800, None, None)
    assert target == {
        "min_seconds": 720,
        "ideal_seconds": 1200,
        "source_duration_seconds": 1800,
    }


def test_normalize_target_caps_ideal_at_source_duration():
    target = normalize_target(900, 12, 20)
    assert target["min_seconds"] == 720
    assert target["ideal_seconds"] == 900


def test_normalize_target_rejects_reversed_durations():
    with pytest.raises(ValueError, match="at least"):
        normalize_target(1800, 20, 12)


def test_select_segments_prefers_score_and_restores_source_order():
    selection = select_segments(
        [
            candidate(1200, 1500, 0.98, "third"),
            candidate(0, 300, 0.95, "first"),
            candidate(600, 900, 0.90, "second"),
            candidate(10, 250, 0.94, "overlap"),
        ],
        min_seconds=720,
        ideal_seconds=1200,
        source_duration_seconds=1800,
    )
    assert selection["duration_seconds"] == 900
    assert [item["text"] for item in selection["segments"]] == ["first", "second", "third"]
    assert selection["reached_minimum"] is True


def test_select_segments_does_not_fill_minimum_with_weak_candidates():
    selection = select_segments(
        [candidate(0, 60, 0.1)],
        min_seconds=720,
        ideal_seconds=1200,
        source_duration_seconds=1800,
    )
    assert selection["reached_minimum"] is False
    assert selection["warnings"]
