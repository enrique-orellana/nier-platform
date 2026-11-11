from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

import openshorts.subtitles.transcription as transcription


def test_plan_transcription_chunks_bounds_long_sources():
    chunks = transcription.plan_transcription_chunks(
        1200.0, chunk_seconds=600.0, overlap_seconds=10.0
    )

    assert chunks == [(0.0, 600.0), (590.0, 1190.0), (1180.0, 1200.0)]


def test_chunked_transcription_service_composes_injected_speech_and_event_providers(
    tmp_path,
):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"source")
    chunks = []

    class SpeechProvider:
        config = type("Config", (), {"provider": "test-asr"})()

        def transcribe_chunk(self, path):
            chunks.append(Path(path).name)
            return {
                "text": "ciao",
                "language": "it",
                "segments": [{"start": 1, "end": 2, "text": "ciao", "words": []}],
            }

    class EventProvider:
        config = type("Config", (), {"provider": "test-events"})()

        def detect_events(self, path, *, transcript=None):
            assert transcript["text"] == "ciao"
            return [{"start": 3, "end": 4, "label": "Laughter", "confidence": 0.9}]

    def extract(_source, start, end, destination):
        destination.write_bytes(f"{start}-{end}".encode())

    service = transcription.ChunkedTranscriptionService(
        SpeechProvider(),
        EventProvider(),
        chunk_seconds=10,
        overlap_seconds=0,
        extract_chunk=extract,
    )

    result = service.transcribe(source, 25)

    assert len(chunks) == 3
    assert [segment["start"] for segment in result["segments"]] == [1, 11, 21]
    assert [event["start"] for event in result["events"]] == [3, 13, 23]
    assert [event["source"] for event in result["events"]] == ["test-events"] * 3


def test_chunked_transcription_service_merges_duplicate_events_from_chunk_overlap(
    tmp_path,
):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"source")
    event_chunks = iter(
        [
            [{"start": 8.7, "end": 9.6, "label": "Laughter", "confidence": 0.8}],
            [{"start": 0.8, "end": 1.7, "label": "Laughter", "confidence": 0.95}],
        ]
    )

    class SpeechProvider:
        config = type("Config", (), {"provider": "test-asr"})()

        def transcribe_chunk(self, _path):
            return {"text": "", "segments": [], "language": "it"}

    class EventProvider:
        config = type("Config", (), {"provider": "test-events"})()

        def detect_events(self, _path, *, transcript=None):
            return next(event_chunks)

    service = transcription.ChunkedTranscriptionService(
        SpeechProvider(),
        EventProvider(),
        chunk_seconds=10,
        overlap_seconds=2,
        extract_chunk=lambda _source, start, end, destination: destination.write_bytes(
            b"audio"
        ),
    )

    result = service.transcribe(source, 18)

    assert len(result["events"]) == 1
    assert result["events"][0]["start"] == 8.7
    assert result["events"][0]["end"] == 9.7
    assert result["events"][0]["confidence"] == 0.95


def test_chunked_transcription_service_fails_the_selected_provider_without_fallback(
    tmp_path,
):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"source")
    calls = []

    class BrokenProvider:
        config = type("Config", (), {"provider": "remote-asr"})()

        def transcribe_chunk(self, _path):
            calls.append("remote-asr")
            raise RuntimeError("service unavailable")

    service = transcription.ChunkedTranscriptionService(
        BrokenProvider(),
        chunk_seconds=10,
        overlap_seconds=0,
        extract_chunk=lambda _source, _start, _end, destination: destination.write_bytes(
            b"audio"
        ),
    )

    with pytest.raises(
        RuntimeError, match="remote-asr transcription failed for chunk 1/1"
    ):
        service.transcribe(source, 5)
    assert calls == ["remote-asr"]


def test_transcribe_video_uses_provider_selected_by_environment(monkeypatch, tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"source")
    selected = []

    class FakeSpeechProvider:
        config = type("Config", (), {"provider": "openai-compatible"})()

        def transcribe_chunk(self, _path):
            return {
                "text": "local text",
                "language": "it",
                "segments": [{"start": 0, "end": 2, "text": "local text"}],
            }

    class FakeEvents:
        config = type("Config", (), {"provider": "none"})()

        def detect_events(self, _path, *, transcript=None):
            return []

    def create_transcriber(config, **_dependencies):
        selected.append(config.provider)
        return FakeSpeechProvider()

    monkeypatch.setenv("AI_TRANSCRIPTION_PROVIDER", "openai-compatible")
    monkeypatch.setenv("AI_TRANSCRIPTION_BASE_URL", "http://127.0.0.1:8000/v1")
    monkeypatch.setattr(
        transcription,
        "load_ai_config",
        lambda _headers=None: type("AI", (), {"transcription_language": "auto"})(),
    )
    monkeypatch.setattr(
        transcription, "create_transcription_provider", create_transcriber
    )
    monkeypatch.setattr(
        transcription, "create_audio_event_provider", lambda _config: FakeEvents()
    )
    monkeypatch.setattr(
        transcription,
        "_extract_transcription_audio_chunk",
        lambda _source, _start, _end, destination: destination.write_bytes(b"audio"),
    )

    result = transcription.transcribe_video_with_config(source, 30)

    assert selected == ["openai-compatible"]
    assert result["text"] == "local text"
    assert result["events"] == []


def test_local_chat_requires_explicit_transcription_service_even_with_remote_env_default(
    monkeypatch,
):
    local_chat_config = SimpleNamespace(
        normalized_provider=lambda: "lmstudio",
        transcription_language="auto",
    )
    monkeypatch.setattr(
        transcription,
        "load_ai_config",
        lambda _headers=None: local_chat_config,
    )
    monkeypatch.setenv("AI_PROVIDER", "openrouter")
    monkeypatch.setenv("AI_TRANSCRIPTION_PROVIDER", "")

    with pytest.raises(
        ValueError, match="AI_TRANSCRIPTION_PROVIDER must be set explicitly"
    ):
        transcription.transcribe_video_with_config("unused.mp4", 30)


def test_transcribe_video_with_config_uses_openrouter_audio_provider(
    monkeypatch, tmp_path
):
    monkeypatch.setenv("AI_PROVIDER", "openrouter")
    monkeypatch.setenv("AI_TRANSCRIPTION_PROVIDER", "openrouter-json")
    source = tmp_path / "source.mp4"
    source.write_bytes(b"source")
    config = Mock()
    monkeypatch.setattr(transcription, "load_ai_config", lambda _headers=None: config)
    monkeypatch.setattr(
        transcription,
        "_extract_transcription_audio_chunk",
        lambda _source, _start, _end, destination: destination.write_bytes(b"audio"),
    )
    transcribe = Mock(
        return_value={
            "text": "Cloud text",
            "language": "en",
            "segments": [
                {
                    "start": 1,
                    "end": 4,
                    "text": "Cloud text",
                    "words": [
                        {"word": "Cloud", "start": 1, "end": 2},
                        {"word": "text", "start": 2, "end": 4},
                    ],
                }
            ],
        }
    )
    monkeypatch.setattr(transcription, "transcribe_audio_openrouter", transcribe)

    result = transcription.transcribe_video_with_config(
        source, 60.0, headers={"X-AI-Provider": "openrouter"}
    )

    assert result["text"] == "Cloud text"
    assert result["segments"] == [
        {
            "text": "Cloud text",
            "start": 1.0,
            "end": 4.0,
            "words": [
                {"word": "Cloud", "start": 1.0, "end": 2.0},
                {"word": "text", "start": 2.0, "end": 4.0},
            ],
        }
    ]


def test_openrouter_transcription_uses_single_chunk_for_short_source(
    monkeypatch, tmp_path
):
    monkeypatch.setenv("AI_PROVIDER", "openrouter")
    monkeypatch.setenv("AI_TRANSCRIPTION_PROVIDER", "openrouter-json")
    source = tmp_path / "source.mp4"
    source.write_bytes(b"source")
    config = Mock()
    monkeypatch.setattr(transcription, "load_ai_config", lambda _headers=None: config)
    extracted = []

    def extract_chunk(_source, start, end, destination):
        extracted.append((start, end))
        destination.write_bytes(b"audio")

    monkeypatch.setattr(
        transcription, "_extract_transcription_audio_chunk", extract_chunk
    )
    monkeypatch.setattr(
        transcription,
        "transcribe_audio_openrouter",
        lambda *_args: {
            "text": "Cloud text",
            "language": "en",
            "segments": [{"start": 0, "end": 1, "text": "Cloud text"}],
        },
    )

    result = transcription.transcribe_video_with_config(
        source, 240.0, headers={"X-AI-Provider": "openrouter"}
    )

    assert result["text"] == "Cloud text"
    assert extracted == [(0.0, 240.0)]


def test_openrouter_transcription_uses_selected_clip_range(monkeypatch, tmp_path):
    monkeypatch.setenv("AI_PROVIDER", "openrouter")
    monkeypatch.setenv("AI_TRANSCRIPTION_PROVIDER", "openrouter-json")
    source = tmp_path / "source.mp4"
    source.write_bytes(b"source")
    config = Mock()
    monkeypatch.setattr(transcription, "load_ai_config", lambda _headers=None: config)
    extracted = []

    def extract_chunk(_source, start, end, destination):
        extracted.append((start, end))
        destination.write_bytes(b"audio")

    monkeypatch.setattr(
        transcription, "_extract_transcription_audio_chunk", extract_chunk
    )
    monkeypatch.setattr(
        transcription,
        "transcribe_audio_openrouter",
        lambda *_args: {
            "text": "Clip text",
            "language": "en",
            "segments": [
                {
                    "start": 0.5,
                    "end": 1.5,
                    "text": "Clip text",
                    "words": [{"word": "Clip", "start": 0.5, "end": 1.0}],
                }
            ],
        },
    )

    result = transcription.transcribe_video_with_config(
        source,
        100.0,
        start_seconds=12.5,
        end_seconds=20.75,
        headers={"X-AI-Provider": "openrouter"},
    )

    assert extracted == [(12.5, 20.75)]
    assert result["segments"] == [
        {
            "text": "Clip text",
            "start": 0.5,
            "end": 1.5,
            "words": [{"word": "Clip", "start": 0.5, "end": 1.0}],
        }
    ]


def test_openrouter_transcription_reports_failed_chunk(monkeypatch, tmp_path):
    monkeypatch.setenv("AI_PROVIDER", "openrouter")
    monkeypatch.setenv("AI_TRANSCRIPTION_PROVIDER", "openrouter-json")
    source = tmp_path / "source.mp4"
    source.write_bytes(b"source")
    config = Mock()
    monkeypatch.setattr(transcription, "load_ai_config", lambda _headers=None: config)
    monkeypatch.setattr(
        transcription,
        "_extract_transcription_audio_chunk",
        lambda _source, _start, _end, destination: destination.write_bytes(b"audio"),
    )
    monkeypatch.setattr(
        transcription,
        "transcribe_audio_openrouter",
        Mock(side_effect=RuntimeError("could not connect to OpenRouter")),
    )

    with pytest.raises(
        RuntimeError,
        match=r"openrouter-json transcription failed for chunk 1/1.*could not connect",
    ):
        transcription.transcribe_video_with_config(
            source, 60.0, headers={"X-AI-Provider": "openrouter"}
        )


def test_openrouter_transcription_uses_five_minute_overlapping_chunks(
    monkeypatch, tmp_path
):
    monkeypatch.setenv("AI_PROVIDER", "openrouter")
    monkeypatch.setenv("AI_TRANSCRIPTION_PROVIDER", "openrouter-json")
    source = tmp_path / "source.mp4"
    source.write_bytes(b"source")
    config = Mock()
    monkeypatch.setattr(transcription, "load_ai_config", lambda _headers=None: config)
    extracted = []

    def extract_chunk(_source, start, end, destination):
        extracted.append((start, end, destination.suffix))
        destination.write_bytes(b"audio")

    monkeypatch.setattr(
        transcription, "_extract_transcription_audio_chunk", extract_chunk
    )
    monkeypatch.setattr(
        transcription,
        "transcribe_audio_openrouter",
        lambda *_args: {
            "text": "Cloud text",
            "language": "en",
            "segments": [{"start": 0, "end": 1, "text": "Cloud text"}],
        },
    )

    result = transcription.transcribe_video_with_config(
        source,
        1200.0,
        headers={"X-AI-Provider": "openrouter"},
    )

    assert result["text"] == " ".join(["Cloud text"] * 5)
    assert extracted == [
        (0.0, 300.0, ".mp3"),
        (295.0, 595.0, ".mp3"),
        (590.0, 890.0, ".mp3"),
        (885.0, 1185.0, ".mp3"),
        (1180.0, 1200.0, ".mp3"),
    ]


def test_extract_transcription_audio_chunk_uses_compressed_mono_speech_audio(
    monkeypatch, tmp_path
):
    commands = []
    monkeypatch.setattr(
        transcription, "_run_ffmpeg", lambda command: commands.append(command)
    )

    destination = tmp_path / "chunk.mp3"
    transcription._extract_transcription_audio_chunk(
        tmp_path / "source.mp4", 5.0, 65.0, destination
    )

    assert commands == [
        [
            "ffmpeg",
            "-y",
            "-ss",
            "5.000",
            "-i",
            str(tmp_path / "source.mp4"),
            "-t",
            "60.000",
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
    ]


def test_merge_transcript_segments_removes_duplicate_overlap_segments():
    segments = transcription.merge_transcript_segments(
        [
            {"text": "The important point.", "start": 290.0, "end": 299.0, "words": []},
            {"text": "The important point.", "start": 295.0, "end": 299.0, "words": []},
            {"text": "The next point.", "start": 299.0, "end": 304.0, "words": []},
        ]
    )

    assert [segment["text"] for segment in segments] == [
        "The important point.",
        "The next point.",
    ]
