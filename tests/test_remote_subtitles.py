from unittest.mock import Mock

import openshorts.ai.ai_client as ai_client
import openshorts.analysis.highlight_generation as highlight_generation
import openshorts.rendering.media_probe as media_probe
import openshorts.subtitles.subtitles as subtitles


def test_subtitle_transcription_uses_remote_provider(monkeypatch, tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"source")
    config = Mock()
    transcript = {"text": "Remote text", "segments": [], "language": "en"}
    headers = {"X-AI-Transcription-Language": "en"}
    transcribe = Mock(return_value=transcript)

    monkeypatch.setattr(ai_client, "load_ai_config", lambda _headers=None: config)
    monkeypatch.setattr(media_probe, "probe_media", lambda _path: Mock(duration_seconds=42.0))
    monkeypatch.setattr(highlight_generation, "transcribe_video_with_config", transcribe)

    result = subtitles.transcribe_audio(source, headers=headers)

    assert result == transcript
    transcribe.assert_called_once_with(source, 42.0, headers=headers)


def test_subtitle_transcription_forwards_clip_range(monkeypatch, tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"source")
    config = Mock()
    transcribe = Mock(return_value={"text": "Remote text", "segments": [], "language": "en"})

    monkeypatch.setattr(ai_client, "load_ai_config", lambda _headers=None: config)
    monkeypatch.setattr(media_probe, "probe_media", lambda _path: Mock(duration_seconds=42.0))
    monkeypatch.setattr(highlight_generation, "transcribe_video_with_config", transcribe)

    subtitles.transcribe_audio(
        source,
        headers={"X-AI-Transcription-Language": "en"},
        start_seconds=10.0,
        end_seconds=18.5,
    )

    transcribe.assert_called_once_with(
        source,
        42.0,
        headers={"X-AI-Transcription-Language": "en"},
        start_seconds=10.0,
        end_seconds=18.5,
    )
