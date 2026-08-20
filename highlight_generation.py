"""AI-ranked long-form highlight generation for the OpenShorts worker."""

from __future__ import annotations

import json
import subprocess
import tempfile
import time
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

from ai_client import chat_json, load_ai_config, transcribe_audio_openrouter
from highlight_selection import normalize_target, select_segments
from media_probe import probe_media


HIGHLIGHT_PROMPT = """
You are an expert long-form video editor. Find the most interesting, self-contained
sections of the supplied video transcript for a coherent highlight reel. Prefer
strong hooks, useful explanations, surprising turns, emotional peaks, clear
payoffs, stories, and moments that make sense without missing context. Exclude
intros, outros, ads, dead air, repeated points, and weak filler.

Return JSON only in this shape:
{{"highlights":[{{"start":0.0,"end":30.0,"score":0.0,"reason":"...","text":"..."}}]}}

Use absolute seconds. Every section must be between 15 and 300 seconds, must be
inside the source duration, and must start/end near natural word boundaries. Rank
the sections by score from 0 to 1. Return enough candidates to reach the target
duration when strong material exists, but do not invent or pad weak sections. If
the source is shorter than the requested target, analyze only the available source.
Return at most 8 candidates. Keep each reason under 160 characters and each text
under 300 characters.

SOURCE_DURATION_SECONDS: {video_duration}
MINIMUM_REEL_SECONDS: {min_seconds}
IDEAL_REEL_SECONDS: {ideal_seconds}
SOURCE_CONTEXT: {source_context}
TRANSCRIPT (JSON array of segments with absolute start/end seconds and text):
{transcript}
""".strip()

MAX_PROMPT_CHARS = 48000
MAX_TRANSCRIPT_CHARS_PER_CHUNK = 24000
HIGHLIGHT_ANALYSIS_TIMEOUT_SECONDS = 120.0
OPENROUTER_TRANSCRIPTION_CHUNK_SECONDS = 300.0
OPENROUTER_TRANSCRIPTION_OVERLAP_SECONDS = 5.0


def _transcript_text(transcript: Mapping[str, Any]) -> str:
    text = str(transcript.get("text") or "").strip()
    if text:
        return text
    return " ".join(str(segment.get("text") or "").strip() for segment in transcript.get("segments", []) if segment.get("text")).strip()


def _normalized_segment_text(text: Any) -> str:
    return " ".join(str(text or "").casefold().split())


def merge_transcript_segments(segments: list[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Keep global ordering while removing duplicate text at chunk boundaries."""
    ordered = sorted(
        (segment for segment in segments if str(segment.get("text") or "").strip()),
        key=lambda segment: (float(segment.get("start", 0.0)), float(segment.get("end", 0.0))),
    )
    merged: list[dict[str, Any]] = []
    for raw_segment in ordered:
        text = str(raw_segment.get("text") or "").strip()
        start = float(raw_segment.get("start", 0.0))
        end = float(raw_segment.get("end", start))
        normalized = _normalized_segment_text(text)
        duplicate = False
        for previous in reversed(merged):
            previous_start = float(previous.get("start", 0.0))
            previous_end = float(previous.get("end", previous_start))
            if start > previous_end + 0.001:
                break
            if normalized == _normalized_segment_text(previous.get("text")):
                duplicate = True
                break
        if duplicate:
            continue
        merged.append({
            **dict(raw_segment),
            "text": text,
            "start": round(start, 3),
            "end": round(max(end, start), 3),
            "words": list(raw_segment.get("words") or []),
        })
    return merged


def plan_transcription_chunks(
    duration_seconds: float,
    *,
    chunk_seconds: float = OPENROUTER_TRANSCRIPTION_CHUNK_SECONDS,
    overlap_seconds: float = OPENROUTER_TRANSCRIPTION_OVERLAP_SECONDS,
) -> list[tuple[float, float]]:
    duration = float(duration_seconds)
    chunk = float(chunk_seconds)
    overlap = float(overlap_seconds)
    if duration <= 0:
        return []
    if chunk <= 0 or overlap < 0 or overlap >= chunk:
        raise ValueError("transcription chunk size must be positive and larger than its overlap")

    chunks: list[tuple[float, float]] = []
    start = 0.0
    while start < duration:
        end = min(duration, start + chunk)
        chunks.append((round(start, 3), round(end, 3)))
        if end >= duration:
            break
        start = end - overlap
    return chunks


def _extract_openrouter_audio_chunk(source_path: Path, start: float, end: float, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    _run_ffmpeg([
        "ffmpeg", "-y", "-ss", f"{start:.3f}", "-i", str(source_path),
        "-t", f"{end - start:.3f}", "-vn", "-ac", "1", "-ar", "16000",
        "-c:a", "libmp3lame", "-b:a", "32k", str(destination),
    ])


def transcribe_video_with_config(
    video_path: str | Path,
    duration_seconds: float,
    emit_log: Callable[[str], None] | None = None,
    *,
    headers: Mapping[str, Any] | None = None,
    start_seconds: float = 0.0,
    end_seconds: float | None = None,
) -> dict[str, Any]:
    """Transcribe through OpenRouter with bounded audio chunks."""
    config = load_ai_config(headers)

    source_duration = max(0.0, float(duration_seconds))
    range_start = max(0.0, min(source_duration, float(start_seconds or 0.0)))
    range_end = source_duration if end_seconds is None else max(
        range_start,
        min(source_duration, float(end_seconds)),
    )
    range_duration = range_end - range_start
    chunks = plan_transcription_chunks(
        range_duration,
        chunk_seconds=OPENROUTER_TRANSCRIPTION_CHUNK_SECONDS,
        overlap_seconds=OPENROUTER_TRANSCRIPTION_OVERLAP_SECONDS,
    )
    if not chunks:
        raise ValueError("source video has no duration")
    segments: list[dict[str, Any]] = []
    language = "und"
    with tempfile.TemporaryDirectory(prefix="openshorts-openrouter-transcription-") as directory:
        directory_path = Path(directory)
        for index, (start, end) in enumerate(chunks, start=1):
            if emit_log:
                emit_log(f"Transcribing chunk {index}/{len(chunks)} with OpenRouter")
            chunk_path = directory_path / f"chunk-{index:04d}.mp3"
            _extract_openrouter_audio_chunk(
                Path(video_path),
                range_start + start,
                range_start + end,
                chunk_path,
            )
            try:
                transcript = transcribe_audio_openrouter(str(chunk_path), config)
            except RuntimeError as exc:
                raise RuntimeError(
                    f"OpenRouter transcription failed for chunk {index}/{len(chunks)} "
                    f"({start:.3f}-{end:.3f}s): {exc}"
                ) from exc
            language = str(transcript.get("language") or language)
            for segment in transcript.get("segments", []):
                segment_start = float(segment.get("start", 0.0))
                segment_end = float(segment.get("end", 0.0))
                if segment_end <= segment_start:
                    segment_end = min(end - start, max(segment_start + 0.1, end - start))
                words = []
                for word in segment.get("words", []) or []:
                    if not isinstance(word, Mapping):
                        continue
                    try:
                        word_start = float(word.get("start"))
                        word_end = float(word.get("end"))
                    except (TypeError, ValueError):
                        continue
                    word_text = str(word.get("word") or word.get("text") or "").strip()
                    if word_text and word_end > word_start:
                        words.append({
                            "word": word_text,
                            "start": round(start + word_start, 3),
                            "end": round(min(range_duration, start + word_end), 3),
                        })
                segments.append({
                    "text": str(segment.get("text") or "").strip(),
                    "start": round(start + segment_start, 3),
                    "end": round(min(range_duration, start + segment_end), 3),
                    "words": words,
                })
            chunk_path.unlink(missing_ok=True)
    segments = merge_transcript_segments(segments)
    return {"text": " ".join(segment["text"] for segment in segments).strip(), "segments": segments, "language": language}


def _analysis_chunks(transcript: Mapping[str, Any]) -> list[dict[str, Any]]:
    compact_segments: list[dict[str, Any]] = []

    def append_text_parts(start: float, end: float, text: str) -> None:
        remaining = str(text or "").strip()
        while remaining:
            low, high = 1, len(remaining)
            best = 1
            while low <= high:
                midpoint = (low + high) // 2
                candidate = {"start": start, "end": end, "text": remaining[:midpoint]}
                if len(json.dumps([candidate], ensure_ascii=False)) <= MAX_TRANSCRIPT_CHARS_PER_CHUNK:
                    best = midpoint
                    low = midpoint + 1
                else:
                    high = midpoint - 1
            compact_segments.append({"start": start, "end": end, "text": remaining[:best]})
            remaining = remaining[best:].lstrip()

    for raw_segment in transcript.get("segments", []) or []:
        text = " ".join(str(raw_segment.get("text") or "").split())
        if not text:
            continue
        try:
            start = round(float(raw_segment.get("start")), 3)
            end = round(float(raw_segment.get("end")), 3)
        except (TypeError, ValueError):
            continue
        if end > start:
            append_text_parts(start, end, text)

    if not compact_segments:
        append_text_parts(0.0, 0.0, _transcript_text(transcript))

    chunks: list[dict[str, Any]] = []
    current: list[dict[str, Any]] = []
    for segment in compact_segments:
        if current and len(json.dumps(current + [segment], ensure_ascii=False)) > MAX_TRANSCRIPT_CHARS_PER_CHUNK:
            chunks.append({"segments": current})
            current = []
        current.append(segment)
    if current:
        chunks.append({"segments": current})
    return chunks or [{"segments": []}]


def rank_highlights(
    transcript: Mapping[str, Any],
    video_duration: float,
    *,
    min_seconds: float | None = None,
    ideal_seconds: float | None = None,
    source_context: Mapping[str, Any] | None = None,
    emit_log: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    target = normalize_target(
        video_duration,
        min_minutes=(float(min_seconds) / 60.0) if min_seconds is not None else None,
        ideal_minutes=(float(ideal_seconds) / 60.0) if ideal_seconds is not None else None,
    )
    prompt_context = dict(source_context or {})
    headers = prompt_context.pop("headers", None)
    config = load_ai_config(headers if isinstance(headers, Mapping) else None)
    if config.is_gemini() and not config.api_key:
        raise ValueError("Gemini API key is not configured")

    model = config.analyze_model or config.text_model or ("gemini-2.5-flash" if config.is_gemini() else "")
    candidates = []
    chunks = _analysis_chunks(transcript)
    provider = config.normalized_provider()
    if emit_log:
        emit_log(
            f"AI analysis provider={provider} model={model or 'auto'}; "
            f"transcript_chunks={len(chunks)}"
        )
    for index, chunk in enumerate(chunks, start=1):
        prompt = HIGHLIGHT_PROMPT.format(
            video_duration=round(float(video_duration), 3),
            min_seconds=target["min_seconds"],
            ideal_seconds=target["ideal_seconds"],
            source_context=json.dumps(prompt_context, ensure_ascii=False),
            transcript=json.dumps(chunk, ensure_ascii=False),
        )
        if len(prompt) > MAX_PROMPT_CHARS:
            raise ValueError("Transcript chunk exceeds the configured AI prompt limit")
        if emit_log:
            emit_log(
                f"AI analysis chunk {index}/{len(chunks)} started; "
                f"prompt_chars={len(prompt)}"
            )
        started_at = time.monotonic()
        try:
            response = chat_json(
                config,
                prompt,
                model=model,
                reasoning_effort=config.analyze_reasoning_effort,
                timeout=HIGHLIGHT_ANALYSIS_TIMEOUT_SECONDS,
            )
        except Exception as exc:
            if emit_log:
                emit_log(
                    f"AI analysis chunk {index}/{len(chunks)} failed after "
                    f"{time.monotonic() - started_at:.1f}s: {type(exc).__name__}: {exc}"
                )
            raise
        raw_candidates = response.get("highlights") if isinstance(response, dict) else None
        if not isinstance(raw_candidates, list):
            raise ValueError("AI returned no highlight candidates")
        if emit_log:
            emit_log(
                f"AI analysis chunk {index}/{len(chunks)} completed in "
                f"{time.monotonic() - started_at:.1f}s; candidates={len(raw_candidates)}"
            )
        for raw in raw_candidates:
            if not isinstance(raw, Mapping):
                continue
            try:
                start = float(raw.get("start"))
                end = float(raw.get("end"))
                score = float(raw.get("score", 0.0))
            except (TypeError, ValueError):
                continue
            candidates.append({
                "start": start,
                "end": end,
                "score": score,
                "reason": str(raw.get("reason") or "").strip(),
                "text": str(raw.get("text") or "").strip(),
            })
    return {
        "method": "ai",
        "provider": config.normalized_provider(),
        "model": model,
        "candidates": candidates,
        "target": target,
        "chunks_analyzed": len(chunks),
    }


def _run_ffmpeg(command: list[str]) -> None:
    subprocess.run(command, check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)


def render_highlight_reel(source_path: Path, segments: list[Mapping[str, Any]], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    parts_dir = output_path.parent / ".highlight-parts"
    parts_dir.mkdir(parents=True, exist_ok=True)
    parts = []
    try:
        for index, segment in enumerate(segments, start=1):
            part = parts_dir / f"part-{index:03d}.mp4"
            duration = float(segment["end"]) - float(segment["start"])
            _run_ffmpeg([
                "ffmpeg", "-y", "-ss", f"{float(segment['start']):.3f}", "-i", str(source_path),
                "-t", f"{duration:.3f}", "-c:v", "libx264", "-c:a", "aac", "-movflags", "+faststart", str(part),
            ])
            parts.append(part)

        concat_file = parts_dir / "concat.txt"
        concat_file.write_text("".join(f"file '{part.as_posix().replace(chr(39), chr(39) + chr(92) + chr(39) + chr(39))}'\n" for part in parts), encoding="utf-8")
        _run_ffmpeg(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat_file), "-c", "copy", str(output_path)])
    finally:
        for part in parts:
            part.unlink(missing_ok=True)
        (parts_dir / "concat.txt").unlink(missing_ok=True)
        try:
            parts_dir.rmdir()
        except OSError:
            pass


def run_highlight_generation(request: Mapping[str, Any], emit_log: Callable[[str], None]) -> dict[str, Any]:
    job_id = str(request.get("id") or "").strip()
    source_path = Path(str(request.get("source_path") or "").strip())
    output_dir = Path(str(request.get("output_dir") or "").strip())
    if not job_id or not source_path.is_file():
        raise ValueError("highlight generation source file is required")
    if not str(output_dir):
        raise ValueError("highlight generation output directory is required")
    output_dir.mkdir(parents=True, exist_ok=True)

    emit_log("Probing source video")
    source_duration = float(probe_media(source_path).duration_seconds)
    min_minutes = request.get("min_minutes")
    ideal_minutes = request.get("ideal_minutes")
    target = normalize_target(source_duration, min_minutes=min_minutes, ideal_minutes=ideal_minutes)

    emit_log("Transcribing source with the configured provider")
    transcript = transcribe_video_with_config(
        source_path,
        source_duration,
        emit_log,
        headers=request.get("headers") if isinstance(request.get("headers"), Mapping) else None,
    )
    emit_log("Analyzing transcript with the configured AI provider")
    ranked = rank_highlights(
        transcript,
        source_duration,
        min_seconds=target["min_seconds"],
        ideal_seconds=target["ideal_seconds"],
        source_context={**(request.get("source_context") or {}), "headers": request.get("headers") or {}},
        emit_log=emit_log,
    )
    selected = select_segments(
        ranked.get("candidates", []),
        min_seconds=target["min_seconds"],
        ideal_seconds=target["ideal_seconds"],
        source_duration_seconds=source_duration,
    )
    if not selected["segments"]:
        raise ValueError("AI returned no usable highlight candidates")
    if not selected["reached_minimum"]:
        emit_log("Warning: strong material did not reach the requested minimum duration")

    emit_log(f"Rendering {len(selected['segments'])} highlight sections")
    video_path = output_dir / "highlights.mp4"
    render_highlight_reel(source_path, selected["segments"], video_path)
    manifest = {
        "job_id": job_id,
        "source": {"path": str(source_path), "duration_seconds": source_duration},
        "target": target,
        "selection": selected,
        "analysis": {key: ranked.get(key) for key in ("method", "provider", "model")},
        "transcript_language": transcript.get("language", "und"),
        "video_url": f"/videos/{job_id}/highlights.mp4",
    }
    (output_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        "video_url": manifest["video_url"],
        "manifest_url": f"/videos/{job_id}/manifest.json",
        "duration_seconds": selected["duration_seconds"],
        "segments": selected["segments"],
        "analysis": manifest["analysis"],
        "warnings": selected["warnings"],
    }
