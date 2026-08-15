"""AI-ranked long-form highlight generation for the OpenShorts worker."""

from __future__ import annotations

import json
import subprocess
import tempfile
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

from ai_client import chat_json, load_ai_config
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
duration when strong material exists, but do not invent or pad weak sections.

SOURCE_DURATION_SECONDS: {video_duration}
MINIMUM_REEL_SECONDS: {min_seconds}
IDEAL_REEL_SECONDS: {ideal_seconds}
SOURCE_CONTEXT: {source_context}
TRANSCRIPT:
{transcript}
""".strip()

MAX_PROMPT_CHARS = 48000
MAX_TRANSCRIPT_CHARS_PER_CHUNK = 36000
TRANSCRIPTION_CHUNK_SECONDS = 600.0
TRANSCRIPTION_OVERLAP_SECONDS = 10.0


def _transcript_text(transcript: Mapping[str, Any]) -> str:
    text = str(transcript.get("text") or "").strip()
    if text:
        return text
    return " ".join(str(segment.get("text") or "").strip() for segment in transcript.get("segments", []) if segment.get("text")).strip()


def plan_transcription_chunks(
    duration_seconds: float,
    *,
    chunk_seconds: float = TRANSCRIPTION_CHUNK_SECONDS,
    overlap_seconds: float = TRANSCRIPTION_OVERLAP_SECONDS,
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


def _load_whisper_model():
    from faster_whisper import WhisperModel

    return WhisperModel("large-v3", device="cpu", compute_type="int8")


def _extract_audio_chunk(source_path: Path, start: float, end: float, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    _run_ffmpeg([
        "ffmpeg", "-y", "-ss", f"{start:.3f}", "-i", str(source_path),
        "-t", f"{end - start:.3f}", "-vn", "-ac", "1", "-ar", "16000",
        "-c:a", "pcm_s16le", str(destination),
    ])


def transcribe_video_in_chunks(
    video_path: str | Path,
    duration_seconds: float,
    emit_log: Callable[[str], None] | None = None,
    *,
    model_factory: Callable[[], Any] = _load_whisper_model,
    extract_chunk: Callable[[Path, float, float, Path], None] = _extract_audio_chunk,
    chunk_seconds: float = TRANSCRIPTION_CHUNK_SECONDS,
    overlap_seconds: float = TRANSCRIPTION_OVERLAP_SECONDS,
    temp_dir: str | Path | None = None,
) -> dict[str, Any]:
    chunks = plan_transcription_chunks(duration_seconds, chunk_seconds=chunk_seconds, overlap_seconds=overlap_seconds)
    if not chunks:
        raise ValueError("source video has no duration")

    model = model_factory()
    segments: list[dict[str, Any]] = []
    language = "und"

    def transcribe_from_directory(directory: Path) -> None:
        nonlocal language
        for index, (start, end) in enumerate(chunks, start=1):
            if emit_log:
                emit_log(f"Transcribing chunk {index}/{len(chunks)}")
            chunk_path = directory / f"chunk-{index:04d}.wav"
            try:
                extract_chunk(Path(video_path), start, end, chunk_path)
                chunk_segments, info = model.transcribe(str(chunk_path), word_timestamps=False)
                language = str(getattr(info, "language", language) or language)
                for segment in chunk_segments:
                    text = str(getattr(segment, "text", "") or "").strip()
                    if not text:
                        continue
                    segments.append({
                        "text": text,
                        "start": round(start + float(segment.start), 3),
                        "end": round(start + float(segment.end), 3),
                        "words": [],
                    })
            finally:
                chunk_path.unlink(missing_ok=True)

    if temp_dir is None:
        with tempfile.TemporaryDirectory(prefix="openshorts-highlight-") as directory:
            transcribe_from_directory(Path(directory))
    else:
        directory = Path(temp_dir)
        directory.mkdir(parents=True, exist_ok=True)
        transcribe_from_directory(directory)

    return {
        "text": " ".join(segment["text"] for segment in segments).strip(),
        "segments": segments,
        "language": language,
    }


def _analysis_chunks(transcript: Mapping[str, Any]) -> list[dict[str, Any]]:
    segments = transcript.get("segments", []) or []
    if not segments:
        text = _transcript_text(transcript)
        if len(text) <= MAX_TRANSCRIPT_CHARS_PER_CHUNK:
            return [{"text": text, "words": []}]
        return [
            {"text": text[start:start + MAX_TRANSCRIPT_CHARS_PER_CHUNK], "words": []}
            for start in range(0, len(text), MAX_TRANSCRIPT_CHARS_PER_CHUNK)
        ]

    chunks: list[dict[str, Any]] = []
    current: list[dict[str, Any]] = []
    current_size = 0
    for segment in segments:
        words = [
            {"w": word.get("word", ""), "s": word.get("start"), "e": word.get("end")}
            for word in segment.get("words", []) or []
        ]
        item = {"text": str(segment.get("text") or "").strip(), "start": segment.get("start"), "end": segment.get("end"), "words": words}
        item_size = len(json.dumps(item, ensure_ascii=False))
        if current and current_size + item_size > MAX_TRANSCRIPT_CHARS_PER_CHUNK:
            chunks.append({
                "text": " ".join(str(entry.get("text") or "") for entry in current),
                "words": [word for entry in current for word in entry["words"]],
            })
            current = []
            current_size = 0
        current.append(item)
        current_size += item_size
    if current:
        chunks.append({
            "text": " ".join(str(entry.get("text") or "") for entry in current),
            "words": [word for entry in current for word in entry["words"]],
        })
    return chunks or [{"text": "", "words": []}]


def rank_highlights(
    transcript: Mapping[str, Any],
    video_duration: float,
    *,
    min_seconds: float | None = None,
    ideal_seconds: float | None = None,
    source_context: Mapping[str, Any] | None = None,
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
    for chunk in chunks:
        prompt = HIGHLIGHT_PROMPT.format(
            video_duration=round(float(video_duration), 3),
            min_seconds=target["min_seconds"],
            ideal_seconds=target["ideal_seconds"],
            source_context=json.dumps(prompt_context, ensure_ascii=False),
            transcript=json.dumps(chunk, ensure_ascii=False),
        )
        if len(prompt) > MAX_PROMPT_CHARS:
            raise ValueError("Transcript chunk exceeds the configured AI prompt limit")
        response = chat_json(config, prompt, model=model, reasoning_effort=config.analyze_reasoning_effort)
        raw_candidates = response.get("highlights") if isinstance(response, dict) else None
        if not isinstance(raw_candidates, list):
            raise ValueError("AI returned no highlight candidates")
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

    emit_log("Transcribing source with Faster-Whisper")
    transcript = transcribe_video_in_chunks(source_path, source_duration, emit_log)
    emit_log("Analyzing transcript with the configured AI provider")
    ranked = rank_highlights(
        transcript,
        source_duration,
        min_seconds=target["min_seconds"],
        ideal_seconds=target["ideal_seconds"],
        source_context={**(request.get("source_context") or {}), "headers": request.get("headers") or {}},
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
