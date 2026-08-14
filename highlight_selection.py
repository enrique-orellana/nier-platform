"""Target normalization and quality-aware long-form highlight selection."""

from __future__ import annotations

import math
from typing import Any


DEFAULT_MIN_MINUTES = 12
DEFAULT_IDEAL_MINUTES = 20
MAX_MINUTES = 180
MAX_CANDIDATE_SECONDS = 300


def normalize_target(
    source_duration_seconds: float,
    min_minutes: float | None,
    ideal_minutes: float | None,
) -> dict[str, int]:
    source = float(source_duration_seconds)
    if not math.isfinite(source) or source <= 0:
        raise ValueError("Source duration is invalid")

    minimum = DEFAULT_MIN_MINUTES if min_minutes is None else float(min_minutes)
    ideal = DEFAULT_IDEAL_MINUTES if ideal_minutes is None else float(ideal_minutes)
    if not math.isfinite(minimum) or minimum <= 0 or minimum > MAX_MINUTES:
        raise ValueError(f"Minimum duration must be between 0 and {MAX_MINUTES} minutes")
    if not math.isfinite(ideal) or ideal <= 0 or ideal > MAX_MINUTES:
        raise ValueError(f"Ideal duration must be between 0 and {MAX_MINUTES} minutes")
    if ideal < minimum:
        raise ValueError("Ideal duration must be at least the minimum duration")

    minimum_seconds = min(source, round(minimum * 60))
    ideal_seconds = min(source, max(minimum_seconds, round(ideal * 60)))
    return {
        "min_seconds": int(minimum_seconds),
        "ideal_seconds": int(ideal_seconds),
        "source_duration_seconds": int(round(source)),
    }


def _overlap_ratio(left: dict[str, Any], right: dict[str, Any]) -> float:
    overlap = max(0.0, min(left["end"], right["end"]) - max(left["start"], right["start"]))
    shorter = min(left["end"] - left["start"], right["end"] - right["start"])
    return overlap / shorter if shorter > 0 else 1.0


def _valid_candidate(candidate: Any, source_duration_seconds: float) -> bool:
    if not isinstance(candidate, dict):
        return False
    try:
        start = float(candidate["start"])
        end = float(candidate["end"])
        score = float(candidate["score"])
    except (KeyError, TypeError, ValueError):
        return False
    return (
        math.isfinite(start)
        and math.isfinite(end)
        and math.isfinite(score)
        and 0 <= start < end <= source_duration_seconds
        and end - start <= MAX_CANDIDATE_SECONDS
        and 0 <= score <= 1
    )


def select_segments(
    candidates: list[dict[str, Any]],
    *,
    min_seconds: int,
    ideal_seconds: int,
    source_duration_seconds: float,
) -> dict[str, Any]:
    source = float(source_duration_seconds)
    if not math.isfinite(source) or source <= 0:
        raise ValueError("Source duration is invalid")
    if min_seconds <= 0 or ideal_seconds < min_seconds:
        raise ValueError("Highlight target is invalid")

    ranked = [
        dict(candidate)
        for candidate in candidates
        if _valid_candidate(candidate, source)
    ]
    ranked.sort(key=lambda item: (-float(item["score"]), float(item["start"])))

    selected: list[dict[str, Any]] = []
    duration_seconds = 0
    for candidate in ranked:
        if duration_seconds >= ideal_seconds:
            break
        if any(_overlap_ratio(existing, candidate) >= 0.25 for existing in selected):
            continue
        candidate_duration = float(candidate["end"]) - float(candidate["start"])
        if duration_seconds >= min_seconds and duration_seconds + candidate_duration > ideal_seconds:
            continue
        candidate["start"] = round(float(candidate["start"]), 3)
        candidate["end"] = round(float(candidate["end"]), 3)
        candidate["score"] = round(float(candidate["score"]), 5)
        selected.append(candidate)
        duration_seconds += candidate_duration

    selected.sort(key=lambda item: item["start"])
    warnings: list[str] = []
    reached_minimum = duration_seconds >= min_seconds
    if not reached_minimum:
        warnings.append(
            f"Only {round(duration_seconds)} seconds of strong material were found; "
            f"the {min_seconds}-second minimum was not reached without weak filler."
        )
    return {
        "segments": selected,
        "duration_seconds": int(round(duration_seconds)),
        "reached_minimum": reached_minimum,
        "warnings": warnings,
    }
