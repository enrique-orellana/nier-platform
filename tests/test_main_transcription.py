from unittest.mock import Mock


def test_clip_generator_uses_configured_openrouter_transcription(monkeypatch, tmp_path):
    import main

    config = Mock(transcription_provider="openrouter")
    transcript = {"text": "Cloud text", "segments": [], "language": "en"}
    monkeypatch.setattr(main, "load_ai_config", lambda _headers=None: config)
    transcribe = Mock(return_value=transcript)
    monkeypatch.setattr(main, "transcribe_video_with_config", transcribe)

    result = main.transcribe_video(
        tmp_path / "source.mp4",
        duration_seconds=60.0,
        headers={"X-AI-Transcription-Provider": "openrouter"},
    )

    assert result == transcript
    transcribe.assert_called_once()
