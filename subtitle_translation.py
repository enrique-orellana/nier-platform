"""Pure subtitle translation and timing helpers."""

from __future__ import annotations

import re
from typing import Callable, Sequence


def _split_words(text: str) -> list[str]:
    return [word for word in re.split(r"\s+", text.strip()) if word]


def _timed_words(text: str, start_ms: int, end_ms: int) -> list[dict]:
    words = _split_words(text)
    if not words:
        return []
    duration = max(1, int(end_ms) - int(start_ms))
    return [
        {
            "text": word,
            "startMs": int(start_ms + (duration * index / len(words))),
            "endMs": int(start_ms + (duration * (index + 1) / len(words))),
        }
        for index, word in enumerate(words)
    ]


def map_translation_to_cues(
    source_cues: Sequence[dict], translated_texts: Sequence[str], language: str
) -> list[dict]:
    if len(source_cues) != len(translated_texts):
        raise ValueError("translation cue count does not match source cue count")

    mapped = []
    for source, translated in zip(source_cues, translated_texts):
        start_ms = int(source["startMs"])
        end_ms = int(source["endMs"])
        if end_ms <= start_ms:
            raise ValueError("subtitle cue end must be after start")
        mapped.append(
            {
                "text": translated.strip(),
                "startMs": start_ms,
                "endMs": end_ms,
                "language": language,
                "captions": _timed_words(translated, start_ms, end_ms),
            }
        )
    return mapped


def translate_cue_texts(
    source_cues: Sequence[dict],
    source_language: str,
    target_language: str,
    translate_text: Callable[[Sequence[str], str, str], Sequence[str]],
) -> dict:
    if not target_language or target_language == source_language:
        raise ValueError("target language must differ from source language")
    texts = [str(cue.get("text") or "") for cue in source_cues]
    translated = list(translate_text(texts, source_language, target_language))
    cues = map_translation_to_cues(source_cues, translated, target_language)
    return {
        "id": target_language,
        "language": target_language,
        "label": target_language,
        "origin": "translation",
        "sourceTrackId": "original",
        "cues": cues,
        "captions": [word for cue in cues for word in cue["captions"]],
    }
