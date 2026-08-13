from types import SimpleNamespace

import main
from ai_client import AIConfig


def test_fetch_source_metadata_is_metadata_only_and_sanitized(monkeypatch):
    calls = {}

    class FakeYoutubeDL:
        def __init__(self, options):
            calls["options"] = options

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def extract_info(self, url, download):
            calls["extract"] = (url, download)
            return {
                "extractor_key": "Twitch",
                "id": "2842570758",
                "title": "A live event",
                "channel": "Streamer",
                "uploader": "uploader-fallback",
                "description": "A" * 5000,
                "upload_date": "20260813",
                "categories": ["Gaming"],
                "tags": [f"tag-{i}" for i in range(100)],
                "view_count": 123,
                "duration": 321.5,
                "thumbnail": "https://cdn.example/thumb.jpg",
                "webpage_url": "https://www.twitch.tv/videos/2842570758",
                "secret_cookie": "must-not-persist",
            }

    monkeypatch.setattr(main, "yt_dlp", SimpleNamespace(YoutubeDL=FakeYoutubeDL))

    result = main.fetch_source_metadata("https://www.twitch.tv/videos/2842570758")

    assert calls["extract"] == ("https://www.twitch.tv/videos/2842570758", False)
    assert calls["options"]["skip_download"] is True
    assert calls["options"]["noplaylist"] is True
    assert "secret_cookie" not in result
    assert result["platform"] == "twitch"
    assert result["channel"] == "Streamer"
    assert len(result["description"]) < 5000
    assert len(result["tags"]) <= 20


def test_collect_source_context_synthesizes_structured_context(monkeypatch):
    source_metadata = {
        "platform": "twitch",
        "title": "A live event",
        "channel": "Streamer",
        "description": "Streamer discusses the launch event in Rome.",
    }
    seen = {}

    monkeypatch.setattr(main, "load_ai_config", lambda: AIConfig(provider="lmstudio", base_url="http://lmstudio.test"))

    def fake_chat_json(config, prompt, **kwargs):
        seen["prompt"] = prompt
        return {
            "who": ["Streamer"],
            "what": "Discusses the launch event",
            "where": "Rome",
            "when": "",
            "entities": ["launch event"],
            "source_summary": "Streamer discusses a launch event in Rome.",
            "confidence": "high",
        }

    monkeypatch.setattr(main, "chat_json", fake_chat_json)

    result = main.collect_source_context(
        "https://www.twitch.tv/videos/2842570758",
        source_metadata,
        {"text": "We are discussing the launch event in Rome.", "segments": []},
    )

    assert result["source_context_status"] == "available"
    assert result["source_context"]["who"] == ["Streamer"]
    assert result["source_context"]["where"] == "Rome"
    assert "A live event" in seen["prompt"]
    assert "Do not invent" in seen["prompt"]


def test_collect_source_context_keeps_generation_best_effort(monkeypatch):
    monkeypatch.setattr(main, "synthesize_source_context", lambda *_args, **_kwargs: (_ for _ in ()).throw(ValueError("provider unavailable")))

    result = main.collect_source_context(
        "https://www.youtube.com/watch?v=source123",
        {"platform": "youtube", "title": "Original"},
        {"text": "Transcript", "segments": []},
    )

    assert result["source_context_status"] == "synthesis_unavailable"
    assert result["source_metadata"]["title"] == "Original"
    assert "provider unavailable" in result["source_context_error"]


def test_prepare_source_context_keeps_metadata_lookup_failure_non_fatal(monkeypatch):
    monkeypatch.setattr(main, "fetch_source_metadata", lambda *_args: (_ for _ in ()).throw(RuntimeError("source unavailable")))

    result = main.prepare_source_context(
        "https://www.twitch.tv/videos/2842570758",
        {"text": "Transcript", "segments": []},
    )

    assert result["source_context_status"] == "metadata_unavailable"
    assert result["source_metadata"] is None
    assert result["source_context"] is None
    assert "source unavailable" in result["source_context_error"]


def test_clip_planning_prompt_includes_source_context(monkeypatch):
    seen = {}
    monkeypatch.setattr(main, "load_ai_config", lambda: AIConfig(provider="lmstudio", base_url="http://lmstudio.test"))

    def fake_chat_json(config, prompt, **kwargs):
        seen["prompt"] = prompt
        return {"shorts": [{"start": 0, "end": 20, "video_title_for_youtube_short": "Moment"}]}

    monkeypatch.setattr(main, "chat_json", fake_chat_json)

    main.get_viral_clips(
        {"text": "Transcript", "segments": [{"words": [{"word": "Transcript", "start": 0, "end": 1}]}]},
        30,
        target_clips=3,
        source_context={
            "who": ["Streamer"],
            "what": "Launch event",
            "where": "Rome",
            "source_summary": "Streamer discusses a launch event in Rome.",
            "confidence": "high",
        },
    )

    assert "ORIGINAL SOURCE CONTEXT" in seen["prompt"]
    assert "Streamer" in seen["prompt"]
    assert "Launch event" in seen["prompt"]
    assert "Do not invent" in seen["prompt"]
