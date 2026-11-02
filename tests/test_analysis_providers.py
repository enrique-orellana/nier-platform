from pathlib import Path

import pytest

import analysis_providers as providers


class FakeResponse:
    status_code = 200
    text = "{}"

    def __init__(self, payload):
        self.payload = payload

    def json(self):
        return self.payload

    def raise_for_status(self):
        return None


class RecordingClient:
    def __init__(self, response=None):
        self.response = response or FakeResponse(
            {
                "text": "Ciao mondo",
                "language": "it",
                "segments": [
                    {
                        "start": 0.2,
                        "end": 1.4,
                        "text": "Ciao mondo",
                        "words": [
                            {"word": "Ciao", "start": 0.2, "end": 0.7},
                            {"word": "mondo", "start": 0.8, "end": 1.4},
                        ],
                    }
                ],
            }
        )
        self.requests = []

    def post(self, url, **kwargs):
        self.requests.append((url, kwargs))
        return self.response


def test_transcription_config_uses_explicit_service_settings(monkeypatch):
    monkeypatch.setenv("AI_TRANSCRIPTION_PROVIDER", "openai-compatible")
    monkeypatch.setenv("AI_TRANSCRIPTION_BASE_URL", "http://127.0.0.1:8000/v1")
    monkeypatch.setenv("AI_TRANSCRIPTION_MODEL", "whisper-small")
    monkeypatch.setenv("AI_TRANSCRIPTION_API_KEY", "")
    monkeypatch.setenv("AI_TRANSCRIPTION_LANGUAGE", "it")

    config = providers.load_transcription_config()

    assert config.provider == "openai-compatible"
    assert config.base_url == "http://127.0.0.1:8000/v1"
    assert config.model == "whisper-small"
    assert config.api_key == ""
    assert config.language == "it"


def test_transcription_config_accepts_installed_plugin_settings():
    config = providers.load_transcription_config(
        {
            "AI_TRANSCRIPTION_PROVIDER": "my-asr-plugin",
            "AI_TRANSCRIPTION_BASE_URL": "http://127.0.0.1:8200/custom",
            "AI_TRANSCRIPTION_MODEL": "tiny-local-v2",
            "AI_TRANSCRIPTION_API_KEY": "asr-key",
            "AI_TRANSCRIPTION_LANGUAGE": "es",
        }
    )

    assert config.provider == "my-asr-plugin"
    assert config.base_url == "http://127.0.0.1:8200/custom"
    assert config.model == "tiny-local-v2"
    assert config.api_key == "asr-key"
    assert config.language == "es"


def test_transcription_provider_defaults_to_openrouter_only_for_openrouter_chat():
    config = providers.load_transcription_config({"AI_PROVIDER": "openrouter"})

    assert config.provider == "openrouter-json"
    assert config.base_url == providers.OPENROUTER_TRANSCRIPTION_URL


def test_transcription_config_requires_explicit_provider_for_local_chat():
    with pytest.raises(
        ValueError, match="AI_TRANSCRIPTION_PROVIDER must be set explicitly"
    ):
        providers.load_transcription_config({"AI_PROVIDER": "lmstudio"})


def test_openrouter_transcription_can_use_legacy_ai_key_but_generic_does_not(
    monkeypatch,
):
    monkeypatch.delenv("AI_TRANSCRIPTION_API_KEY", raising=False)
    monkeypatch.setenv("AI_API_KEY", "legacy-key")
    monkeypatch.setenv("AI_PROVIDER", "openrouter")
    monkeypatch.setenv("AI_TRANSCRIPTION_PROVIDER", "openrouter-json")
    assert providers.load_transcription_config().api_key == "legacy-key"

    monkeypatch.setenv("AI_TRANSCRIPTION_PROVIDER", "openai-compatible")
    monkeypatch.setenv("AI_TRANSCRIPTION_BASE_URL", "http://127.0.0.1:8000/v1")
    assert providers.load_transcription_config().api_key == ""


def test_openrouter_transcription_never_reuses_a_local_chat_key(monkeypatch):
    monkeypatch.delenv("AI_TRANSCRIPTION_API_KEY", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    monkeypatch.setenv("AI_PROVIDER", "openai-compatible")
    monkeypatch.setenv("AI_API_KEY", "local-chat-key")
    monkeypatch.setenv("AI_TRANSCRIPTION_PROVIDER", "openrouter-json")

    assert providers.load_transcription_config().api_key == ""


def test_openrouter_transcription_does_not_reuse_an_unrelated_local_chat_key():
    from ai_client import AIConfig

    seen = []
    adapter = providers.OpenRouterJsonTranscriptionProvider(
        providers.TranscriptionConfig(
            provider="openrouter-json",
            base_url="https://openrouter.ai/api/v1",
            model="openai/whisper-large-v3",
        ),
        ai_config=AIConfig(provider="openai-compatible", api_key="local-only-key"),
        transcribe_fn=lambda _path, config: seen.append(config.api_key)
        or {
            "text": "",
            "segments": [],
            "language": "und",
        },
    )

    adapter.transcribe_chunk("clip.mp3")

    assert seen == [""]


def test_openrouter_json_adapter_honors_its_configured_endpoint():
    seen = []

    def transcribe(_path, _config, *, base_url):
        seen.append(base_url)
        return {"text": "", "segments": [], "language": "und"}

    adapter = providers.OpenRouterJsonTranscriptionProvider(
        providers.TranscriptionConfig(
            provider="openrouter-json",
            base_url="http://127.0.0.1:9000/compatible/v1",
            model="whisper-proxy",
        ),
        transcribe_fn=transcribe,
    )

    adapter.transcribe_chunk("clip.mp3")

    assert seen == ["http://127.0.0.1:9000/compatible/v1"]


def test_openai_compatible_transcriber_sends_timestamps_and_normalizes_response(
    tmp_path,
):
    audio_path = tmp_path / "audio.mp3"
    audio_path.write_bytes(b"audio")
    client = RecordingClient()
    config = providers.TranscriptionConfig(
        provider="openai-compatible",
        base_url="http://127.0.0.1:8000/api/v1",
        model="whisper-small",
        api_key="transcription-key",
        language="it",
    )

    result = providers.OpenAICompatibleTranscriptionProvider(
        config, client=client
    ).transcribe_chunk(audio_path)

    url, request = client.requests[0]
    assert url == "http://127.0.0.1:8000/api/v1/audio/transcriptions"
    assert request["headers"]["Authorization"] == "Bearer transcription-key"
    assert request["data"]["model"] == "whisper-small"
    assert request["data"]["language"] == "it"
    assert request["data"]["response_format"] == "verbose_json"
    assert request["data"]["timestamp_granularities[]"] == ["segment", "word"]
    assert result["text"] == "Ciao mondo"
    assert result["segments"][0]["words"][1] == {
        "word": "mondo",
        "start": 0.8,
        "end": 1.4,
    }
    assert result["language"] == "it"


def test_openai_compatible_transcriber_skips_zero_duration_word_timings(tmp_path):
    audio_path = tmp_path / "audio.mp3"
    audio_path.write_bytes(b"audio")
    client = RecordingClient(
        FakeResponse(
            {
                "text": "Ciao mondo ancora",
                "language": "it",
                "segments": [
                    {
                        "start": 0,
                        "end": 1,
                        "text": "Ciao mondo ancora",
                        "words": [
                            {"word": "Ciao", "start": 0.1, "end": 0.3},
                            {"word": "mondo", "start": 0.3, "end": 0.3},
                            {"word": "ancora", "start": 0.4, "end": 0.8},
                        ],
                    }
                ],
            }
        )
    )
    config = providers.TranscriptionConfig(
        provider="openai-compatible",
        base_url="http://127.0.0.1:8000/v1",
        model="whisper-small",
    )

    result = providers.OpenAICompatibleTranscriptionProvider(
        config, client=client
    ).transcribe_chunk(audio_path)

    assert result["segments"][0]["text"] == "Ciao mondo ancora"
    assert result["segments"][0]["words"] == [
        {"word": "Ciao", "start": 0.1, "end": 0.3},
        {"word": "ancora", "start": 0.4, "end": 0.8},
    ]


def test_transcription_response_requires_valid_timestamps():
    with pytest.raises(ValueError, match="valid start and end"):
        providers.normalize_transcription_result(
            {
                "text": "missing timing",
                "segments": [{"text": "missing timing", "start": 2, "end": 1}],
            }
        )


def test_transcription_adapter_preserves_embedded_sound_events():
    result = providers.normalize_transcription_result(
        {
            "text": "Ciao",
            "language": "it",
            "segments": [{"start": 0, "end": 1, "text": "Ciao"}],
            "events": [
                {"start": 0.3, "end": 0.8, "label": "Laughter", "confidence": 0.9}
            ],
        },
        provider="combined-service",
    )

    assert result["events"] == [
        {
            "start": 0.3,
            "end": 0.8,
            "label": "Laughter",
            "confidence": 0.9,
            "source": "combined-service",
        }
    ]


def test_event_normalizer_rejects_missing_confidence():
    with pytest.raises(ValueError, match="invalid timestamps, label, or confidence"):
        providers.normalize_audio_events(
            [{"start": 1, "end": 2, "label": "Applause"}],
            provider="configured-events",
        )


def test_event_service_uses_its_configured_endpoint_and_normalizes_events(tmp_path):
    audio_path = tmp_path / "chunk.wav"
    audio_path.write_bytes(b"audio")
    client = RecordingClient(
        FakeResponse(
            {
                "events": [
                    {"start": 1.2, "end": 2.1, "label": "Laughter", "confidence": 0.91}
                ],
            }
        )
    )
    config = providers.AudioEventConfig(
        provider="openshorts-events-v1",
        base_url="http://127.0.0.1:8100/api/v1",
        model="yamnet-lite",
        api_key="event-key",
        min_confidence=0.35,
    )

    events = providers.OpenShortsEventProvider(config, client=client).detect_events(
        audio_path
    )

    url, request = client.requests[0]
    assert url == "http://127.0.0.1:8100/api/v1/audio/events"
    assert request["headers"]["Authorization"] == "Bearer event-key"
    assert request["data"]["model"] == "yamnet-lite"
    assert events == [
        {
            "start": 1.2,
            "end": 2.1,
            "label": "Laughter",
            "confidence": 0.91,
            "source": "openshorts-events-v1",
        }
    ]


def test_audio_event_configuration_is_explicit_and_validated(monkeypatch):
    monkeypatch.setenv("AUDIO_EVENT_PROVIDER", "none")
    assert providers.load_audio_event_config().provider == "none"

    monkeypatch.setenv("AUDIO_EVENT_PROVIDER", " ")
    with pytest.raises(ValueError, match="AUDIO_EVENT_PROVIDER cannot be empty"):
        providers.load_audio_event_config()

    monkeypatch.setenv("AUDIO_EVENT_PROVIDER", "openshorts-events-v1")
    monkeypatch.setenv("AUDIO_EVENT_BASE_URL", "http://127.0.0.1:8100")
    monkeypatch.delenv("AUDIO_EVENT_MODEL", raising=False)
    with pytest.raises(ValueError, match="AUDIO_EVENT_MODEL"):
        providers.load_audio_event_config()
    monkeypatch.delenv("AUDIO_EVENT_BASE_URL", raising=False)
    with pytest.raises(ValueError, match="AUDIO_EVENT_BASE_URL"):
        providers.load_audio_event_config()


def test_audio_event_config_accepts_installed_plugin_settings():
    config = providers.load_audio_event_config(
        {
            "AUDIO_EVENT_PROVIDER": "my-detector-plugin",
            "AUDIO_EVENT_BASE_URL": "http://127.0.0.1:8300/detect",
            "AUDIO_EVENT_MODEL": "yamnet-quantized",
            "AUDIO_EVENT_API_KEY": "events-key",
            "AUDIO_EVENT_MIN_CONFIDENCE": "0.6",
        }
    )

    assert config.provider == "my-detector-plugin"
    assert config.base_url == "http://127.0.0.1:8300/detect"
    assert config.model == "yamnet-quantized"
    assert config.api_key == "events-key"
    assert config.min_confidence == 0.6


def test_registry_accepts_a_pluggable_provider_factory():
    class ExampleTranscriber(providers.TranscriptionProvider):
        def transcribe_chunk(self, audio_path):
            return {"text": Path(audio_path).name, "segments": [], "language": "und"}

    registry = providers.ProviderRegistry()
    registry.register(
        "transcription", "example", lambda config: ExampleTranscriber(config)
    )
    instance = registry.create("transcription", "example", config={})

    assert isinstance(instance, ExampleTranscriber)
    assert instance.transcribe_chunk("clip.wav")["text"] == "clip.wav"


def test_registry_loads_explicit_installed_provider_plugins(monkeypatch):
    class ExampleTranscriber(providers.TranscriptionProvider):
        def transcribe_chunk(self, _audio_path):
            return {"text": "", "segments": [], "language": "und"}

    class EntryPoint:
        name = "sample-package"

        def load(self):
            return lambda registry: registry.register(
                "transcription",
                "entrypoint-example",
                lambda config: ExampleTranscriber(config),
            )

    class EntryPoints:
        def select(self, *, group):
            assert group == providers.PLUGIN_ENTRY_POINT_GROUP
            return [EntryPoint()]

    monkeypatch.setattr(providers, "entry_points", lambda: EntryPoints())
    registry = providers.ProviderRegistry()

    instance = registry.create("transcription", "entrypoint-example", config={})

    assert isinstance(instance, ExampleTranscriber)


def test_clip_analysis_factory_uses_registered_plugin_provider(monkeypatch):
    from ai_client import AIConfig

    class PluginClipProvider(providers.ClipAnalysisProvider):
        def analyze_json(self, prompt, **_options):
            return {"selected_prompt": prompt}

    registry = providers.ProviderRegistry()
    registry.register(
        "clip_analysis",
        "plugin-clips",
        lambda config: PluginClipProvider(config),
    )
    monkeypatch.setenv("AI_CLIP_ANALYSIS_PROVIDER", "plugin-clips")

    instance = providers.create_clip_analysis_provider(
        AIConfig(provider="openrouter"),
        chat_json_fn=lambda *_args, **_kwargs: {"builtin": True},
        registry=registry,
    )

    assert instance.analyze_json("timeline") == {"selected_prompt": "timeline"}


def test_provider_failure_does_not_try_another_adapter(tmp_path):
    audio_path = tmp_path / "audio.mp3"
    audio_path.write_bytes(b"audio")
    client = RecordingClient(FakeResponse({"error": "service unavailable"}))
    config = providers.TranscriptionConfig(
        provider="openai-compatible",
        base_url="http://127.0.0.1:8000/v1",
        model="whisper-small",
    )

    with pytest.raises(ValueError, match="transcription response"):
        providers.OpenAICompatibleTranscriptionProvider(
            config, client=client
        ).transcribe_chunk(audio_path)
    assert len(client.requests) == 1
