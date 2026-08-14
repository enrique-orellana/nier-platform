"""LEGACY subtitle translation worker retained for compatibility."""

from __future__ import annotations

import json
from typing import Any, Mapping

from ai_client import chat_json, load_ai_config
from subtitle_translation import translate_cue_texts


def _ai_headers(request_headers: Mapping[str, str]) -> dict[str, str]:
    allowed = {
        "x-ai-provider": "X-AI-Provider",
        "x-ai-api-key": "X-AI-Api-Key",
        "x-gemini-key": "X-Gemini-Key",
        "x-ai-base-url": "X-AI-Base-Url",
        "x-ai-model": "X-AI-Model",
        "x-ai-analyze-model": "X-AI-Analyze-Model",
        "x-ai-vision-model": "X-AI-Vision-Model",
        "x-ai-image-model": "X-AI-Image-Model",
        "x-ai-reasoning-effort": "X-AI-Reasoning-Effort",
        "x-ai-analyze-reasoning-effort": "X-AI-Analyze-Reasoning-Effort",
        "x-ai-vision-reasoning-effort": "X-AI-Vision-Reasoning-Effort",
    }
    return {
        allowed[key.lower()]: value
        for key, value in request_headers.items()
        if key.lower() in allowed and value
    }


def perform_translation(
    request: Mapping[str, Any], request_headers: Mapping[str, str]
) -> dict[str, Any]:
    target_language = str(request.get("target_language") or "").strip().lower()
    source_track_id = str(request.get("source_track_id") or "original")
    tracks = list(request.get("tracks") or [])
    source_track = next(
        (track for track in tracks if track.get("id") == source_track_id), None
    )
    if source_track is None:
        raise ValueError("Source subtitle track not found")

    source_language = str(source_track.get("language") or "").strip().lower()
    if not target_language or target_language == source_language:
        raise ValueError("Target language must differ from source language")
    if any(str(track.get("language") or "").lower() == target_language for track in tracks):
        raise ValueError("Subtitle track for target language already exists")

    source_cues = source_track.get("cues") or source_track.get("captions") or []
    if not source_cues:
        raise ValueError("Source subtitle track has no cues")

    ai_config = load_ai_config(_ai_headers(request_headers))
    if ai_config.is_gemini() and not ai_config.api_key:
        raise ValueError("Missing AI API key for subtitle translation")

    prompt = (
        "Translate each subtitle cue into the target language. Preserve array order and return only JSON "
        "with a translations array containing exactly one string per cue. "
        f"Source language: {source_language}. Target language: {target_language}. "
        f"Cues: {json.dumps([cue.get('text', '') for cue in source_cues], ensure_ascii=False)}"
    )
    payload = chat_json(ai_config, prompt, model=ai_config.text_model)
    translated_texts = payload.get("translations") if isinstance(payload, dict) else None
    if not isinstance(translated_texts, list):
        raise ValueError("translation response did not contain a translations array")

    translated_track = translate_cue_texts(
        source_cues,
        source_language,
        target_language,
        lambda _texts, _source, _target: translated_texts,
    )
    translated_track["id"] = target_language
    translated_track["label"] = target_language.upper()
    translated_track["sourceTrackId"] = source_track_id
    return translated_track
