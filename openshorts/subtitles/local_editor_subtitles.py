"""Adapters for rendering local-editor subtitle cues with the existing FFmpeg path."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable


def _timestamp(ms: Any) -> str:
    value = max(0, round(float(ms or 0)))
    hours, remainder = divmod(value, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, milliseconds = divmod(remainder, 1_000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{milliseconds:03d}"


def build_local_editor_srt(cues: Iterable[dict[str, Any]]) -> str:
    blocks: list[str] = []
    for index, cue in enumerate(cues, start=1):
        text = str(cue.get("text") or "").replace("\r\n", "\n").replace("\r", "\n").strip()
        if not text:
            continue
        start_ms = max(0, round(float(cue.get("startMs") or 0)))
        end_ms = max(start_ms + 1, round(float(cue.get("endMs") or 0)))
        blocks.append(
            f"{index}\n"
            f"{_timestamp(start_ms)} --> {_timestamp(end_ms)}\n"
            f"{text}\n"
        )
    if not blocks:
        raise ValueError("At least one subtitle cue with text is required.")
    return "\n".join(blocks) + "\n"


def write_local_editor_srt(cues: Iterable[dict[str, Any]], path: str | Path) -> None:
    Path(path).write_text(build_local_editor_srt(cues), encoding="utf-8")


def word_captions_from_transcript(transcript: dict[str, Any] | None) -> list[dict[str, Any]]:
    captions: list[dict[str, Any]] = []
    for segment in (transcript or {}).get("segments", []):
        for word in segment.get("words", []):
            text = str(word.get("word") or word.get("text") or "").strip()
            start_ms = round(float(word.get("start") or 0) * 1000)
            end_ms = round(float(word.get("end") or 0) * 1000)
            if text and end_ms > start_ms:
                captions.append({"text": text, "startMs": start_ms, "endMs": end_ms})
    return captions


def subtitle_style_to_ffmpeg_options(style: dict[str, Any] | None) -> dict[str, Any]:
    source = style or {}
    return {
        "alignment": str(source.get("position") or "bottom"),
        "fontsize": max(10, round(float(source.get("fontSize") or 24))),
        "font_name": str(source.get("fontFamily") or "Verdana"),
        "font_color": str(source.get("fontColor") or "#FFFFFF"),
        "border_color": str(source.get("borderColor") or "#000000"),
        "border_width": max(0, round(float(source.get("borderWidth") or 0))),
        "bg_color": str(source.get("bgColor") or "#000000"),
        "bg_opacity": max(0.0, min(1.0, float(source.get("bgOpacity") or 0))),
    }
