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
from transcript_windows import (
    build_analysis_timeline,
    build_analysis_windows,
    dedupe_clip_candidates,
    resolve_candidate_bounds,
    timeline_units_by_id,
)


HIGHLIGHT_PROMPT = """
You are an expert long-form video editor. Find the most interesting, self-contained
sections of the supplied video transcript for a coherent highlight reel. Prefer
strong hooks, useful explanations, surprising turns, emotional peaks, clear
payoffs, stories, and moments that make sense without missing context. Exclude
intros, outros, ads, dead air, repeated points, and weak filler.

Return JSON only in this shape:
{{"highlights":[{{"start":0.0,"end":30.0,"start_word_id":0,"end_word_id":4,"score":0.0,"reason":"...","text":"..."}}]}}

Use absolute seconds. Every section must be between 15 and 300 seconds, must be
inside the source duration, and must start/end near natural word boundaries. Rank
the sections by score from 0 to 1. Return enough candidates to reach the target
duration when strong material exists, but do not invent or pad weak sections. If
the source is shorter than the requested target, analyze only the available source.
Return at most 12 candidates. Keep each reason under 160 characters and each text
under 300 characters.

SOURCE_DURATION_SECONDS: {video_duration}
MINIMUM_REEL_SECONDS: {min_seconds}
IDEAL_REEL_SECONDS: {ideal_seconds}
SOURCE_CONTEXT: {source_context}
WINDOW_CORE_AND_CONTEXT_SECONDS: {window_metadata}
TIMESTAMPED_TRANSCRIPT (lossless segment records plus canonical word records):
Segments are [SEGMENT_ID, ABSOLUTE_START_SECONDS, ABSOLUTE_END_SECONDS, COMPLETE_TEXT, WORD_IDS].
Words are [WORD_ID, ABSOLUTE_START_SECONDS, ABSOLUTE_END_SECONDS, TEXT].
Use canonical word IDs whenever available; use segment IDs only when no word IDs are present. Never invent IDs or timestamps outside this window.
{timestamped_transcript}
""".strip()

MAX_PROMPT_CHARS = 48000
MAX_TRANSCRIPT_CHARS_PER_CHUNK = 24000
HIGHLIGHT_ANALYSIS_TIMEOUT_SECONDS = 120.0
HIGHLIGHT_ANALYSIS_CORE_SECONDS = 90.0
HIGHLIGHT_ANALYSIS_OVERLAP_SECONDS = 61.0
HIGHLIGHT_ANALYSIS_DISCOVERY_LIMIT = 12
HIGHLIGHT_ANALYSIS_RETRY_COUNT = 1
OPENROUTER_TRANSCRIPTION_CHUNK_SECONDS = 30.0
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


def _analysis_chunks(
    transcript: Mapping[str, Any],
    video_duration: float = 0.0,
) -> list[dict[str, Any]]:
    """Compatibility wrapper around the shared lossless analysis planner."""
    source = dict(transcript or {})
    analysis_duration = max(float(video_duration or 0.0), 0.0)
    if analysis_duration <= 0:
        analysis_duration = max(
            (float(segment.get("end", 0.0)) for segment in source.get("segments", []) or []),
            default=0.0,
        )
    if not source.get("segments") and _transcript_text(source):
        source["segments"] = [{
            "start": 0.0,
            "end": round(analysis_duration, 3),
            "text": _transcript_text(source),
        }]
    timeline = build_analysis_timeline(source, analysis_duration)
    return build_analysis_windows(
        timeline,
        analysis_duration,
        core_seconds=HIGHLIGHT_ANALYSIS_CORE_SECONDS,
        overlap_seconds=HIGHLIGHT_ANALYSIS_OVERLAP_SECONDS,
        max_prompt_chars=MAX_PROMPT_CHARS,
        prompt_overhead_chars=6000,
    )


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
    analysis_source = dict(transcript or {})
    if not analysis_source.get("segments") and _transcript_text(analysis_source):
        analysis_source["segments"] = [{
            "start": 0.0,
            "end": round(max(float(video_duration or 0.0), 0.0), 3),
            "text": _transcript_text(analysis_source),
        }]
    timeline = build_analysis_timeline(analysis_source, video_duration)
    indexed_units = timeline_units_by_id(timeline)
    chunks = _analysis_chunks(analysis_source, video_duration)
    status = {
        "planned_windows": len(chunks),
        "started_windows": 0,
        "retried_windows": 0,
        "succeeded_windows": 0,
        "saturated_windows": 0,
        "failed_windows": 0,
    }
    successful_window_indexes = set()
    provider = config.normalized_provider()
    if emit_log:
        emit_log(
            f"AI analysis provider={provider} model={model or 'auto'}; "
            f"transcript_chunks={len(chunks)}"
        )
    for index, chunk in enumerate(chunks, start=1):
        status["started_windows"] += 1
        window_metadata = json.dumps({
            "core_start": chunk["core_start"],
            "core_end": chunk["core_end"],
            "context_start": chunk["context_start"],
            "context_end": chunk["context_end"],
            "timestamp_mode": timeline["timestamp_mode"],
        }, ensure_ascii=False)
        prompt = HIGHLIGHT_PROMPT.format(
            video_duration=round(float(video_duration), 3),
            min_seconds=target["min_seconds"],
            ideal_seconds=target["ideal_seconds"],
            source_context=json.dumps(prompt_context, ensure_ascii=False),
            window_metadata=window_metadata,
            timestamped_transcript=json.dumps(
                chunk["transcript"], ensure_ascii=False, separators=(",", ":")
            ),
        )
        if len(prompt) > MAX_PROMPT_CHARS:
            raise ValueError("Transcript chunk exceeds the configured AI prompt limit")
        if emit_log:
            emit_log(
                f"AI analysis window {index}/{len(chunks)} "
                f"core={chunk['core_start']:.3f}-{chunk['core_end']:.3f} "
                f"context={chunk['context_start']:.3f}-{chunk['context_end']:.3f} "
                f"units={len(chunk['transcript'].get('segments', [])) + len(chunk['transcript'].get('words', []))} "
                f"prompt_chars={len(prompt)}"
            )
        started_at = time.monotonic()
        raw_candidates = None
        for attempt in range(HIGHLIGHT_ANALYSIS_RETRY_COUNT + 1):
            if attempt:
                status["retried_windows"] += 1
            try:
                response = chat_json(
                    config,
                    prompt,
                    model=model,
                    reasoning_effort=config.analyze_reasoning_effort,
                    timeout=HIGHLIGHT_ANALYSIS_TIMEOUT_SECONDS,
                )
                raw_candidates = response.get("highlights") if isinstance(response, dict) else None
                if not isinstance(raw_candidates, list):
                    raise ValueError("AI returned no highlight candidates")
                break
            except Exception as exc:
                if attempt >= HIGHLIGHT_ANALYSIS_RETRY_COUNT:
                    status["failed_windows"] += 1
                    if emit_log:
                        emit_log(
                            f"AI analysis window {index}/{len(chunks)} failed after retry: "
                            f"{time.monotonic() - started_at:.1f}s: {type(exc).__name__}: {exc}"
                        )
                elif emit_log:
                    emit_log(
                        f"AI analysis window {index}/{len(chunks)} failed; retrying: "
                        f"{type(exc).__name__}: {exc}"
                    )
        if not isinstance(raw_candidates, list):
            continue
        successful_window_indexes.add(index - 1)
        status["succeeded_windows"] += 1
        if len(raw_candidates) >= HIGHLIGHT_ANALYSIS_DISCOVERY_LIMIT:
            status["saturated_windows"] += 1
            continuation_prompt = (
                prompt
                + "\nCONTINUATION PASS: return additional distinct strong moments from this same window "
                "that were not in the previous response. Do not repeat previous candidates. "
                "Return at most 12 more highlights in the same JSON shape."
            )
            if len(continuation_prompt) <= MAX_PROMPT_CHARS:
                try:
                    continuation = chat_json(
                        config,
                        continuation_prompt,
                        model=model,
                        reasoning_effort=config.analyze_reasoning_effort,
                        timeout=HIGHLIGHT_ANALYSIS_TIMEOUT_SECONDS,
                    )
                    if isinstance(continuation, dict) and isinstance(continuation.get("highlights"), list):
                        raw_candidates = list(raw_candidates) + list(continuation["highlights"])
                except Exception as exc:
                    if emit_log:
                        emit_log(
                            f"AI analysis continuation for window {index} failed: "
                            f"{type(exc).__name__}: {exc}"
                        )
        if emit_log:
            emit_log(
                f"AI analysis window {index}/{len(chunks)} completed in "
                f"{time.monotonic() - started_at:.1f}s; candidates={len(raw_candidates)}"
            )
        for raw in raw_candidates:
            if not isinstance(raw, Mapping):
                continue
            resolved = resolve_candidate_bounds(
                raw,
                indexed_units,
                video_duration,
                timestamp_mode=timeline["timestamp_mode"],
                core_start=chunk["core_start"],
                core_end=chunk["core_end"],
                min_seconds=15.0,
                max_seconds=300.0,
            )
            if resolved is not None:
                resolved["reason"] = str(raw.get("reason") or "").strip()
                resolved["text"] = str(raw.get("text") or "").strip()
                candidates.append(resolved)
    missing_windows = [
        {
            "start": chunks[index]["core_start"],
            "end": chunks[index]["core_end"],
        }
        for index in range(len(chunks))
        if index not in successful_window_indexes
    ]
    candidates = dedupe_clip_candidates(candidates)
    return {
        "method": "ai",
        "provider": config.normalized_provider(),
        "model": model,
        "candidates": candidates,
        "target": target,
        "chunks_analyzed": len(chunks),
        "analysis": {
            **status,
            "incomplete": bool(missing_windows),
            "missing_core_ranges": missing_windows,
        },
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
    analysis_metadata = ranked.get("analysis") or {}
    if analysis_metadata.get("incomplete"):
        emit_log(
            "Warning: highlight AI analysis has incomplete core coverage; "
            f"missing_windows={len(analysis_metadata.get('missing_core_ranges') or [])}"
        )
    selected = select_segments(
        ranked.get("candidates", []),
        min_seconds=target["min_seconds"],
        ideal_seconds=target["ideal_seconds"],
        source_duration_seconds=source_duration,
    )
    if not selected["segments"]:
        if analysis_metadata.get("incomplete"):
            raise ValueError("AI returned no usable highlight candidates because analysis coverage was incomplete")
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
        "analysis": {
            **{key: ranked.get(key) for key in ("method", "provider", "model")},
            "window_coverage": analysis_metadata,
        },
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
