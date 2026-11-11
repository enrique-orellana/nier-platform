"""Reusable chunked transcription service used by subtitle workflows."""

from __future__ import annotations

import subprocess
import tempfile
from collections.abc import Callable, Mapping
from dataclasses import replace
from pathlib import Path
from typing import Any

from openshorts.ai.ai_client import load_ai_config, transcribe_audio_openrouter
from openshorts.analysis.analysis_job_lock import analysis_job_lock
from openshorts.analysis.analysis_providers import (
    AudioEventProvider,
    TranscriptionProvider,
    create_audio_event_provider,
    create_transcription_provider,
    dedupe_audio_events,
    load_audio_event_config,
    load_transcription_config,
    normalize_audio_events,
    normalize_transcription_result,
)

TRANSCRIPTION_CHUNK_SECONDS = 300.0

TRANSCRIPTION_OVERLAP_SECONDS = 5.0


def _normalized_segment_text(text: Any) -> str:
    return " ".join(str(text or "").casefold().split())


def merge_transcript_segments(
    segments: list[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """Keep global ordering while removing duplicate text at chunk boundaries."""
    ordered = sorted(
        (segment for segment in segments if str(segment.get("text") or "").strip()),
        key=lambda segment: (
            float(segment.get("start", 0.0)),
            float(segment.get("end", 0.0)),
        ),
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
        merged.append(
            {
                **dict(raw_segment),
                "text": text,
                "start": round(start, 3),
                "end": round(max(end, start), 3),
                "words": list(raw_segment.get("words") or []),
            }
        )
    return merged


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
        raise ValueError(
            "transcription chunk size must be positive and larger than its overlap"
        )

    chunks: list[tuple[float, float]] = []
    start = 0.0
    while start < duration:
        end = min(duration, start + chunk)
        chunks.append((round(start, 3), round(end, 3)))
        if end >= duration:
            break
        start = end - overlap
    return chunks


def _extract_transcription_audio_chunk(
    source_path: Path, start: float, end: float, destination: Path
) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    _run_ffmpeg(
        [
            "ffmpeg",
            "-y",
            "-ss",
            f"{start:.3f}",
            "-i",
            str(source_path),
            "-t",
            f"{end - start:.3f}",
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "libmp3lame",
            "-b:a",
            "32k",
            str(destination),
        ]
    )


class ChunkedTranscriptionService:
    """Compose an injected speech provider and optional event provider over audio chunks."""

    def __init__(
        self,
        transcription_provider: TranscriptionProvider,
        event_provider: AudioEventProvider | None = None,
        *,
        chunk_seconds: float = TRANSCRIPTION_CHUNK_SECONDS,
        overlap_seconds: float = TRANSCRIPTION_OVERLAP_SECONDS,
        extract_chunk: Callable[[Path, float, float, Path], None] | None = None,
    ):
        self.transcription_provider = transcription_provider
        self.event_provider = event_provider
        self.chunk_seconds = chunk_seconds
        self.overlap_seconds = overlap_seconds
        self.extract_chunk = extract_chunk or _extract_transcription_audio_chunk

    def transcribe(
        self,
        video_path: str | Path,
        duration_seconds: float,
        emit_log: Callable[[str], None] | None = None,
        *,
        start_seconds: float = 0.0,
        end_seconds: float | None = None,
        absolute_timestamps: bool = False,
    ) -> dict[str, Any]:
        source_duration = max(0.0, float(duration_seconds))
        range_start = max(0.0, min(source_duration, float(start_seconds or 0.0)))
        range_end = (
            source_duration
            if end_seconds is None
            else max(
                range_start,
                min(source_duration, float(end_seconds)),
            )
        )
        range_duration = range_end - range_start
        chunks = plan_transcription_chunks(
            range_duration,
            chunk_seconds=self.chunk_seconds,
            overlap_seconds=self.overlap_seconds,
        )
        if not chunks:
            raise ValueError("source video has no duration")

        transcript_segments: list[dict[str, Any]] = []
        sound_events: list[dict[str, Any]] = []
        language = "und"
        time_origin = range_start if absolute_timestamps else 0.0
        provider_id = getattr(
            getattr(self.transcription_provider, "config", None),
            "provider",
            type(self.transcription_provider).__name__,
        )
        with analysis_job_lock():
            with tempfile.TemporaryDirectory(
                prefix="openshorts-audio-analysis-"
            ) as directory:
                directory_path = Path(directory)
                for index, (chunk_start, chunk_end) in enumerate(chunks, start=1):
                    if emit_log:
                        emit_log(
                            f"Transcribing chunk {index}/{len(chunks)} with {provider_id}"
                        )
                    chunk_path = directory_path / f"chunk-{index:04d}.mp3"
                    self.extract_chunk(
                        Path(video_path),
                        range_start + chunk_start,
                        range_start + chunk_end,
                        chunk_path,
                    )
                    try:
                        raw_transcript = self.transcription_provider.transcribe_chunk(
                            chunk_path
                        )
                        transcript = normalize_transcription_result(
                            raw_transcript, provider=str(provider_id)
                        )
                    except Exception as exc:
                        raise RuntimeError(
                            f"{provider_id} transcription failed for chunk {index}/{len(chunks)} "
                            f"({chunk_start:.3f}-{chunk_end:.3f}s): {exc}"
                        ) from exc
                    chunk_duration = chunk_end - chunk_start
                    for segment in transcript["segments"]:
                        if (
                            float(segment["start"]) >= chunk_duration
                            or float(segment["end"]) > chunk_duration
                        ):
                            raise RuntimeError(
                                f"{provider_id} transcription failed for chunk {index}/{len(chunks)}: "
                                "segment timing falls outside the submitted audio chunk"
                            )
                        if any(
                            float(word["start"]) >= chunk_duration
                            or float(word["end"]) > chunk_duration
                            for word in segment.get("words", [])
                        ):
                            raise RuntimeError(
                                f"{provider_id} transcription failed for chunk {index}/{len(chunks)}: "
                                "word timing falls outside the submitted audio chunk"
                            )
                    language = str(transcript.get("language") or language)
                    chunk_origin = time_origin + chunk_start
                    max_time = time_origin + range_duration
                    for segment in transcript["segments"]:
                        segment_start = chunk_origin + float(segment["start"])
                        segment_end = chunk_origin + float(segment["end"])
                        if segment_end <= segment_start:
                            segment_end = segment_start + 0.1
                        words = [
                            {
                                "word": word["word"],
                                "start": round(chunk_origin + float(word["start"]), 3),
                                "end": round(
                                    min(max_time, chunk_origin + float(word["end"])), 3
                                ),
                            }
                            for word in segment.get("words", [])
                        ]
                        transcript_segments.append(
                            {
                                "text": segment["text"],
                                "start": round(
                                    chunk_origin + float(segment["start"]), 3
                                ),
                                "end": round(
                                    min(
                                        max_time, max(segment_start + 0.1, segment_end)
                                    ),
                                    3,
                                ),
                                "words": words,
                            }
                        )

                    if self.event_provider is not None:
                        event_id = getattr(
                            getattr(self.event_provider, "config", None),
                            "provider",
                            type(self.event_provider).__name__,
                        )
                        try:
                            raw_events = self.event_provider.detect_events(
                                chunk_path,
                                transcript=raw_transcript,
                            )
                            normalized_events = normalize_audio_events(
                                raw_events,
                                provider=str(event_id),
                                min_confidence=float(
                                    getattr(
                                        getattr(self.event_provider, "config", None),
                                        "min_confidence",
                                        0.0,
                                    )
                                ),
                            )
                        except Exception as exc:
                            raise RuntimeError(
                                f"{event_id} sound-event analysis failed for chunk {index}/{len(chunks)} "
                                f"({chunk_start:.3f}-{chunk_end:.3f}s): {exc}"
                            ) from exc
                        for event in normalized_events:
                            if (
                                float(event["start"]) >= chunk_duration
                                or float(event["end"]) > chunk_duration
                            ):
                                raise RuntimeError(
                                    f"{event_id} sound-event analysis failed for chunk "
                                    f"{index}/{len(chunks)}: event timing falls outside the submitted audio chunk"
                                )
                            sound_events.append(
                                {
                                    **event,
                                    "start": round(
                                        chunk_origin + float(event["start"]), 3
                                    ),
                                    "end": round(
                                        min(
                                            max_time, chunk_origin + float(event["end"])
                                        ),
                                        3,
                                    ),
                                }
                            )
                    chunk_path.unlink(missing_ok=True)

        transcript_segments = merge_transcript_segments(transcript_segments)
        unique_events = dedupe_audio_events(sound_events)
        return {
            "text": " ".join(
                segment["text"] for segment in transcript_segments
            ).strip(),
            "segments": transcript_segments,
            "language": language,
            "events": unique_events,
        }


def transcribe_video_with_config(
    video_path: str | Path,
    duration_seconds: float,
    emit_log: Callable[[str], None] | None = None,
    *,
    headers: Mapping[str, Any] | None = None,
    start_seconds: float = 0.0,
    end_seconds: float | None = None,
) -> dict[str, Any]:
    """Transcribe audio with the environment-selected provider and bounded chunks."""
    ai_config = load_ai_config(headers)
    normalized_provider = getattr(ai_config, "normalized_provider", None)
    chat_provider = normalized_provider() if callable(normalized_provider) else None
    if not isinstance(chat_provider, str):
        chat_provider = None
    transcription_config = load_transcription_config(ai_provider=chat_provider)
    language_hint = getattr(ai_config, "transcription_language", "auto")
    if isinstance(language_hint, str) and language_hint != "auto":
        transcription_config = replace(transcription_config, language=language_hint)
    transcription_provider = create_transcription_provider(
        transcription_config,
        ai_config=ai_config,
        transcribe_fn=transcribe_audio_openrouter,
    )
    event_config = load_audio_event_config()
    event_provider = create_audio_event_provider(event_config)
    service = ChunkedTranscriptionService(transcription_provider, event_provider)
    return service.transcribe(
        video_path,
        duration_seconds,
        emit_log,
        start_seconds=start_seconds,
        end_seconds=end_seconds,
    )


def _run_ffmpeg(command: list[str]) -> None:
    subprocess.run(
        command, check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True
    )
