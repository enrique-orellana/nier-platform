from pathlib import Path
from unittest.mock import Mock

import pytest

import highlight_generation


def test_plan_transcription_chunks_bounds_long_sources():
    chunks = highlight_generation.plan_transcription_chunks(1200.0, chunk_seconds=600.0, overlap_seconds=10.0)

    assert chunks == [(0.0, 600.0), (590.0, 1190.0), (1180.0, 1200.0)]


def test_transcribe_video_in_chunks_reuses_model_offsets_timestamps_and_cleans_chunks(tmp_path):
    class FakeSegment:
        def __init__(self, start, end, text):
            self.start = start
            self.end = end
            self.text = text

    class FakeModel:
        def __init__(self):
            self.calls = []

        def transcribe(self, path, word_timestamps=False):
            self.calls.append((path, word_timestamps))
            return iter([FakeSegment(1.0, 4.0, "chunk text")]), Mock(language="en")

    model = FakeModel()
    extracted = []

    def extract_chunk(_source, start, end, destination):
        destination.write_bytes(b"audio")
        extracted.append((start, end, destination))

    logs = []
    result = highlight_generation.transcribe_video_in_chunks(
        tmp_path / "source.mp4",
        1200.0,
        logs.append,
        model_factory=lambda: model,
        extract_chunk=extract_chunk,
        chunk_seconds=600.0,
        overlap_seconds=10.0,
        temp_dir=tmp_path,
    )

    assert len(model.calls) == 3
    assert all(word_timestamps is False for _path, word_timestamps in model.calls)
    assert [segment["start"] for segment in result["segments"]] == [1.0, 591.0, 1181.0]
    assert [segment["end"] for segment in result["segments"]] == [4.0, 594.0, 1184.0]
    assert result["text"] == "chunk text chunk text chunk text"
    assert logs == ["Transcribing chunk 1/3", "Transcribing chunk 2/3", "Transcribing chunk 3/3"]
    assert all(not destination.exists() for _start, _end, destination in extracted)


def test_transcribe_video_with_config_uses_openrouter_audio_provider(monkeypatch, tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"source")
    config = Mock(transcription_provider="openrouter")
    monkeypatch.setattr(highlight_generation, "load_ai_config", lambda _headers=None: config)
    monkeypatch.setattr(highlight_generation, "_extract_audio_chunk", lambda _source, _start, _end, destination: destination.write_bytes(b"audio"))
    transcribe = Mock(return_value={"text": "Cloud text", "language": "en", "segments": [{"start": 1, "end": 4, "text": "Cloud text"}]})
    monkeypatch.setattr(highlight_generation, "transcribe_audio_openrouter", transcribe)

    result = highlight_generation.transcribe_video_with_config(source, 60.0, headers={"X-AI-Provider": "openrouter"})

    assert result["text"] == "Cloud text"
    assert result["segments"] == [{"text": "Cloud text", "start": 1.0, "end": 4.0, "words": []}]
    transcribe.assert_called_once()


def test_rank_highlights_uses_existing_ai_configuration(monkeypatch):
    transcript = {
        "text": "A useful explanation.",
        "segments": [
            {"text": "A useful explanation.", "start": 10.0, "end": 18.0, "words": []}
        ],
        "language": "en",
    }
    config = Mock(normalized_provider=lambda: "ollama", analyze_model="qwen", is_gemini=lambda: False)
    monkeypatch.setattr(highlight_generation, "load_ai_config", lambda _headers=None: config)
    chat = Mock(return_value={"highlights": [{"start": 10, "end": 18, "score": 0.91, "reason": "clear payoff"}]})
    monkeypatch.setattr(highlight_generation, "chat_json", chat)

    result = highlight_generation.rank_highlights(transcript, 60.0)

    assert result["method"] == "ai"
    assert result["provider"] == "ollama"
    assert result["model"] == "qwen"
    assert result["candidates"][0]["score"] == 0.91
    assert "TRANSCRIPT" in chat.call_args.args[1]


def test_run_highlight_generation_writes_manifest_and_video(monkeypatch, tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"source")
    output = tmp_path / "job"
    transcript = {"text": "A strong moment", "segments": [], "language": "en"}

    monkeypatch.setattr(highlight_generation, "probe_media", lambda _path: Mock(duration_seconds=90.0))
    monkeypatch.setattr(highlight_generation, "transcribe_video_in_chunks", lambda _path, _duration, _emit_log: transcript)
    monkeypatch.setattr(
        highlight_generation,
        "rank_highlights",
        lambda *_args, **_kwargs: {"method": "ai", "provider": "ollama", "model": "qwen", "candidates": [{"start": 5, "end": 20, "score": 0.9, "reason": "payoff", "text": "A strong moment"}]},
    )
    monkeypatch.setattr(highlight_generation, "render_highlight_reel", lambda *_args, **_kwargs: (output / "highlights.mp4").write_bytes(b"video"))

    logs = []
    result = highlight_generation.run_highlight_generation(
        {"id": "job-1", "source_path": str(source), "output_dir": str(output), "min_minutes": 0.1, "ideal_minutes": 0.2},
        logs.append,
    )

    assert result["video_url"] == "/videos/job-1/highlights.mp4"
    assert result["manifest_url"] == "/videos/job-1/manifest.json"
    assert result["duration_seconds"] == 15.0
    assert (output / "highlights.mp4").is_file()
    assert (output / "manifest.json").is_file()
    assert any("Transcribing" in message for message in logs)


def test_run_highlight_generation_requires_ai_candidates(monkeypatch, tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"source")
    monkeypatch.setattr(highlight_generation, "probe_media", lambda _path: Mock(duration_seconds=60.0))
    monkeypatch.setattr(highlight_generation, "transcribe_video_in_chunks", lambda _path, _duration, _emit_log: {"text": "", "segments": []})
    monkeypatch.setattr(highlight_generation, "rank_highlights", lambda *_args, **_kwargs: {"method": "ai", "candidates": []})

    with pytest.raises(ValueError, match="no usable highlight candidates"):
        highlight_generation.run_highlight_generation(
            {"id": "job-1", "source_path": str(source), "output_dir": str(tmp_path / "job")},
            lambda _message: None,
        )


def test_rank_highlights_chunks_oversized_transcripts(monkeypatch):
    config = Mock(normalized_provider=lambda: "ollama", analyze_model="qwen", is_gemini=lambda: False)
    monkeypatch.setattr(highlight_generation, "load_ai_config", lambda _headers=None: config)
    chat = Mock(side_effect=lambda _config, prompt, **_kwargs: {"highlights": [{"start": 0, "end": 20, "score": 0.9, "reason": "strong"}]})
    monkeypatch.setattr(highlight_generation, "chat_json", chat)
    transcript = {
        "text": "",
        "segments": [
            {"text": "segment " + ("x" * 12000), "start": index * 30, "end": index * 30 + 20, "words": []}
            for index in range(8)
        ],
    }

    result = highlight_generation.rank_highlights(transcript, 240.0)

    assert len(result["candidates"]) == chat.call_count
    assert chat.call_count > 1
    assert all(len(call.args[1]) <= highlight_generation.MAX_PROMPT_CHARS for call in chat.call_args_list)
