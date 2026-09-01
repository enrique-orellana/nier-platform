from pathlib import Path
from unittest.mock import Mock

import pytest

import highlight_generation


def test_plan_transcription_chunks_bounds_long_sources():
    chunks = highlight_generation.plan_transcription_chunks(1200.0, chunk_seconds=600.0, overlap_seconds=10.0)

    assert chunks == [(0.0, 600.0), (590.0, 1190.0), (1180.0, 1200.0)]


def test_transcribe_video_with_config_uses_openrouter_audio_provider(monkeypatch, tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"source")
    config = Mock()
    monkeypatch.setattr(highlight_generation, "load_ai_config", lambda _headers=None: config)
    monkeypatch.setattr(highlight_generation, "_extract_openrouter_audio_chunk", lambda _source, _start, _end, destination: destination.write_bytes(b"audio"))
    transcribe = Mock(return_value={
        "text": "Cloud text",
        "language": "en",
        "segments": [{
            "start": 1,
            "end": 4,
            "text": "Cloud text",
            "words": [{"word": "Cloud", "start": 1, "end": 2}, {"word": "text", "start": 2, "end": 4}],
        }],
    })
    monkeypatch.setattr(highlight_generation, "transcribe_audio_openrouter", transcribe)

    result = highlight_generation.transcribe_video_with_config(source, 20.0, headers={"X-AI-Provider": "openrouter"})

    assert result["text"] == "Cloud text"
    assert result["segments"] == [{
        "text": "Cloud text",
        "start": 1.0,
        "end": 4.0,
        "words": [{"word": "Cloud", "start": 1.0, "end": 2.0}, {"word": "text", "start": 2.0, "end": 4.0}],
    }]


def test_openrouter_transcription_uses_single_chunk_for_source_shorter_than_window(monkeypatch, tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"source")
    config = Mock()
    monkeypatch.setattr(highlight_generation, "load_ai_config", lambda _headers=None: config)
    extracted = []

    def extract_chunk(_source, start, end, destination):
        extracted.append((start, end))
        destination.write_bytes(b"audio")

    monkeypatch.setattr(highlight_generation, "_extract_openrouter_audio_chunk", extract_chunk)
    monkeypatch.setattr(
        highlight_generation,
        "transcribe_audio_openrouter",
        lambda *_args: {
            "text": "Cloud text",
            "language": "en",
            "segments": [{"start": 0, "end": 1, "text": "Cloud text"}],
        },
    )

    result = highlight_generation.transcribe_video_with_config(source, 20.0, headers={"X-AI-Provider": "openrouter"})

    assert result["text"] == "Cloud text"
    assert extracted == [(0.0, 20.0)]


def test_openrouter_transcription_uses_selected_clip_range(monkeypatch, tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"source")
    config = Mock()
    monkeypatch.setattr(highlight_generation, "load_ai_config", lambda _headers=None: config)
    extracted = []

    def extract_chunk(_source, start, end, destination):
        extracted.append((start, end))
        destination.write_bytes(b"audio")

    monkeypatch.setattr(highlight_generation, "_extract_openrouter_audio_chunk", extract_chunk)
    monkeypatch.setattr(
        highlight_generation,
        "transcribe_audio_openrouter",
        lambda *_args: {
            "text": "Clip text",
            "language": "en",
            "segments": [{
                "start": 0.5,
                "end": 1.5,
                "text": "Clip text",
                "words": [{"word": "Clip", "start": 0.5, "end": 1.0}],
            }],
        },
    )

    result = highlight_generation.transcribe_video_with_config(
        source,
        100.0,
        start_seconds=12.5,
        end_seconds=20.75,
        headers={"X-AI-Provider": "openrouter"},
    )

    assert extracted == [(12.5, 20.75)]
    assert result["segments"] == [{
        "text": "Clip text",
        "start": 0.5,
        "end": 1.5,
        "words": [{"word": "Clip", "start": 0.5, "end": 1.0}],
    }]


def test_openrouter_transcription_reports_failed_chunk(monkeypatch, tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"source")
    config = Mock()
    monkeypatch.setattr(highlight_generation, "load_ai_config", lambda _headers=None: config)
    monkeypatch.setattr(
        highlight_generation,
        "_extract_openrouter_audio_chunk",
        lambda _source, _start, _end, destination: destination.write_bytes(b"audio"),
    )
    monkeypatch.setattr(
        highlight_generation,
        "transcribe_audio_openrouter",
        Mock(side_effect=RuntimeError("could not connect to OpenRouter")),
    )

    with pytest.raises(RuntimeError, match=r"OpenRouter transcription failed for chunk 1/1.*could not connect"):
        highlight_generation.transcribe_video_with_config(source, 20.0, headers={"X-AI-Provider": "openrouter"})


def test_openrouter_transcription_uses_short_overlapping_chunks(monkeypatch, tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"source")
    config = Mock()
    monkeypatch.setattr(highlight_generation, "load_ai_config", lambda _headers=None: config)
    extracted = []

    def extract_chunk(_source, start, end, destination):
        extracted.append((start, end, destination.suffix))
        destination.write_bytes(b"audio")

    monkeypatch.setattr(highlight_generation, "_extract_openrouter_audio_chunk", extract_chunk)
    monkeypatch.setattr(
        highlight_generation,
        "transcribe_audio_openrouter",
        lambda *_args: {
            "text": "Cloud text",
            "language": "en",
            "segments": [{"start": 0, "end": 1, "text": "Cloud text"}],
        },
    )

    result = highlight_generation.transcribe_video_with_config(
        source,
        1200.0,
        headers={"X-AI-Provider": "openrouter"},
    )

    assert result["text"] == " ".join(["Cloud text"] * 48)
    assert extracted == [
        *[(float(start), float(start + 30), ".mp3") for start in range(0, 1175, 25)],
        (1175.0, 1200.0, ".mp3"),
    ]


def test_extract_openrouter_audio_chunk_uses_compressed_mono_speech_audio(monkeypatch, tmp_path):
    commands = []
    monkeypatch.setattr(highlight_generation, "_run_ffmpeg", lambda command: commands.append(command))

    destination = tmp_path / "chunk.mp3"
    highlight_generation._extract_openrouter_audio_chunk(tmp_path / "source.mp4", 5.0, 65.0, destination)

    assert commands == [[
        "ffmpeg", "-y", "-ss", "5.000", "-i", str(tmp_path / "source.mp4"),
        "-t", "60.000", "-vn", "-ac", "1", "-ar", "16000",
        "-c:a", "libmp3lame", "-b:a", "32k", str(destination),
    ]]


def test_merge_transcript_segments_removes_duplicate_overlap_segments():
    segments = highlight_generation.merge_transcript_segments([
        {"text": "The important point.", "start": 290.0, "end": 299.0, "words": []},
        {"text": "The important point.", "start": 295.0, "end": 299.0, "words": []},
        {"text": "The next point.", "start": 299.0, "end": 304.0, "words": []},
    ])

    assert [segment["text"] for segment in segments] == ["The important point.", "The next point."]


def test_rank_highlights_uses_existing_ai_configuration(monkeypatch):
    transcript = {
        "text": "A useful explanation with a complete payoff.",
        "segments": [
            {"text": "A useful explanation with a complete payoff.", "start": 10.0, "end": 30.0, "words": []}
        ],
        "language": "en",
    }
    config = Mock(normalized_provider=lambda: "ollama", analyze_model="qwen", is_gemini=lambda: False)
    monkeypatch.setattr(highlight_generation, "load_ai_config", lambda _headers=None: config)
    chat = Mock(return_value={"highlights": [{"start": 10, "end": 30, "score": 0.91, "reason": "clear payoff"}]})
    monkeypatch.setattr(highlight_generation, "chat_json", chat)
    logs = []

    result = highlight_generation.rank_highlights(transcript, 60.0, emit_log=logs.append)

    assert result["method"] == "ai"
    assert result["provider"] == "ollama"
    assert result["model"] == "qwen"
    assert result["candidates"][0]["score"] == 0.91
    assert "TIMESTAMPED_TRANSCRIPT" in chat.call_args.args[1]
    assert chat.call_args.kwargs["timeout"] == highlight_generation.HIGHLIGHT_ANALYSIS_TIMEOUT_SECONDS
    assert logs[0] == "AI analysis provider=ollama model=qwen; transcript_chunks=1"
    assert logs[1].startswith("AI analysis window 1/1 core=0.000-60.000 context=0.000-60.000 units=")
    assert logs[2].startswith("AI analysis window 1/1 completed in ")
    assert logs[2].endswith("; candidates=1")


def test_run_highlight_generation_writes_manifest_and_video(monkeypatch, tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"source")
    output = tmp_path / "job"
    transcript = {"text": "A strong moment", "segments": [], "language": "en"}

    monkeypatch.setattr(highlight_generation, "probe_media", lambda _path: Mock(duration_seconds=90.0))
    monkeypatch.setattr(highlight_generation, "transcribe_video_with_config", lambda _path, _duration, _emit_log, **_kwargs: transcript)
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
    monkeypatch.setattr(highlight_generation, "transcribe_video_with_config", lambda _path, _duration, _emit_log, **_kwargs: {"text": "", "segments": []})
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
            {"text": "segment " + ("x" * 5000), "start": index * 30, "end": index * 30 + 20, "words": []}
            for index in range(8)
        ],
    }

    result = highlight_generation.rank_highlights(transcript, 240.0)

    assert len(result["candidates"]) == 1
    assert chat.call_count > 1
    assert all(len(call.args[1]) <= highlight_generation.MAX_PROMPT_CHARS for call in chat.call_args_list)
    assert result["analysis"]["incomplete"] is False


def test_analysis_windows_preserve_complete_segments_and_word_data():
    transcript = {
        "segments": [
            {
                "text": "segment " + ("x" * 5000),
                "start": index * 30,
                "end": index * 30 + 20,
                "words": [{"word": "segment", "start": index * 30, "end": index * 30 + 1}],
            }
            for index in range(8)
        ],
    }

    chunks = highlight_generation._analysis_chunks(transcript)

    assert len(chunks) > 1
    assert all("transcript" in chunk for chunk in chunks)
    assert all(chunk["transcript"]["segments"] for chunk in chunks)
    assert all(chunk["transcript"]["words"] for chunk in chunks)
    assert chunks[0]["transcript"]["segments"][0][3].startswith("segment ")


def test_rank_highlights_uses_overlapping_word_windows_and_resolves_bounds(monkeypatch):
    config = Mock(normalized_provider=lambda: "ollama", analyze_model="qwen", is_gemini=lambda: False)
    monkeypatch.setattr(highlight_generation, "load_ai_config", lambda _headers=None: config)
    prompts = []

    def fake_chat_json(_config, prompt, **_kwargs):
        prompts.append(prompt)
        return {
            "highlights": [{
                "start_word_id": 2,
                "end_word_id": 5,
                "start": 0,
                "end": 0,
                "score": 0.91,
                "reason": "boundary-safe candidate",
                "text": "A complete moment",
            }]
        }

    monkeypatch.setattr(highlight_generation, "chat_json", fake_chat_json)
    segments = []
    for index in range(12):
        start = index * 20
        segments.append({
            "start": start,
            "end": start + 20,
            "text": "complete segment",
            "words": [
                {"word": f"w{index}-a", "start": start, "end": start + 10},
                {"word": f"w{index}-b", "start": start + 10, "end": start + 20},
            ],
        })
    segments[0]["words"] = [
        {"word": "before", "start": 0, "end": 10},
        {"word": "before2", "start": 10, "end": 20},
    ]
    segments[1]["words"] = [
        {"word": "hook", "start": 20, "end": 30},
        {"word": "middle", "start": 30, "end": 40},
    ]
    segments[2]["words"] = [
        {"word": "payoff", "start": 40, "end": 50},
        {"word": "end", "start": 50, "end": 59},
    ]

    result = highlight_generation.rank_highlights(
        {"text": "", "segments": segments},
        240.0,
    )

    assert len(prompts) > 1
    assert all("core_start" in prompt for prompt in prompts)
    assert result["candidates"][0]["start"] == 20.0
    assert result["candidates"][0]["end"] == 59.0
    assert result["candidates"][0]["bounds_source"] == "canonical_unit"


def test_rank_highlights_retries_a_failed_window_and_reports_coverage(monkeypatch):
    config = Mock(normalized_provider=lambda: "ollama", analyze_model="qwen", is_gemini=lambda: False)
    monkeypatch.setattr(highlight_generation, "load_ai_config", lambda _headers=None: config)
    chat = Mock(side_effect=[RuntimeError("temporary"), {"highlights": [{"start": 0, "end": 20, "score": 0.8}]}])
    monkeypatch.setattr(highlight_generation, "chat_json", chat)

    result = highlight_generation.rank_highlights(
        {"text": "A complete segment", "segments": [{"start": 0, "end": 60, "text": "A complete segment"}]},
        60.0,
    )

    assert chat.call_count == 2
    assert result["analysis"]["retried_windows"] == 1
    assert result["analysis"]["failed_windows"] == 0
    assert result["analysis"]["incomplete"] is False
    assert result["candidates"][0]["start"] == 0.0
