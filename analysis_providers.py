"""Provider contracts and adapters for configurable audio and clip analysis.

The pipeline depends on the small capability interfaces below. Concrete
providers normalize their protocol responses before data leaves the adapter,
so downstream timeline and clip-selection code never needs provider branches.
Third-party packages can register factories with the explicit entry-point
group ``openshorts.analysis_providers``.
"""

from __future__ import annotations

import math
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass, replace
from importlib.metadata import entry_points
from pathlib import Path
from typing import Any, Callable, Mapping
from urllib.parse import urlsplit

import httpx

OPENROUTER_TRANSCRIPTION_URL = "https://openrouter.ai/api/v1"
DEFAULT_TRANSCRIPTION_MODEL = "openai/whisper-large-v3"
PLUGIN_ENTRY_POINT_GROUP = "openshorts.analysis_providers"


class ProviderConfigurationError(ValueError):
    """A selected provider is missing or has invalid configuration."""


class ProviderResponseError(ValueError):
    """A provider response does not meet the shared response contract."""


class AnalysisProvider(ABC):
    """Shared base for adapters; capability interfaces stay intentionally small."""

    def __init__(self, config: Any, *, client: Any = None, timeout: float = 300.0):
        self.config = config
        self._client = client
        self._timeout = timeout

    def _post_file_json(
        self,
        url: str,
        audio_path: str | Path,
        *,
        data: Mapping[str, Any],
        headers: Mapping[str, str],
        stage: str,
    ) -> Any:
        path = Path(audio_path)
        try:
            with path.open("rb") as audio_file:
                files = {"file": (path.name, audio_file, "application/octet-stream")}
                if self._client is not None:
                    response = self._client.post(
                        url, files=files, data=data, headers=dict(headers)
                    )
                else:
                    with httpx.Client(timeout=self._timeout) as client:
                        response = client.post(
                            url, files=files, data=data, headers=dict(headers)
                        )
            response.raise_for_status()
            return response.json()
        except ProviderResponseError:
            raise
        except Exception as exc:
            provider_id = getattr(self.config, "provider", type(self).__name__)
            raise RuntimeError(
                f"{provider_id} {stage} request failed ({type(exc).__name__})"
            ) from exc


class TranscriptionProvider(AnalysisProvider):
    @abstractmethod
    def transcribe_chunk(self, audio_path: str | Path) -> dict[str, Any]:
        """Return normalized, chunk-relative transcript timing."""


class AudioEventProvider(AnalysisProvider):
    @abstractmethod
    def detect_events(
        self,
        audio_path: str | Path,
        *,
        transcript: Mapping[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        """Return normalized, chunk-relative sound-event records."""


class ClipAnalysisProvider(AnalysisProvider):
    @abstractmethod
    def analyze_json(self, prompt: str, **options: Any) -> dict[str, Any]:
        """Analyze a normalized timeline prompt and return a JSON object."""


ProviderFactory = Callable[..., AnalysisProvider]


class ProviderRegistry:
    """Deterministic registry for capability-specific provider factories."""

    _CAPABILITY_TYPES = {
        "transcription": TranscriptionProvider,
        "audio_events": AudioEventProvider,
        "clip_analysis": ClipAnalysisProvider,
    }

    def __init__(self) -> None:
        self._factories: dict[tuple[str, str], ProviderFactory] = {}
        self._plugins_loaded = False

    def register(
        self, capability: str, provider_id: str, factory: ProviderFactory
    ) -> None:
        capability_key = str(capability or "").strip().lower()
        provider_key = str(provider_id or "").strip().lower()
        if capability_key not in self._CAPABILITY_TYPES:
            raise ProviderConfigurationError(
                f"Unsupported provider capability: {capability}"
            )
        if not provider_key:
            raise ProviderConfigurationError("Provider ID cannot be empty")
        if not callable(factory):
            raise ProviderConfigurationError("Provider factory must be callable")
        key = (capability_key, provider_key)
        if key in self._factories:
            raise ProviderConfigurationError(
                f"Provider already registered for {capability_key}: {provider_key}"
            )
        self._factories[key] = factory

    def load_plugins(self) -> None:
        """Load explicitly installed package entry points once, in name order."""
        if self._plugins_loaded:
            return
        self._plugins_loaded = True
        discovered = entry_points()
        if hasattr(discovered, "select"):
            plugins = discovered.select(group=PLUGIN_ENTRY_POINT_GROUP)
        else:  # Python versions returning the legacy mapping form.
            plugins = discovered.get(PLUGIN_ENTRY_POINT_GROUP, [])
        for plugin in sorted(plugins, key=lambda item: item.name):
            register_plugin = plugin.load()
            if not callable(register_plugin):
                raise ProviderConfigurationError(
                    f"Analysis provider plugin {plugin.name} must expose a registration function"
                )
            register_plugin(self)

    def create(
        self,
        capability: str,
        provider_id: str,
        *,
        config: Any,
        **dependencies: Any,
    ) -> AnalysisProvider:
        self.load_plugins()
        key = (
            str(capability or "").strip().lower(),
            str(provider_id or "").strip().lower(),
        )
        factory = self._factories.get(key)
        if factory is None:
            raise ProviderConfigurationError(
                f"No {key[0]} provider is registered as '{key[1]}'"
            )
        instance = factory(config=config, **dependencies)
        expected_type = self._CAPABILITY_TYPES[key[0]]
        if not isinstance(instance, expected_type):
            raise ProviderConfigurationError(
                f"Provider factory {key[1]} did not return a {expected_type.__name__}"
            )
        return instance


@dataclass(frozen=True)
class TranscriptionConfig:
    provider: str
    base_url: str
    model: str
    api_key: str = ""
    language: str = "auto"
    openrouter_provider: str = ""


@dataclass(frozen=True)
class AudioEventConfig:
    provider: str
    base_url: str = ""
    model: str = ""
    api_key: str = ""
    min_confidence: float = 0.35


def load_transcription_config(
    environ: Mapping[str, str] | None = None,
    *,
    ai_provider: str | None = None,
) -> TranscriptionConfig:
    env = os.environ if environ is None else environ
    chat_provider = (
        str(
            ai_provider
            if ai_provider is not None
            else env.get("AI_PROVIDER", "openrouter")
        )
        .strip()
        .lower()
    )
    provider = str(env.get("AI_TRANSCRIPTION_PROVIDER", "") or "").strip().lower()
    if not provider:
        if chat_provider == "openrouter":
            provider = "openrouter-json"
        else:
            raise ProviderConfigurationError(
                "AI_TRANSCRIPTION_PROVIDER must be set explicitly when chat analysis "
                f"uses '{chat_provider}'. Configure a transcription service; no provider "
                "will be selected automatically."
            )
    built_in_providers = {"openrouter-json", "openai-compatible"}
    default_url = OPENROUTER_TRANSCRIPTION_URL if provider == "openrouter-json" else ""
    base_url = (
        str(env.get("AI_TRANSCRIPTION_BASE_URL", default_url)).strip().rstrip("/")
    )
    if provider == "openai-compatible" and not base_url:
        raise ProviderConfigurationError(
            "AI_TRANSCRIPTION_BASE_URL is required for openai-compatible transcription"
        )
    if base_url:
        parsed = urlsplit(base_url)
    else:
        parsed = None
    if parsed and (parsed.scheme not in {"http", "https"} or not parsed.netloc):
        raise ProviderConfigurationError(
            "AI_TRANSCRIPTION_BASE_URL must be an absolute HTTP(S) URL"
        )
    default_model = (
        DEFAULT_TRANSCRIPTION_MODEL if provider in built_in_providers else ""
    )
    model = str(env.get("AI_TRANSCRIPTION_MODEL", "") or default_model).strip()
    if provider in built_in_providers and not model:
        raise ProviderConfigurationError("AI_TRANSCRIPTION_MODEL cannot be empty")
    api_key = str(env.get("AI_TRANSCRIPTION_API_KEY", "") or "").strip()
    if provider == "openrouter-json" and not api_key:
        if chat_provider == "openrouter":
            api_key = str(env.get("AI_API_KEY") or "").strip()
        if not api_key:
            api_key = str(env.get("OPENROUTER_API_KEY") or "").strip()
    language = (
        str(env.get("AI_TRANSCRIPTION_LANGUAGE", "auto") or "auto").strip().lower()
    )
    if language in {"", "detect", "default"}:
        language = "auto"
    return TranscriptionConfig(
        provider=provider,
        base_url=base_url,
        model=model,
        api_key=api_key,
        language=language,
        openrouter_provider=str(
            env.get("AI_TRANSCRIPTION_OPENROUTER_PROVIDER", "") or ""
        ).strip(),
    )


def load_audio_event_config(
    environ: Mapping[str, str] | None = None,
) -> AudioEventConfig:
    env = os.environ if environ is None else environ
    provider = str(env.get("AUDIO_EVENT_PROVIDER", "none")).strip().lower()
    if not provider:
        raise ProviderConfigurationError("AUDIO_EVENT_PROVIDER cannot be empty")
    base_url = str(env.get("AUDIO_EVENT_BASE_URL", "") or "").strip().rstrip("/")
    if provider == "openshorts-events-v1":
        if not base_url:
            raise ProviderConfigurationError(
                "AUDIO_EVENT_BASE_URL is required for openshorts-events-v1"
            )
        parsed = urlsplit(base_url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ProviderConfigurationError(
                "AUDIO_EVENT_BASE_URL must be an absolute HTTP(S) URL"
            )
        model = str(env.get("AUDIO_EVENT_MODEL", "") or "").strip()
        if not model:
            raise ProviderConfigurationError(
                "AUDIO_EVENT_MODEL is required for openshorts-events-v1"
            )
    else:
        model = str(env.get("AUDIO_EVENT_MODEL", "") or "").strip()
        if base_url:
            parsed = urlsplit(base_url)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                raise ProviderConfigurationError(
                    "AUDIO_EVENT_BASE_URL must be an absolute HTTP(S) URL"
                )
    try:
        min_confidence = float(env.get("AUDIO_EVENT_MIN_CONFIDENCE", "0.35"))
    except (TypeError, ValueError) as exc:
        raise ProviderConfigurationError(
            "AUDIO_EVENT_MIN_CONFIDENCE must be between 0 and 1"
        ) from exc
    if not math.isfinite(min_confidence) or not 0.0 <= min_confidence <= 1.0:
        raise ProviderConfigurationError(
            "AUDIO_EVENT_MIN_CONFIDENCE must be between 0 and 1"
        )
    return AudioEventConfig(
        provider=provider,
        base_url=base_url,
        model=model,
        api_key=str(env.get("AUDIO_EVENT_API_KEY", "") or "").strip(),
        min_confidence=min_confidence,
    )


def _finite_number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _events_endpoint(base_url: str) -> str:
    base = base_url.rstrip("/")
    parsed = urlsplit(base)
    if parsed.path.rstrip("/").endswith("/v1"):
        return f"{base}/audio/events"
    return f"{base}/v1/audio/events"


def normalize_transcription_result(
    response: Mapping[str, Any],
    *,
    provider: str = "configured provider",
) -> dict[str, Any]:
    if not isinstance(response, Mapping):
        raise ProviderResponseError(
            f"{provider} returned an invalid transcription response"
        )
    raw_segments = response.get("segments")
    if not isinstance(raw_segments, list):
        raise ProviderResponseError(
            f"{provider} transcription response is missing timestamped segments"
        )
    segments: list[dict[str, Any]] = []
    for raw_segment in raw_segments:
        if not isinstance(raw_segment, Mapping):
            raise ProviderResponseError(
                f"{provider} transcription response contains an invalid segment"
            )
        start = _finite_number(
            raw_segment.get("start", raw_segment.get("start_seconds"))
        )
        end = _finite_number(raw_segment.get("end", raw_segment.get("end_seconds")))
        text = str(raw_segment.get("text") or raw_segment.get("content") or "").strip()
        if start is None or end is None or start < 0 or end <= start:
            raise ProviderResponseError(
                f"{provider} transcription segments need valid start and end times"
            )
        if not text:
            continue
        words: list[dict[str, Any]] = []
        raw_words = raw_segment.get("words") or []
        if not isinstance(raw_words, list):
            raise ProviderResponseError(
                f"{provider} transcription segment has invalid word timings"
            )
        for raw_word in raw_words:
            if not isinstance(raw_word, Mapping):
                raise ProviderResponseError(
                    f"{provider} transcription segment has invalid word timings"
                )
            word_start = _finite_number(
                raw_word.get("start", raw_word.get("start_seconds"))
            )
            word_end = _finite_number(raw_word.get("end", raw_word.get("end_seconds")))
            word_text = str(raw_word.get("word") or raw_word.get("text") or "").strip()
            if not word_text:
                continue
            if (
                word_start is None
                or word_end is None
                or word_start < 0
                or word_end <= word_start
            ):
                raise ProviderResponseError(
                    f"{provider} transcription words need valid start and end times"
                )
            words.append({"word": word_text, "start": word_start, "end": word_end})
        segments.append({"text": text, "start": start, "end": end, "words": words})
    text = str(response.get("text") or "").strip()
    if not text and segments:
        text = " ".join(segment["text"] for segment in segments)
    if text and not segments:
        raise ProviderResponseError(
            f"{provider} returned transcript text without timestamped segments"
        )
    normalized = {
        "text": text,
        "segments": segments,
        "language": str(response.get("language") or "und").strip().lower(),
    }
    embedded_events: Any = response.get("events") or []
    if not embedded_events:
        for track in response.get("tracks", []) or []:
            if isinstance(track, Mapping) and track.get("type") in {
                "sound_events",
                "audio_events",
            }:
                embedded_events = track.get("items") or []
                break
    if embedded_events:
        normalized["events"] = normalize_audio_events(
            embedded_events,
            provider=str(response.get("provider") or provider),
        )
    return normalized


def normalize_audio_events(
    response: Mapping[str, Any] | list[Any],
    *,
    provider: str,
    min_confidence: float = 0.0,
) -> list[dict[str, Any]]:
    if isinstance(response, Mapping):
        raw_events = response.get("events")
    else:
        raw_events = response
    if not isinstance(raw_events, list):
        raise ProviderResponseError(
            f"{provider} event response is missing an events list"
        )
    events = []
    for event in raw_events:
        if not isinstance(event, Mapping):
            raise ProviderResponseError(
                f"{provider} event response contains an invalid event"
            )
        start = _finite_number(event.get("start", event.get("start_seconds")))
        end = _finite_number(event.get("end", event.get("end_seconds")))
        confidence = _finite_number(event.get("confidence"))
        label = str(event.get("label") or event.get("tag") or "").strip()
        if (
            start is None
            or end is None
            or confidence is None
            or start < 0
            or end <= start
            or not 0.0 <= confidence <= 1.0
            or not label
        ):
            raise ProviderResponseError(
                f"{provider} event response contains invalid timestamps, label, or confidence"
            )
        if confidence < min_confidence:
            continue
        events.append(
            {
                "start": start,
                "end": end,
                "label": label,
                "confidence": confidence,
                "source": str(event.get("source") or provider),
            }
        )
    return events


def dedupe_audio_events(
    events: list[Mapping[str, Any]],
    *,
    overlap_ratio: float = 0.5,
) -> list[dict[str, Any]]:
    """Merge duplicate detections from overlapping chunks, preserving the strongest score."""
    ordered = sorted(
        (dict(event) for event in events),
        key=lambda item: (
            float(item["start"]),
            float(item["end"]),
            str(item["label"]).casefold(),
        ),
    )
    merged: list[dict[str, Any]] = []
    for event in ordered:
        duplicate = None
        for previous in reversed(merged):
            if previous["start"] < event["start"] - max(
                float(previous["end"]) - float(previous["start"]), 1.0
            ):
                break
            if str(previous.get("label", "")).casefold() != str(
                event.get("label", "")
            ).casefold() or str(previous.get("source", "")) != str(
                event.get("source", "")
            ):
                continue
            overlap = min(float(previous["end"]), float(event["end"])) - max(
                float(previous["start"]), float(event["start"])
            )
            shorter_duration = min(
                float(previous["end"]) - float(previous["start"]),
                float(event["end"]) - float(event["start"]),
            )
            if shorter_duration > 0 and overlap / shorter_duration >= overlap_ratio:
                duplicate = previous
                break
        if duplicate is None:
            merged.append(event)
            continue
        duplicate["start"] = min(float(duplicate["start"]), float(event["start"]))
        duplicate["end"] = max(float(duplicate["end"]), float(event["end"]))
        duplicate["confidence"] = max(
            float(duplicate.get("confidence", 0.0)),
            float(event.get("confidence", 0.0)),
        )
    return merged


class OpenRouterJsonTranscriptionProvider(TranscriptionProvider):
    def __init__(
        self,
        config: TranscriptionConfig,
        *,
        ai_config: Any = None,
        transcribe_fn: Callable[..., dict[str, Any]] | None = None,
    ):
        super().__init__(config)
        if transcribe_fn is None:
            from ai_client import transcribe_audio_openrouter

            transcribe_fn = transcribe_audio_openrouter
        self._transcribe_fn = transcribe_fn
        self._ai_config = ai_config

    def transcribe_chunk(self, audio_path: str | Path) -> dict[str, Any]:
        from ai_client import AIConfig

        base = self._ai_config or AIConfig(
            provider="openrouter", api_key=self.config.api_key
        )
        if not isinstance(base, AIConfig):
            base = AIConfig(provider="openrouter", api_key=self.config.api_key)
        legacy_api_key = self.config.api_key
        if not legacy_api_key and base.is_openrouter():
            legacy_api_key = base.api_key
        legacy_config = replace(
            base,
            api_key=legacy_api_key,
            transcription_model=self.config.model,
            transcription_language=self.config.language,
            transcription_openrouter_provider=self.config.openrouter_provider,
        )
        if self.config.base_url.rstrip("/") == OPENROUTER_TRANSCRIPTION_URL:
            response = self._transcribe_fn(str(audio_path), legacy_config)
        else:
            response = self._transcribe_fn(
                str(audio_path),
                legacy_config,
                base_url=self.config.base_url,
            )
        return normalize_transcription_result(response, provider=self.config.provider)


class OpenAICompatibleTranscriptionProvider(TranscriptionProvider):
    def __init__(
        self, config: TranscriptionConfig, *, client: Any = None, timeout: float = 300.0
    ):
        super().__init__(config, client=client, timeout=timeout)

    @staticmethod
    def _discard_zero_duration_word_timestamps(payload: Any) -> Any:
        if not isinstance(payload, Mapping):
            return payload
        raw_segments = payload.get("segments")
        if not isinstance(raw_segments, list):
            return payload

        normalized_payload = dict(payload)
        normalized_segments = []
        for raw_segment in raw_segments:
            if not isinstance(raw_segment, Mapping):
                normalized_segments.append(raw_segment)
                continue
            raw_words = raw_segment.get("words")
            if not isinstance(raw_words, list):
                normalized_segments.append(raw_segment)
                continue

            valid_words = []
            for raw_word in raw_words:
                if isinstance(raw_word, Mapping):
                    word_text = str(
                        raw_word.get("word") or raw_word.get("text") or ""
                    ).strip()
                    word_start = _finite_number(
                        raw_word.get("start", raw_word.get("start_seconds"))
                    )
                    word_end = _finite_number(
                        raw_word.get("end", raw_word.get("end_seconds"))
                    )
                    if (
                        word_text
                        and word_start is not None
                        and word_start >= 0
                        and word_end == word_start
                    ):
                        continue
                valid_words.append(raw_word)

            normalized_segment = dict(raw_segment)
            normalized_segment["words"] = valid_words
            normalized_segments.append(normalized_segment)

        normalized_payload["segments"] = normalized_segments
        return normalized_payload

    def transcribe_chunk(self, audio_path: str | Path) -> dict[str, Any]:
        path = Path(audio_path)
        headers = (
            {"Authorization": f"Bearer {self.config.api_key}"}
            if self.config.api_key
            else {}
        )
        data: dict[str, Any] = {
            "model": self.config.model,
            "response_format": "verbose_json",
            "timestamp_granularities[]": ["segment", "word"],
        }
        if self.config.language != "auto":
            data["language"] = self.config.language
        payload = self._post_file_json(
            f"{self.config.base_url.rstrip('/')}/audio/transcriptions",
            path,
            data=data,
            headers=headers,
            stage="transcription",
        )
        try:
            return normalize_transcription_result(
                self._discard_zero_duration_word_timestamps(payload),
                provider=self.config.provider,
            )
        except ProviderResponseError:
            raise
        except Exception as exc:
            raise ProviderResponseError(
                f"{self.config.provider} returned an invalid transcription response"
            ) from exc


class NoAudioEventProvider(AudioEventProvider):
    def detect_events(
        self, audio_path: str | Path, *, transcript: Mapping[str, Any] | None = None
    ) -> list[dict[str, Any]]:
        return []


class EmbeddedAudioEventProvider(AudioEventProvider):
    def detect_events(
        self, audio_path: str | Path, *, transcript: Mapping[str, Any] | None = None
    ) -> list[dict[str, Any]]:
        embedded: Any = []
        if isinstance(transcript, Mapping):
            embedded = transcript.get("events") or []
            if not embedded:
                for track in transcript.get("tracks", []) or []:
                    if isinstance(track, Mapping) and track.get("type") in {
                        "sound_events",
                        "audio_events",
                    }:
                        embedded = track.get("items") or []
                        break
        return normalize_audio_events(
            embedded, provider="embedded", min_confidence=self.config.min_confidence
        )


class OpenShortsEventProvider(AudioEventProvider):
    def __init__(
        self, config: AudioEventConfig, *, client: Any = None, timeout: float = 300.0
    ):
        super().__init__(config, client=client, timeout=timeout)

    def detect_events(
        self, audio_path: str | Path, *, transcript: Mapping[str, Any] | None = None
    ) -> list[dict[str, Any]]:
        path = Path(audio_path)
        headers = (
            {"Authorization": f"Bearer {self.config.api_key}"}
            if self.config.api_key
            else {}
        )
        data = {"model": self.config.model} if self.config.model else {}
        url = _events_endpoint(self.config.base_url)
        payload = self._post_file_json(
            url,
            path,
            data=data,
            headers=headers,
            stage="sound-event analysis",
        )
        return normalize_audio_events(
            payload,
            provider=self.config.provider,
            min_confidence=self.config.min_confidence,
        )


class ConfiguredChatAnalysisProvider(ClipAnalysisProvider):
    """Clip-analysis adapter over the app's provider-neutral chat JSON facade."""

    def __init__(
        self, config: Any, *, chat_json_fn: Callable[..., dict[str, Any]] | None = None
    ):
        super().__init__(config)
        self._chat_json_fn = chat_json_fn

    def analyze_json(self, prompt: str, **options: Any) -> dict[str, Any]:
        chat_json_fn = self._chat_json_fn
        if chat_json_fn is None:
            from ai_client import chat_json

            chat_json_fn = chat_json
        return chat_json_fn(self.config, prompt, **options)


provider_registry = ProviderRegistry()
provider_registry.register(
    "transcription",
    "openrouter-json",
    lambda *, config, **dependencies: OpenRouterJsonTranscriptionProvider(
        config, **dependencies
    ),
)
provider_registry.register(
    "transcription",
    "openai-compatible",
    lambda *, config, **dependencies: OpenAICompatibleTranscriptionProvider(
        config, **dependencies
    ),
)
provider_registry.register(
    "audio_events",
    "none",
    lambda *, config, **dependencies: NoAudioEventProvider(config),
)
provider_registry.register(
    "audio_events",
    "embedded",
    lambda *, config, **dependencies: EmbeddedAudioEventProvider(config),
)
provider_registry.register(
    "audio_events",
    "openshorts-events-v1",
    lambda *, config, **dependencies: OpenShortsEventProvider(config, **dependencies),
)
provider_registry.register(
    "clip_analysis",
    "chat-json",
    lambda *, config, **dependencies: ConfiguredChatAnalysisProvider(
        config, **dependencies
    ),
)


def create_transcription_provider(
    config: TranscriptionConfig,
    *,
    ai_config: Any = None,
    transcribe_fn: Callable[..., dict[str, Any]] | None = None,
    client: Any = None,
    registry: ProviderRegistry = provider_registry,
) -> TranscriptionProvider:
    dependencies: dict[str, Any] = {"client": client} if client is not None else {}
    if config.provider == "openrouter-json":
        dependencies = {"ai_config": ai_config, "transcribe_fn": transcribe_fn}
    return registry.create(
        "transcription",
        config.provider,
        config=config,
        **dependencies,
    )


def create_audio_event_provider(
    config: AudioEventConfig,
    *,
    client: Any = None,
    registry: ProviderRegistry = provider_registry,
) -> AudioEventProvider:
    dependencies = {"client": client} if client is not None else {}
    return registry.create(
        "audio_events",
        config.provider,
        config=config,
        **dependencies,
    )


def create_clip_analysis_provider(
    config: Any,
    *,
    chat_json_fn: Callable[..., dict[str, Any]] | None = None,
    provider_id: str | None = None,
    registry: ProviderRegistry = provider_registry,
) -> ClipAnalysisProvider:
    selected_provider = provider_id or os.environ.get(
        "AI_CLIP_ANALYSIS_PROVIDER", "chat-json"
    )
    selected_provider = str(selected_provider).strip().lower()
    dependencies = (
        {"chat_json_fn": chat_json_fn}
        if selected_provider == "chat-json" and chat_json_fn is not None
        else {}
    )
    return registry.create(
        "clip_analysis",
        selected_provider,
        config=config,
        **dependencies,
    )
