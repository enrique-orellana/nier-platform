import base64
import json
import os
import re
import uuid
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
from typing import Any, Mapping, Optional, Sequence

import httpx
from codex_auth import (
    CodexReauthRequired,
    default_codex_store,
    get_access_token,
    get_codex_account_id,
    refresh_credentials,
)

GEMINI_TEXT_MODEL = "gemini-2.5-flash"
GEMINI_VISION_MODEL = "gemini-3.1-flash-image-preview"
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
OPENROUTER_DEFAULT_MODEL = "openai/gpt-4o-mini"
OPENROUTER_DEFAULT_TRANSCRIPTION_MODEL = "openai/whisper-large-v3"
CODEX_DEFAULT_MODEL = os.environ.get("CODEX_MODEL", "gpt-5.4")
CODEX_MODELS_URL = "https://chatgpt.com/backend-api/codex/models"
AUTO_MODEL_VALUES = {"", "auto", "default"}
CODEX_DEFAULT_CLIENT_VERSION = "0.144.1"
AUTO_REASONING_VALUES = {"", "auto", "default"}
LMSTUDIO_PLACEHOLDER_MODELS = {"qwen3:latest", "qwen2.5vl:latest"}


def _codex_default_model() -> str:
    return os.environ.get("CODEX_MODEL", CODEX_DEFAULT_MODEL)


@dataclass
class AIConfig:
    provider: str = "gemini"
    api_key: str = ""
    base_url: str = ""
    text_model: str = ""
    analyze_model: str = ""
    vision_model: str = ""
    image_model: str = ""
    reasoning_effort: str = ""
    analyze_reasoning_effort: str = ""
    vision_reasoning_effort: str = ""
    transcription_provider: str = "local"
    transcription_model: str = OPENROUTER_DEFAULT_TRANSCRIPTION_MODEL

    def normalized_provider(self) -> str:
        provider = (self.provider or "gemini").strip().lower()
        if provider in {"local", "lmstudio-local"}:
            return "lmstudio"
        return provider

    def is_gemini(self) -> bool:
        return self.normalized_provider() == "gemini"

    def is_lmstudio(self) -> bool:
        return self.normalized_provider() == "lmstudio"

    def is_openai_codex(self) -> bool:
        return self.normalized_provider() == "openai-codex"

    def is_openrouter(self) -> bool:
        return self.normalized_provider() == "openrouter"

    def resolved_base_url(self) -> str:
        if not self.base_url:
            return OPENROUTER_BASE_URL if self.is_openrouter() else ""

        cleaned = self.base_url.strip().rstrip("/")
        if self.is_openrouter():
            return cleaned
        parsed = urlsplit(cleaned)
        if not parsed.scheme or not parsed.netloc:
            return cleaned

        # LM Studio requests are rooted at the service origin. Users sometimes
        # paste a nested path into the field, which would otherwise duplicate
        # segments when the app appends endpoint paths.
        return urlunsplit((parsed.scheme, parsed.netloc, "", "", ""))


def _is_placeholder_model(model: str, provider: str) -> bool:
    cleaned = (model or "").strip().lower()
    if cleaned in AUTO_MODEL_VALUES:
        return True
    if provider == "lmstudio" and cleaned in LMSTUDIO_PLACEHOLDER_MODELS:
        return True
    return False


def _normalize_model_for_provider(model: str, provider: str, kind: str) -> str:
    cleaned = (model or "").strip()
    if provider == "gemini":
        if kind in {"text", "analysis"} and _is_placeholder_model(cleaned, provider):
            return GEMINI_TEXT_MODEL
        if kind in {"vision", "image"} and _is_placeholder_model(cleaned, provider):
            return GEMINI_VISION_MODEL
    if provider == "lmstudio" and _is_placeholder_model(cleaned, provider):
        return ""
    if provider == "openrouter" and _is_placeholder_model(cleaned, provider):
        return OPENROUTER_DEFAULT_MODEL
    return cleaned


def _pick(source: Optional[Mapping[str, Any]], *keys: str, default: str = "") -> str:
    if source:
        for key in keys:
            if key in source:
                value = source[key]
                if value is not None and str(value).strip():
                    return str(value).strip()
    for key in keys:
        value = os.environ.get(key)
        if value and value.strip():
            return value.strip()
    return default


def _normalize_reasoning_effort(value: str) -> str:
    cleaned = (value or "").strip().lower()
    return "" if cleaned in AUTO_REASONING_VALUES else cleaned


def load_ai_config(source: Optional[Mapping[str, Any]] = None) -> AIConfig:
    provider = _pick(source, "X-AI-Provider", "AI_PROVIDER", default="gemini")
    provider_normalized = provider.strip().lower()
    if provider_normalized in {"local", "lmstudio-local"}:
        provider_normalized = "lmstudio"

    api_key = _pick(
        source,
        "X-AI-Api-Key",
        "X-Gemini-Key",
        "AI_API_KEY",
        "GEMINI_API_KEY",
        default="",
    )
    base_url = _pick(
        source,
        "X-AI-Base-Url",
        "OPENROUTER_BASE_URL" if provider_normalized == "openrouter" else "AI_BASE_URL",
        default=OPENROUTER_BASE_URL if provider_normalized == "openrouter" else "",
    )

    text_model = _pick(
        source,
        "X-AI-Model",
        "OPENROUTER_MODEL" if provider_normalized == "openrouter" else "AI_MODEL",
        default=GEMINI_TEXT_MODEL if provider_normalized == "gemini" else OPENROUTER_DEFAULT_MODEL if provider_normalized == "openrouter" else "",
    )
    analyze_model = _pick(
        source,
        "X-AI-Analyze-Model",
        "OPENROUTER_ANALYZE_MODEL" if provider_normalized == "openrouter" else "AI_ANALYZE_MODEL",
        default=GEMINI_TEXT_MODEL if provider_normalized == "gemini" else OPENROUTER_DEFAULT_MODEL if provider_normalized == "openrouter" else "",
    )
    vision_model = _pick(
        source,
        "X-AI-Vision-Model",
        "OPENROUTER_VISION_MODEL" if provider_normalized == "openrouter" else "AI_VISION_MODEL",
        default=GEMINI_VISION_MODEL if provider_normalized == "gemini" else OPENROUTER_DEFAULT_MODEL if provider_normalized == "openrouter" else "",
    )
    image_model = _pick(
        source,
        "X-AI-Image-Model",
        "OPENROUTER_IMAGE_MODEL" if provider_normalized == "openrouter" else "AI_IMAGE_MODEL",
        default=GEMINI_VISION_MODEL if provider_normalized == "gemini" else OPENROUTER_DEFAULT_MODEL if provider_normalized == "openrouter" else "",
    )
    reasoning_effort = _normalize_reasoning_effort(
        _pick(source, "X-AI-Reasoning-Effort", "AI_REASONING_EFFORT", default="")
    )
    analyze_reasoning_effort = _normalize_reasoning_effort(
        _pick(
            source,
            "X-AI-Analyze-Reasoning-Effort",
            "AI_ANALYZE_REASONING_EFFORT",
            default="",
        )
    )
    vision_reasoning_effort = _normalize_reasoning_effort(
        _pick(
            source,
            "X-AI-Vision-Reasoning-Effort",
            "AI_VISION_REASONING_EFFORT",
            default="",
        )
    )

    transcription_provider = _pick(
        source,
        "X-AI-Transcription-Provider",
        "AI_TRANSCRIPTION_PROVIDER",
        default="local",
    ).strip().lower()
    if transcription_provider in {"openshorts-local", "local-editor", "faster-whisper"}:
        transcription_provider = "local"
    transcription_model = _pick(
        source,
        "X-AI-Transcription-Model",
        "AI_TRANSCRIPTION_MODEL",
        default=OPENROUTER_DEFAULT_TRANSCRIPTION_MODEL,
    )

    text_model = _normalize_model_for_provider(text_model, provider_normalized, "text")
    analyze_model = _normalize_model_for_provider(analyze_model, provider_normalized, "analysis")
    vision_model = _normalize_model_for_provider(vision_model, provider_normalized, "vision")
    image_model = _normalize_model_for_provider(image_model, provider_normalized, "image")

    return AIConfig(
        provider=provider_normalized,
        api_key=api_key,
        base_url=base_url,
        text_model=text_model,
        analyze_model=analyze_model,
        vision_model=vision_model,
        image_model=image_model,
        reasoning_effort=reasoning_effort,
        analyze_reasoning_effort=analyze_reasoning_effort,
        vision_reasoning_effort=vision_reasoning_effort,
        transcription_provider=transcription_provider,
        transcription_model=transcription_model,
    )


def ai_config_to_env(config: AIConfig) -> dict[str, str]:
    env = {
        "AI_PROVIDER": config.normalized_provider(),
        "AI_BASE_URL": config.resolved_base_url(),
        "AI_MODEL": config.text_model,
        "AI_ANALYZE_MODEL": config.analyze_model,
        "AI_VISION_MODEL": config.vision_model,
        "AI_IMAGE_MODEL": config.image_model,
        "AI_REASONING_EFFORT": config.reasoning_effort,
        "AI_ANALYZE_REASONING_EFFORT": config.analyze_reasoning_effort,
        "AI_VISION_REASONING_EFFORT": config.vision_reasoning_effort,
        "AI_TRANSCRIPTION_PROVIDER": config.transcription_provider,
        "AI_TRANSCRIPTION_MODEL": config.transcription_model,
    }
    if config.api_key:
        env["AI_API_KEY"] = config.api_key
        if config.is_gemini():
            env["GEMINI_API_KEY"] = config.api_key
    return env


def _strip_code_fences(text: str) -> str:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\n?", "", cleaned)
        cleaned = re.sub(r"\n?```$", "", cleaned)
    return cleaned.strip()


def extract_json_text(text: str) -> str:
    cleaned = _strip_code_fences(text)
    start_obj = cleaned.find("{")
    start_arr = cleaned.find("[")
    if start_obj == -1 and start_arr == -1:
        return cleaned

    if start_arr != -1 and (start_obj == -1 or start_arr < start_obj):
        start = start_arr
        end = cleaned.rfind("]")
    else:
        start = start_obj
        end = cleaned.rfind("}")

    if start != -1 and end != -1 and end > start:
        return cleaned[start : end + 1].strip()
    return cleaned


def _encode_image_source(image: Any) -> str:
    if isinstance(image, (str, os.PathLike)):
        with open(image, "rb") as handle:
            return base64.b64encode(handle.read()).decode("utf-8")
    if isinstance(image, bytes):
        return base64.b64encode(image).decode("utf-8")
    if hasattr(image, "read"):
        raw = image.read()
        return base64.b64encode(raw).decode("utf-8")
    raise TypeError(f"Unsupported image source type: {type(image)!r}")


def _build_bearer_headers(api_key: str) -> dict[str, str]:
    if not api_key:
        return {}
    return {"Authorization": f"Bearer {api_key}"}


def transcribe_audio_openrouter(audio_path: str, config: AIConfig, *, timeout: float = 300.0) -> dict[str, Any]:
    """Transcribe an extracted audio chunk through OpenRouter's audio endpoint."""
    with open(audio_path, "rb") as handle:
        encoded_audio = base64.b64encode(handle.read()).decode("ascii")
    suffix = os.path.splitext(audio_path)[1].lower().lstrip(".") or "wav"
    payload = {
        "model": config.transcription_model or OPENROUTER_DEFAULT_TRANSCRIPTION_MODEL,
        "input_audio": {"data": encoded_audio, "format": suffix},
        "response_format": "verbose_json",
    }
    with httpx.Client(timeout=timeout) as client:
        response = client.post(
            f"{config.resolved_base_url()}/audio/transcriptions",
            headers={**_build_bearer_headers(config.api_key), "Content-Type": "application/json"},
            json=payload,
        )
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        detail = str(getattr(response, "text", "") or "").strip().replace("\n", " ")
        if len(detail) > 500:
            detail = detail[:500] + "…"
        suffix = f": {detail}" if detail else ""
        raise RuntimeError(
            f"OpenRouter transcription request failed with HTTP {response.status_code}{suffix}"
        ) from exc
    try:
        result = response.json()
    except ValueError as exc:
        detail = str(getattr(response, "text", "") or "").strip().replace("\n", " ")
        if len(detail) > 500:
            detail = detail[:500] + "…"
        suffix = f": {detail}" if detail else ""
        raise RuntimeError(
            f"OpenRouter returned an invalid transcription response (HTTP {response.status_code}){suffix}"
        ) from exc
    if not isinstance(result, Mapping):
        raise RuntimeError("OpenRouter returned an invalid transcription response")
    text = str(result.get("text") or "").strip()
    if not text:
        raise RuntimeError("OpenRouter returned an empty transcription")
    segments = []
    for raw_segment in result.get("segments", []) or []:
        if not isinstance(raw_segment, Mapping):
            continue
        try:
            start = float(raw_segment.get("start"))
            end = float(raw_segment.get("end"))
        except (TypeError, ValueError):
            continue
        segment_text = str(raw_segment.get("text") or "").strip()
        if segment_text and end > start:
            segments.append({"start": start, "end": end, "text": segment_text, "words": []})
    if not segments:
        segments = [{"start": 0.0, "end": 0.0, "text": text, "words": []}]
    return {"text": text, "segments": segments, "language": str(result.get("language") or "und")}


def _normalize_lmstudio_model(model: Mapping[str, Any]) -> Optional[dict[str, Any]]:
    if model.get("type") != "llm":
        return None

    capabilities = model.get("capabilities") or {}
    loaded_instances = model.get("loaded_instances") or []
    return {
        "id": str(model.get("key") or "").strip(),
        "label": str(model.get("display_name") or model.get("key") or "").strip(),
        "supportsText": True,
        "supportsVision": bool(capabilities.get("vision")),
        "isLoaded": bool(loaded_instances),
        "contextLength": model.get("max_context_length") or 0,
    }


def discover_lmstudio_models(base_url: str, api_key: str = "", timeout: float = 10.0) -> dict[str, Any]:
    origin = AIConfig(provider="lmstudio", base_url=base_url).resolved_base_url()
    with httpx.Client(timeout=timeout) as client:
        response = client.get(f"{origin}/api/v1/models", headers=_build_bearer_headers(api_key))
    response.raise_for_status()
    payload = response.json()

    models = []
    for raw_model in payload.get("models", []):
        normalized = _normalize_lmstudio_model(raw_model)
        if normalized and normalized["id"]:
            models.append(normalized)

    return {
        "textModels": models,
        "visionModels": [model for model in models if model["supportsVision"]],
    }


def _codex_model_value(model: Mapping[str, Any], *keys: str) -> str:
    for key in keys:
        value = model.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def _codex_model_is_available(model: Mapping[str, Any]) -> bool:
    visibility = _codex_model_value(model, "visibility", "status").lower()
    if visibility in {"hidden", "private", "unavailable", "disabled"}:
        return False
    if model.get("hidden") is True or model.get("is_hidden") is True:
        return False
    if model.get("available") is False or model.get("enabled") is False:
        return False
    return True


def _format_codex_effort_label(effort: str) -> str:
    return {
        "xhigh": "Extra High",
        "max": "Max",
        "ultra": "Ultra",
    }.get(effort, effort.capitalize())


def _normalize_codex_efforts(model: Mapping[str, Any]) -> list[dict[str, str]]:
    raw_efforts = (
        model.get("supported_reasoning_levels")
        or model.get("supported_reasoning_efforts")
        or model.get("supportedReasoningEfforts")
        or model.get("reasoning_efforts")
        or []
    )
    if isinstance(raw_efforts, Mapping):
        raw_efforts = raw_efforts.get("data") or raw_efforts.get("efforts") or []
    if not isinstance(raw_efforts, list):
        return []

    efforts = []
    seen_ids = set()
    for raw_effort in raw_efforts:
        if isinstance(raw_effort, Mapping):
            effort_id = _codex_model_value(
                raw_effort,
                "effort",
                "reasoning_effort",
                "reasoningEffort",
                "id",
                "value",
                "name",
            ).lower()
            description = _codex_model_value(raw_effort, "description", "details")
            label = _codex_model_value(raw_effort, "label", "title", "displayName")
        else:
            effort_id = str(raw_effort or "").strip().lower()
            description = ""
            label = ""
        if not effort_id or effort_id in seen_ids:
            continue
        efforts.append({
            "id": effort_id,
            "label": label or _format_codex_effort_label(effort_id),
            "description": description,
        })
        seen_ids.add(effort_id)
    return efforts


def _normalize_codex_model(model: Mapping[str, Any]) -> Optional[dict[str, Any]]:
    model_id = _codex_model_value(model, "slug", "id", "model", "name")
    if not model_id or not _codex_model_is_available(model):
        return None

    modalities = model.get("input_modalities") or model.get("inputModalities") or model.get("modalities") or []
    if isinstance(modalities, str):
        modalities = [modalities]
    supports_vision = bool(model.get("supportsVision") or model.get("supports_vision"))
    supports_vision = supports_vision or any(
        str(modality).strip().lower() in {"image", "vision"}
        for modality in modalities
    )
    efforts = _normalize_codex_efforts(model)
    default_effort = _codex_model_value(
        model,
        "default_reasoning_level",
        "default_reasoning_effort",
        "defaultReasoningEffort",
    ).lower()
    return {
        "id": model_id,
        "label": _codex_model_value(model, "title", "display_name", "displayName") or model_id,
        "supportsVision": supports_vision,
        "efforts": efforts,
        "defaultEffort": default_effort,
    }


def _codex_client_version() -> str:
    return os.environ.get("CODEX_CLIENT_VERSION", CODEX_DEFAULT_CLIENT_VERSION)


def _codex_request_headers(access_token: str, account_id: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {access_token}",
        "ChatGPT-Account-ID": account_id,
        "originator": "codex_cli_rs",
        "Version": _codex_client_version(),
        "Accept": "application/json",
    }


def discover_codex_models(timeout: float = 10.0) -> dict[str, Any]:
    """Return the models available to the stored ChatGPT Codex account."""
    for attempt in range(2):
        access_token = get_access_token()
        account_id = get_codex_account_id()
        with httpx.Client(timeout=timeout) as client:
            response = client.get(
                CODEX_MODELS_URL,
                headers=_codex_request_headers(access_token, account_id),
                params={"client_version": _codex_client_version()},
            )
        if response.status_code in {401, 403}:
            if attempt:
                raise CodexReauthRequired("ChatGPT authorization was rejected. Reconnect ChatGPT.")
            refresh_credentials(default_codex_store())
            continue
        response.raise_for_status()
        payload = response.json()
        raw_models = payload.get("models") if isinstance(payload, dict) else payload
        if isinstance(raw_models, dict):
            raw_models = raw_models.get("data") or raw_models.get("models") or []
        if not isinstance(raw_models, list):
            raw_models = []

        models = []
        seen_ids = set()
        for raw_model in raw_models:
            if not isinstance(raw_model, Mapping):
                continue
            normalized = _normalize_codex_model(raw_model)
            if normalized and normalized["id"] not in seen_ids:
                models.append(normalized)
                seen_ids.add(normalized["id"])

        default_model = ""
        if isinstance(payload, dict):
            default_model = str(
                payload.get("default_model")
                or payload.get("defaultModel")
                or payload.get("default")
                or ""
            ).strip()
        if not default_model:
            configured_default = _codex_default_model()
            if configured_default in seen_ids:
                default_model = configured_default
        if default_model and default_model not in seen_ids:
            default_model = ""
        return {"models": models, "defaultModel": default_model}

    raise RuntimeError("Unable to discover Codex models.")


def resolve_lmstudio_model(
    config: AIConfig,
    model: Optional[str] = None,
    *,
    require_vision: bool = False,
    timeout: float = 10.0,
) -> str:
    resolved = _normalize_model_for_provider(
        model or config.text_model,
        "lmstudio",
        "vision" if require_vision else "text",
    )
    if resolved:
        return resolved

    discovered = discover_lmstudio_models(
        config.resolved_base_url(),
        api_key=config.api_key,
        timeout=timeout,
    )
    pool = discovered["visionModels"] if require_vision else discovered["textModels"]
    if not pool:
        capability = "vision" if require_vision else "text"
        raise RuntimeError(
            f"No LM Studio {capability} models available. Detect LM Studio in Settings and select a model."
        )

    loaded = next((entry for entry in pool if entry.get("isLoaded")), None)
    chosen = loaded or pool[0]
    model_id = str(chosen.get("id") or "").strip()
    if not model_id:
        raise RuntimeError("LM Studio discovery returned a model without an id.")
    return model_id



def _gemini_chat(
    config: AIConfig,
    prompt: str,
    *,
    system_prompt: Optional[str] = None,
    json_mode: bool = False,
    model: Optional[str] = None,
    contents: Optional[Sequence[Any]] = None,
):
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=config.api_key)
    content_items: list[Any] = list(contents or [])
    if not content_items:
        content_items = [prompt]

    generate_config_kwargs: dict[str, Any] = {}
    if system_prompt:
        generate_config_kwargs["system_instruction"] = system_prompt
    if json_mode:
        generate_config_kwargs["response_mime_type"] = "application/json"

    response = client.models.generate_content(
        model=model or config.text_model,
        contents=content_items,
        config=types.GenerateContentConfig(**generate_config_kwargs) if generate_config_kwargs else None,
    )
    return response.text or ""


def _build_openai_message(prompt: str, images: Optional[Sequence[Any]] = None) -> dict[str, Any]:
    if not images:
        return {"role": "user", "content": prompt}

    content = [{"type": "text", "text": prompt}]
    for image in images:
        encoded = _encode_image_source(image)
        content.append(
            {
                "type": "image_url",
                "image_url": {"url": f"data:image/png;base64,{encoded}"},
            }
        )
    return {"role": "user", "content": content}


def _build_codex_input(prompt: str, images: Optional[Sequence[Any]] = None) -> list[dict[str, Any]]:
    content: list[dict[str, Any]] = [{"type": "input_text", "text": prompt}]
    for image in images or []:
        encoded = _encode_image_source(image)
        content.append({
            "type": "input_image",
            "image_url": f"data:image/png;base64,{encoded}",
        })
    return [{"role": "user", "content": content}]


def _extract_codex_sse_text(lines: Sequence[Any]) -> str:
    chunks: list[str] = []
    for raw_line in lines:
        line = raw_line.decode("utf-8") if isinstance(raw_line, bytes) else str(raw_line)
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if data == "[DONE]":
            break
        try:
            event = json.loads(data)
        except json.JSONDecodeError:
            continue
        if event.get("type") == "response.output_text.delta":
            delta = event.get("delta")
            if isinstance(delta, str):
                chunks.append(delta)
    return "".join(chunks)


def _codex_chat(
    config: AIConfig,
    prompt: str,
    *,
    system_prompt: Optional[str] = None,
    json_mode: bool = False,
    model: Optional[str] = None,
    reasoning_effort: Optional[str] = None,
    images: Optional[Sequence[Any]] = None,
    timeout: float = 300.0,
) -> str:
    del json_mode
    resolved_model = _normalize_model_for_provider(model or config.text_model, "openai-codex", "text")
    if resolved_model.lower() in AUTO_MODEL_VALUES:
        resolved_model = _codex_default_model()

    selected_effort = _normalize_reasoning_effort(
        reasoning_effort
        if reasoning_effort is not None
        else (config.vision_reasoning_effort if images else config.reasoning_effort)
    )

    payload: dict[str, Any] = {
        "model": resolved_model,
        "input": _build_codex_input(prompt, images),
        "stream": True,
        "store": False,
        "include": ["reasoning.encrypted_content"],
    }
    if system_prompt:
        payload["instructions"] = system_prompt
    if selected_effort:
        payload["reasoning"] = {"effort": selected_effort}

    text = ""
    for attempt in range(2):
        access_token = get_access_token()
        account_id = get_codex_account_id()
        request_id = str(uuid.uuid4())
        headers = {
            "Authorization": f"Bearer {access_token}",
            "ChatGPT-Account-ID": account_id,
            "originator": "codex_cli_rs",
            "Version": _codex_client_version(),
            "session_id": request_id,
            "x-client-request-id": request_id,
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        }

        with httpx.Client(timeout=timeout) as client:
            with client.stream(
                "POST",
                "https://chatgpt.com/backend-api/codex/responses",
                headers=headers,
                json=payload,
            ) as response:
                if response.status_code in {401, 403}:
                    if attempt:
                        raise CodexReauthRequired("ChatGPT authorization was rejected. Reconnect ChatGPT.")
                    refresh_credentials(default_codex_store())
                    continue
                response.raise_for_status()
                text = _extract_codex_sse_text(response.iter_lines())
        break

    if not text:
        raise RuntimeError("Codex returned no text output.")
    return text


def _lmstudio_chat(
    config: AIConfig,
    prompt: str,
    *,
    system_prompt: Optional[str] = None,
    json_mode: bool = False,
    model: Optional[str] = None,
    images: Optional[Sequence[Any]] = None,
    timeout: float = 300.0,
) -> str:
    url = f"{config.resolved_base_url()}/v1/chat/completions"
    resolved_model = resolve_lmstudio_model(
        config,
        model=model or config.text_model,
        require_vision=bool(images),
        timeout=min(timeout, 10.0),
    )
    messages: list[dict[str, Any]] = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append(_build_openai_message(prompt, images))

    payload: dict[str, Any] = {
        "model": resolved_model,
        "messages": messages,
        "temperature": 0.2,
    }
    # LM Studio requires 'json_schema' or 'text' for response_format.type.
    # Since we don't have a JSON schema, rely on system prompts and extract_json_text.
    with httpx.Client(timeout=timeout) as client:
        response = client.post(
            url,
            headers=_build_bearer_headers(config.api_key),
            json=payload,
        )
    response.raise_for_status()
    data = response.json()
    return ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""


def _openrouter_chat(
    config: AIConfig,
    prompt: str,
    *,
    system_prompt: Optional[str] = None,
    json_mode: bool = False,
    model: Optional[str] = None,
    images: Optional[Sequence[Any]] = None,
    timeout: float = 300.0,
) -> str:
    url = f"{config.resolved_base_url()}/chat/completions"
    resolved_model = _normalize_model_for_provider(
        model or config.text_model,
        "openrouter",
        "vision" if images else "text",
    )
    messages: list[dict[str, Any]] = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append(_build_openai_message(prompt, images))

    payload: dict[str, Any] = {
        "model": resolved_model,
        "messages": messages,
        "temperature": 0.2,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}

    with httpx.Client(timeout=timeout) as client:
        response = client.post(
            url,
            headers=_build_bearer_headers(config.api_key),
            json=payload,
        )
    response.raise_for_status()
    data = response.json()
    return ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""


def chat_completion(
    config: AIConfig,
    prompt: str,
    *,
    system_prompt: Optional[str] = None,
    json_mode: bool = False,
    model: Optional[str] = None,
    reasoning_effort: Optional[str] = None,
    images: Optional[Sequence[Any]] = None,
    timeout: float = 300.0,
) -> str:
    provider = config.normalized_provider()
    if provider == "gemini":
        return _gemini_chat(
            config,
            prompt,
            system_prompt=system_prompt,
            json_mode=json_mode,
            model=model or config.text_model,
            contents=[prompt] if not images else [prompt, *images],
        )

    if provider == "lmstudio":
        return _lmstudio_chat(
            config,
            prompt,
            system_prompt=system_prompt,
            json_mode=json_mode,
            model=model or config.text_model,
            images=images,
            timeout=timeout,
        )

    if provider == "openrouter":
        return _openrouter_chat(
            config,
            prompt,
            system_prompt=system_prompt,
            json_mode=json_mode,
            model=model or config.text_model,
            images=images,
            timeout=timeout,
        )

    if provider == "openai-codex":
        selected_effort = reasoning_effort
        if selected_effort is None:
            if images:
                selected_effort = config.vision_reasoning_effort
            else:
                selected_effort = config.reasoning_effort
        return _codex_chat(
            config,
            prompt,
            system_prompt=system_prompt,
            json_mode=json_mode,
            model=model or config.text_model,
            reasoning_effort=selected_effort,
            images=images,
            timeout=timeout,
        )

    raise ValueError(f"Unsupported AI provider: {config.provider}")


def chat_json(
    config: AIConfig,
    prompt: str,
    *,
    system_prompt: Optional[str] = None,
    model: Optional[str] = None,
    reasoning_effort: Optional[str] = None,
    images: Optional[Sequence[Any]] = None,
    timeout: float = 300.0,
) -> dict[str, Any]:
    raw = chat_completion(
        config,
        prompt,
        system_prompt=system_prompt,
        json_mode=True,
        model=model,
        reasoning_effort=reasoning_effort,
        images=images,
        timeout=timeout,
    )
    text = extract_json_text(raw)
    return json.loads(text)
