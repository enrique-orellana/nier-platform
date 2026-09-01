import json
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
    monkeypatch.setattr(main, "load_ai_config", lambda: _config())

    def fake_chat_json(_config, prompt, **_kwargs):
        prompts.append(prompt)
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
