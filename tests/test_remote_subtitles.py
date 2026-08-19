from unittest.mock import Mock

import ai_client
import highlight_generation
import media_probe
import saasshorts
import subtitles


def test_subtitle_transcription_uses_remote_provider_without_local_whisper(monkeypatch, tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"source")
    config = Mock(transcription_provider="openrouter")
    transcript = {"text": "Remote text", "segments": [], "language": "en"}
    headers = {"X-AI-Transcription-Provider": "openrouter"}
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
    config = Mock(transcription_provider="openrouter")
    transcribe = Mock(return_value={"text": "Remote text", "segments": [], "language": "en"})

    monkeypatch.setattr(ai_client, "load_ai_config", lambda _headers=None: config)
    monkeypatch.setattr(media_probe, "probe_media", lambda _path: Mock(duration_seconds=42.0))
    monkeypatch.setattr(highlight_generation, "transcribe_video_with_config", transcribe)

    subtitles.transcribe_audio(
        source,
        headers={"X-AI-Transcription-Provider": "openrouter"},
        start_seconds=10.0,
        end_seconds=18.5,
    )

    transcribe.assert_called_once_with(
        source,
        42.0,
        headers={"X-AI-Transcription-Provider": "openrouter"},
        start_seconds=10.0,
        end_seconds=18.5,
    )


def test_saas_subtitles_use_remote_provider_without_local_whisper(monkeypatch, tmp_path):
    audio = tmp_path / "voice.mp3"
    audio.write_bytes(b"audio")
    monkeypatch.setattr(saasshorts, "load_ai_config", lambda _headers=None: Mock(transcription_provider="openrouter"))
    monkeypatch.setattr(
        saasshorts,
        "transcribe_audio_openrouter",
        lambda _path, _config: {
            "segments": [{"start": 0.0, "end": 2.0, "text": "Remote subtitle words", "words": []}],
        },
    )

    words = saasshorts.transcribe_audio_for_subs(str(audio), headers={"X-AI-Transcription-Provider": "openrouter"})

    assert [word["word"] for word in words] == ["Remote", "subtitle", "words"]
    assert words[-1]["end"] == 2.0
