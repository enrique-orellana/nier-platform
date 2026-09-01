import json
from pathlib import Path
from types import SimpleNamespace

import main


def _config():
    return SimpleNamespace(
        normalized_provider=lambda: "openai-codex",
        is_gemini=lambda: False,
        is_lmstudio=lambda: False,
        api_key=None,
        analyze_model="gpt-test",
        text_model="gpt-test",
        analyze_reasoning_effort=None,
    )


def test_full_timeline_clip_prompt_requires_complete_absolute_timestamp_review():
    prompt = main.build_full_timeline_clip_prompt(
        video_duration=1201.615,
        target_clips=6,
        source_context='{"topic":"demo"}',
        timestamp_mode="word",
    )

    assert "FULL_SOURCE_RANGE_SECONDS: 0.000-1201.615" in prompt
    assert "TIMESTAMP_MODE: word" in prompt
    assert "review the complete attached transcript" in prompt.lower()
    assert "start_word_id" in prompt
    assert "end_word_id" in prompt
    assert "coverage" in prompt
    assert "WINDOW_CORE_AND_CONTEXT_SECONDS" not in prompt
    assert "chunk index" not in prompt.lower()
    assert "overlap seconds" not in prompt.lower()


def test_get_viral_clips_uses_one_complete_file_without_windowed_analysis(monkeypatch):
    monkeypatch.setenv("OPENAI_CLIP_ANALYSIS_MODE", "file")
    monkeypatch.setenv("OPENAI_API_KEY", "server-key")
    monkeypatch.setenv("OPENAI_ANALYZE_MODEL", "public-model")
    monkeypatch.setenv("OPENAI_FILE_ANALYSIS_MAX_TOKENS", "100000")
    monkeypatch.setattr(main, "load_ai_config", lambda: _config())
    artifacts = []

    def fake_file_analysis(file_path, prompt, **kwargs):
        path = Path(file_path)
        records = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
        artifacts.append({"records": records, "prompt": prompt, "kwargs": kwargs})
        return {
            "coverage": {
                "complete": True,
                "start": 0,
                "end": 240,
                "units_reviewed": 24,
            },
            "shorts": [{
                "start_word_id": 8,
                "end_word_id": 11,
                "start": 80.25,
                "end": 119.75,
                "score": 0.95,
                "video_title_for_youtube_short": "Complete file moment",
            }],
        }

    monkeypatch.setattr(main, "openai_file_analysis_json", fake_file_analysis)

    def fail_windowed_analysis(*_args, **_kwargs):
        raise AssertionError("windowed analysis should not run in file mode")

    monkeypatch.setattr(main, "chat_json", fail_windowed_analysis)
    transcript = {
        "segments": [
            {
                "start": index * 20,
                "end": index * 20 + 20,
                "text": f"complete segment {index}",
                "words": [
                    {"word": f"a{index}", "start": index * 20, "end": index * 20 + 10},
                    {"word": f"b{index}", "start": index * 20 + 10, "end": index * 20 + 20},
                ],
            }
            for index in range(12)
        ]
    }

    result = main.get_viral_clips(transcript, 240.0, target_clips=2)

    assert len(artifacts) == 1
    assert len(artifacts[0]["records"]) == len(transcript["segments"])
    assert artifacts[0]["kwargs"] == {
        "model": "public-model",
        "api_key": "server-key",
        "base_url": "https://api.openai.com/v1",
    }
    assert "FULL_SOURCE_RANGE_SECONDS: 0.000-240.000" in artifacts[0]["prompt"]
    assert result["shorts"][0]["start"] == 80.0
    assert result["shorts"][0]["end"] == 120.0
    assert result["shorts"][0]["bounds_source"] == "canonical_unit"
    assert result["analysis"]["mode"] == "openai_file"
    assert result["analysis"]["coverage"]["complete"] is True
    assert result["analysis"]["artifact"]["record_count"] == 12
    assert result["analysis"]["planned_windows"] == 0


def test_get_viral_clips_uses_codex_connection_for_complete_file_without_api_key(monkeypatch):
    monkeypatch.setenv("OPENAI_CLIP_ANALYSIS_MODE", "file")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(main, "load_ai_config", lambda: _config())
    calls = []

    def fake_codex_file_analysis(file_path, prompt, **kwargs):
        calls.append({
            "records": [
                json.loads(line)
                for line in Path(file_path).read_text(encoding="utf-8").splitlines()
            ],
            "prompt": prompt,
            "kwargs": kwargs,
        })
        return {
            "coverage": {"complete": True, "start": 0, "end": 60},
            "shorts": [{
                "start_word_id": 0,
                "end_word_id": 1,
                "start": 0,
                "end": 20,
                "score": 0.95,
                "video_title_for_youtube_short": "Codex connection moment",
            }],
        }

    monkeypatch.setattr(main, "codex_file_analysis_json", fake_codex_file_analysis)
    monkeypatch.setattr(
        main,
        "openai_file_analysis_json",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("public OpenAI Files API must not be required")
        ),
    )
    monkeypatch.setattr(
        main,
        "chat_json",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("windowed analysis should not run in file mode")
        ),
    )

    result = main.get_viral_clips(
        {
            "segments": [{
                "start": 0,
                "end": 60,
                "text": "complete Codex transcript",
                "words": [
                    {"word": "complete", "start": 0, "end": 10},
                    {"word": "transcript", "start": 10, "end": 20},
                ],
            }]
        },
        60.0,
        target_clips=2,
    )

    assert len(calls) == 1
    assert len(calls[0]["records"]) == 1
    assert calls[0]["kwargs"] == {
        "model": "gpt-test",
        "reasoning_effort": None,
    }
    assert result["shorts"][0]["bounds_source"] == "canonical_unit"
    assert result["analysis"]["mode"] == "codex_file"


def test_auto_file_analysis_failure_falls_back_to_lossless_windows(monkeypatch):
    monkeypatch.setenv("OPENAI_CLIP_ANALYSIS_MODE", "auto")
    monkeypatch.setenv("OPENAI_API_KEY", "server-key")
    monkeypatch.setattr(main, "load_ai_config", lambda: _config())
    file_calls = []
    window_prompts = []

    def fail_file_analysis(*_args, **_kwargs):
        file_calls.append(True)
        raise RuntimeError("OpenAI analysis failed with HTTP 413.")

    def fake_chat_json(_config, prompt, **_kwargs):
        window_prompts.append(prompt)
        return {
            "shorts": [{
                "start": 20.0,
                "end": 40.0,
                "score": 0.8,
                "video_title_for_youtube_short": "Fallback moment",
            }]
        }

    monkeypatch.setattr(main, "openai_file_analysis_json", fail_file_analysis)
    monkeypatch.setattr(main, "chat_json", fake_chat_json)
    transcript = {
        "segments": [
            {"start": index * 20, "end": index * 20 + 20, "text": f"segment {index}"}
            for index in range(6)
        ]
    }

    result = main.get_viral_clips(transcript, 120.0, target_clips=2)

    assert file_calls == [True]
    assert window_prompts
    assert result["analysis"]["mode"] == "windowed_fallback"
    assert "HTTP 413" in result["analysis"]["fallback_reason"]
    assert result["analysis"]["planned_windows"] > 0


def test_file_mode_failure_returns_incomplete_result_without_windowed_retry(monkeypatch):
    monkeypatch.setenv("OPENAI_CLIP_ANALYSIS_MODE", "file")
    monkeypatch.setenv("OPENAI_API_KEY", "server-key")
    monkeypatch.setattr(main, "load_ai_config", lambda: _config())
    monkeypatch.setattr(
        main,
        "openai_file_analysis_json",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            RuntimeError("OpenAI analysis failed with HTTP 500.")
        ),
    )

    def fail_windowed_analysis(*_args, **_kwargs):
        raise AssertionError("file mode must not silently switch to windows")

    monkeypatch.setattr(main, "chat_json", fail_windowed_analysis)
    transcript = {
        "segments": [{"start": 0, "end": 60, "text": "A complete segment."}]
    }

    result = main.get_viral_clips(transcript, 60.0, target_clips=2)

    assert result["analysis"]["mode"] == "openai_file"
    assert result["analysis"]["incomplete"] is True
    assert "HTTP 500" in result["analysis"]["error"]


def test_clip_analysis_chunks_use_timestamped_segments_without_word_data():
    transcript = {
        "segments": [
            {
                "start": index * 10,
                "end": index * 10 + 8,
                "text": "segment " + ("x" * 2500),
                "words": [{"word": "segment", "start": index * 10, "end": index * 10 + 1}],
            }
            for index in range(12)
        ]
    }

    chunks = main._clip_analysis_chunks(transcript)

    assert len(chunks) > 1
    assert all("transcript" in chunk for chunk in chunks)
    assert all(
        len(json.dumps(chunk["transcript"], ensure_ascii=False)) <= main.CLIP_ANALYSIS_MAX_PROMPT_CHARS
        for chunk in chunks
    )
    assert chunks[0]["transcript"]["segments"][0] == [
        0,
        0.0,
        8.0,
        "segment " + ("x" * 2500),
        [0],
    ]
    assert chunks[0]["transcript"]["words"][0][3] == "segment"


def test_snap_clip_boundaries_to_local_word_timestamps():
    transcript = {
        "segments": [
            {
                "words": [
                    {"word": "hello", "start": 12.10, "end": 12.45},
                    {"word": "everyone", "start": 12.46, "end": 12.90},
                    {"word": "today", "start": 37.50, "end": 38.05},
                ]
            }
        ]
    }

    result = main._snap_clip_boundaries(
        {"start": 12.34, "end": 37.89},
        transcript,
        60.0,
    )

    assert result["start"] == 12.10
    assert result["end"] == 38.05


def test_get_viral_clips_sends_bounded_compact_prompts(monkeypatch):
    prompts = []
    timeouts = []
    monkeypatch.setattr(main, "load_ai_config", lambda: _config())

    def fake_chat_json(_config, prompt, **kwargs):
        prompts.append(prompt)
        timeouts.append(kwargs.get("timeout"))
        return {
            "shorts": [
                {
                    "start": 20.34,
                    "end": 37.89,
                    "score": 0.8,
                    "video_title_for_youtube_short": "Moment",
                }
            ]
        }

    monkeypatch.setattr(main, "chat_json", fake_chat_json)
    transcript = {
        "text": "",
        "segments": [
            {
                "start": index * 20,
                "end": index * 20 + 18,
                "text": "segment " + ("x" * 2500),
                "words": [
                    {"word": "segment", "start": index * 20, "end": index * 20 + 1}
                ],
            }
            for index in range(12)
        ],
    }

    result = main.get_viral_clips(transcript, 240.0, target_clips=2)

    assert len(prompts) > 1
    assert all(len(prompt) <= main.CLIP_ANALYSIS_MAX_PROMPT_CHARS for prompt in prompts)
    assert all("WORDS_JSON" not in prompt for prompt in prompts)
    assert all("TRANSCRIPT_TEXT" not in prompt for prompt in prompts)
    assert all(timeout == 0.0 for timeout in timeouts)
    assert len(result["shorts"]) == 1
    assert result["shorts"][0]["bounds_source"] == "model_float"
    assert result["analysis"]["planned_windows"] == len(prompts)


def test_get_viral_clips_resolves_boundary_crossing_word_ids_before_global_dedup(monkeypatch):
    prompts = []
    monkeypatch.setattr(main, "load_ai_config", lambda: _config())

    def fake_chat_json(_config, prompt, **_kwargs):
        prompts.append(prompt)
        return {
            "shorts": [{
                "start_word_id": 8,
                "end_word_id": 11,
                "start": 0,
                "end": 0,
                "score": 0.95,
                "video_title_for_youtube_short": "Boundary moment",
            }]
        }

    monkeypatch.setattr(main, "chat_json", fake_chat_json)
    transcript = {
        "segments": [
            {
                "start": index * 20,
                "end": index * 20 + 20,
                "text": f"complete segment {index}",
                "words": [
                    {"word": f"a{index}", "start": index * 20, "end": index * 20 + 10},
                    {"word": f"b{index}", "start": index * 20 + 10, "end": index * 20 + 20},
                ],
            }
            for index in range(12)
        ]
    }

    result = main.get_viral_clips(transcript, 240.0, target_clips=2)

    assert len(prompts) == 3
    assert "start_word_id" in prompts[0]
    assert len(result["shorts"]) == 1
    assert result["shorts"][0]["start"] == 80.0
    assert result["shorts"][0]["end"] == 120.0
    assert result["shorts"][0]["bounds_source"] == "canonical_unit"
    assert result["analysis"]["succeeded_windows"] == 3
