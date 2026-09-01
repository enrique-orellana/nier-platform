"""Lossless transcript indexing and timestamp-aware analysis windows.

The public transcription shape is intentionally left untouched.  This module
owns the analysis representation used when a model must discover clips from a
long transcript without losing absolute timing or complete segment context.
"""

from __future__ import annotations

import json
import math
import re
from collections.abc import Mapping, Sequence
from typing import Any


_WHITESPACE_RE = re.compile(r"\s+")


def _number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return number


def _text(value: Any) -> str:
    return _WHITESPACE_RE.sub(" ", str(value or "")).strip()


def _field(item: Mapping[str, Any], *names: str) -> Any:
    for name in names:
        if name in item:
            return item[name]
    return None


def _range(item: Mapping[str, Any], origin: float, duration: float) -> tuple[float, float] | None:
    start = _number(_field(item, "start", "start_seconds", "start_time", "s"))
    end = _number(_field(item, "end", "end_seconds", "end_time", "e"))
    if start is None or end is None:
        return None
    start += origin
    end += origin
    if start < 0 or end <= start or end > duration:
        return None
    return round(start, 3), round(end, 3)


def build_analysis_timeline(
    transcript: Mapping[str, Any] | None,
    video_duration: float,
    *,
    time_origin_seconds: float = 0.0,
) -> dict[str, Any]:
    """Build a canonical, absolute-time analysis index.

    Segment text is kept intact.  Words are deduplicated only in this analysis
    index, using text and absolute bounds so overlapping transcription chunks
    cannot duplicate candidate units.  Invalid units are ignored rather than
    inventing timestamps.
    """

    duration = _number(video_duration) or 0.0
    duration = max(0.0, duration)
    origin = _number(time_origin_seconds) or 0.0
    source_segments = []
    if isinstance(transcript, Mapping):
        raw_segments = transcript.get("segments") or []
    else:
        raw_segments = []

    for order, raw_segment in enumerate(raw_segments):
        if not isinstance(raw_segment, Mapping):
            continue
        bounds = _range(raw_segment, origin, duration)
        if bounds is None:
            continue
        start, end = bounds
        segment_text = _text(_field(raw_segment, "text", "content"))
        raw_words = raw_segment.get("words") or []
        words = []
        if isinstance(raw_words, Sequence) and not isinstance(raw_words, (str, bytes)):
            for word_order, raw_word in enumerate(raw_words):
                if not isinstance(raw_word, Mapping):
                    continue
                word_bounds = _range(raw_word, origin, duration)
                word_text = _text(_field(raw_word, "word", "text", "content"))
                if word_bounds is None or not word_text:
                    continue
                words.append(
                    {
                        "start": word_bounds[0],
                        "end": word_bounds[1],
                        "text": word_text,
                        "order": word_order,
                    }
                )
        if not segment_text and words:
            segment_text = " ".join(word["text"] for word in words)
        if not segment_text:
            continue
        source_segments.append(
            {
                "start": start,
                "end": end,
                "text": segment_text,
                "words": words,
                "order": order,
            }
        )

    source_segments.sort(key=lambda item: (item["start"], item["end"], item["order"]))
    unique_words: dict[tuple[str, float, float], dict[str, Any]] = {}
    for segment in source_segments:
        segment["word_keys"] = []
        for word in segment["words"]:
            key = (
                word["text"].casefold(),
                round(word["start"], 3),
                round(word["end"], 3),
            )
            if key not in unique_words:
                unique_words[key] = {
                    "start": word["start"],
                    "end": word["end"],
                    "text": word["text"],
                    "order": len(unique_words),
                }
            segment["word_keys"].append(key)

    ordered_words = sorted(
        unique_words.values(),
        key=lambda item: (item["start"], item["end"], item["order"]),
    )
    word_ids_by_key = {
        (word["text"].casefold(), round(word["start"], 3), round(word["end"], 3)): word_id
        for word_id, word in enumerate(ordered_words)
    }

    words = [
        [word_id, round(word["start"], 3), round(word["end"], 3), word["text"]]
        for word_id, word in enumerate(ordered_words)
    ]
    segments = []
    for segment_id, segment in enumerate(source_segments):
        word_ids = [word_ids_by_key[key] for key in segment["word_keys"]]
        segments.append(
            [
                segment_id,
                round(segment["start"], 3),
                round(segment["end"], 3),
                segment["text"],
                list(dict.fromkeys(word_ids)),
            ]
        )

    return {
        "timestamp_mode": "word" if words else "segment",
        "segments": segments,
        "words": words,
    }


def _intersects(start: float, end: float, range_start: float, range_end: float) -> bool:
    return end > range_start and start < range_end


def compact_timeline_for_prompt(
    timeline: Mapping[str, Any],
    context_start: float,
    context_end: float,
) -> dict[str, Any]:
    """Serialize selected canonical units in the compact prompt contract."""

    selected_segments = []
    selected_word_ids: set[int] = set()
    word_by_id = {int(word[0]): word for word in timeline.get("words", [])}
    for segment in timeline.get("segments", []):
        if not _intersects(segment[1], segment[2], context_start, context_end):
            continue
        word_ids = []
        for word_id in segment[4]:
            word = word_by_id.get(int(word_id))
            if word and _intersects(word[1], word[2], context_start, context_end):
                word_ids.append(word_id)
                selected_word_ids.add(word_id)
        selected_segments.append(
            [
                segment[0],
                segment[1],
                segment[2],
                segment[3],
                word_ids,
            ]
        )

    selected_words = [
        word
        for word in timeline.get("words", [])
        if int(word[0]) in selected_word_ids
    ]
    return {
        "timestamp_mode": timeline.get("timestamp_mode", "segment"),
        "range": [context_start, context_end],
        "segments": selected_segments,
        "words": selected_words,
    }


def _payload_size(payload: Mapping[str, Any]) -> int:
    return len(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))


def build_analysis_windows(
    timeline: Mapping[str, Any],
    video_duration: float,
    *,
    core_seconds: float = 90.0,
    overlap_seconds: float = 61.0,
    max_prompt_chars: int = 32_000,
    prompt_overhead_chars: int = 0,
) -> list[dict[str, Any]]:
    """Create gap-free core ranges with overlapping complete-context ranges."""

    duration = max(0.0, _number(video_duration) or 0.0)
    core_size = _number(core_seconds) or 0.0
    overlap = _number(overlap_seconds) or 0.0
    if duration == 0:
        return []
    if core_size <= 0:
        raise ValueError("core_seconds must be positive")
    if overlap < 60:
        raise ValueError("overlap_seconds must cover the maximum 60-second clip")
    available_chars = int(max_prompt_chars) - int(prompt_overhead_chars)
    if available_chars <= 0:
        raise ValueError("prompt overhead leaves no room for transcript data")

    windows = []
    core_start = 0.0
    while core_start < duration - 1e-9:
        desired_end = min(duration, core_start + core_size)
        candidate_ends = {desired_end}
        for segment in timeline.get("segments", []):
            end = _number(segment[2])
            if end is not None and core_start < end <= desired_end + 1e-9:
                candidate_ends.add(end)
        fitting_ends = []
        for candidate_end in sorted(candidate_ends):
            if candidate_end <= core_start + 1e-9:
                continue
            context_start = max(0.0, core_start - overlap)
            context_end = min(duration, candidate_end + overlap)
            payload = compact_timeline_for_prompt(timeline, context_start, context_end)
            if _payload_size(payload) <= available_chars:
                fitting_ends.append((candidate_end, context_start, context_end, payload))
        if not fitting_ends:
            raise ValueError(
                f"timestamped transcript context at {core_start:.3f}s exceeds prompt budget"
            )
        core_end, context_start, context_end, payload = fitting_ends[-1]
        windows.append(
            {
                "core_start": core_start,
                "core_end": core_end,
                "context_start": context_start,
                "context_end": context_end,
                "transcript": payload,
            }
        )
        if core_end <= core_start:
            raise ValueError("analysis window planner failed to advance")
        core_start = core_end

    return windows


def timeline_units_by_id(timeline: Mapping[str, Any]) -> dict[tuple[str, int], dict[str, Any]]:
    """Index canonical word and segment IDs for candidate resolution."""

    units = {}
    for segment in timeline.get("segments", []):
        units[("segment", int(segment[0]))] = {
            "id": int(segment[0]),
            "start": segment[1],
            "end": segment[2],
            "text": segment[3],
            "word_ids": list(segment[4]),
        }
    for word in timeline.get("words", []):
        units[("word", int(word[0]))] = {
            "id": int(word[0]),
            "start": word[1],
            "end": word[2],
            "text": word[3],
        }
    return units


def _candidate_id(candidate: Mapping[str, Any], *names: str) -> int | None:
    value = _field(candidate, *names)
    if isinstance(value, bool):
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(numeric) or not numeric.is_integer():
        return None
    return int(numeric)


def resolve_candidate_bounds(
    candidate: Mapping[str, Any],
    indexed_units: Mapping[tuple[str, int], Mapping[str, Any]],
    video_duration: float,
    *,
    timestamp_mode: str = "word",
    core_start: float | None = None,
    core_end: float | None = None,
    min_seconds: float = 15.0,
    max_seconds: float = 60.0,
) -> dict[str, Any] | None:
    """Resolve canonical IDs, or validate a legacy float candidate."""

    start_word_id = _candidate_id(candidate, "start_word_id", "startWordId")
    end_word_id = _candidate_id(candidate, "end_word_id", "endWordId")
    start_segment_id = _candidate_id(candidate, "start_segment_id", "startSegmentId")
    end_segment_id = _candidate_id(candidate, "end_segment_id", "endSegmentId")

    unit_type = None
    start_id = end_id = None
    if start_word_id is not None and end_word_id is not None:
        unit_type, start_id, end_id = "word", start_word_id, end_word_id
    elif start_segment_id is not None and end_segment_id is not None:
        unit_type, start_id, end_id = "segment", start_segment_id, end_segment_id

    resolved = dict(candidate)
    if unit_type is not None:
        start_unit = indexed_units.get((unit_type, start_id))
        end_unit = indexed_units.get((unit_type, end_id))
        if start_unit is None or end_unit is None or start_id > end_id:
            return None
        start = _number(start_unit.get("start"))
        end = _number(end_unit.get("end"))
        bounds_source = "canonical_unit"
    else:
        start = _number(_field(candidate, "start", "start_seconds", "start_time"))
        end = _number(_field(candidate, "end", "end_seconds", "end_time"))
        bounds_source = "model_float"

    if start is None or end is None or end <= start:
        return None
    duration = max(0.0, _number(video_duration) or 0.0)
    if start < 0 or end > duration:
        return None
    min_length = _number(min_seconds) or 0.0
    max_length = _number(max_seconds) or duration
    if end - start < min_length or end - start > max_length:
        return None
    if core_start is not None and start < core_start - 1e-6:
        return None
    if core_end is not None and start >= core_end - 1e-6 and core_end < duration:
        return None

    resolved["start"] = start
    resolved["end"] = end
    resolved["bounds_source"] = bounds_source
    if unit_type is not None:
        resolved["timestamp_unit"] = unit_type
    return resolved


def dedupe_clip_candidates(
    candidates: Sequence[Mapping[str, Any]],
    *,
    iou_threshold: float = 0.75,
    boundary_tolerance_seconds: float = 3.0,
) -> list[dict[str, Any]]:
    """Deduplicate repeated overlap discoveries while retaining best scores."""

    def score(item: Mapping[str, Any]) -> float:
        return _number(item.get("score")) or 0.0

    ordered = sorted((dict(item) for item in candidates), key=score, reverse=True)
    kept: list[dict[str, Any]] = []
    seen_ids: set[tuple[Any, ...]] = set()

    def interval_iou(left: Mapping[str, Any], right: Mapping[str, Any]) -> float:
        left_start, left_end = left["start"], left["end"]
        right_start, right_end = right["start"], right["end"]
        intersection = max(0.0, min(left_end, right_end) - max(left_start, right_start))
        union = max(left_end, right_end) - min(left_start, right_start)
        return intersection / union if union else 0.0

    for candidate in ordered:
        identity = tuple(
            candidate.get(key)
            for key in ("start_word_id", "end_word_id", "start_segment_id", "end_segment_id")
        )
        if any(value is not None for value in identity):
            if identity in seen_ids:
                continue
            seen_ids.add(identity)
        duplicate = False
        for previous in kept:
            if (
                interval_iou(candidate, previous) >= iou_threshold
                and abs(candidate["start"] - previous["start"]) <= boundary_tolerance_seconds
                and abs(candidate["end"] - previous["end"]) <= boundary_tolerance_seconds
            ):
                duplicate = True
                break
        if not duplicate:
            kept.append(candidate)
    return kept
