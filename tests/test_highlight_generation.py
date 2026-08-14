from pathlib import Path
from unittest.mock import Mock

import pytest

import highlight_generation


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
    monkeypatch.setattr(highlight_generation, "transcribe_video", lambda _path: transcript)
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
    monkeypatch.setattr(highlight_generation, "transcribe_video", lambda _path: {"text": "", "segments": []})
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
