import base64
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
from typing import Any, Mapping, Optional, Sequence

import httpx

GEMINI_TEXT_MODEL = "gemini-2.5-flash"
GEMINI_VISION_MODEL = "gemini-3.1-flash-image-preview"
OLLAMA_TEXT_MODEL = "qwen3:latest"
OLLAMA_VISION_MODEL = "qwen2.5vl:latest"


@dataclass
class AIConfig:
    provider: str = "gemini"
    api_key: str = ""
    base_url: str = ""
    text_model: str = ""
    analyze_model: str = ""
    vision_model: str = ""
    image_model: str = ""

    def normalized_provider(self) -> str:
        provider = (self.provider or "gemini").strip().lower()
        if provider in {"local", "ollama-local"}:
            return "ollama"
        return provider

    def is_gemini(self) -> bool:
        return self.normalized_provider() == "gemini"

    def is_ollama(self) -> bool:
        return self.normalized_provider() == "ollama"

    def resolved_base_url(self) -> str:
        if not self.base_url:
            return ""

        cleaned = self.base_url.strip().rstrip("/")
        parsed = urlsplit(cleaned)
        if not parsed.scheme or not parsed.netloc:
            return cleaned

        # Ollama chat endpoints are rooted at the service origin. Users often
        # paste /api or /api/ into the field, which would otherwise create
        # accidental /api/api/chat requests.
        return urlunsplit((parsed.scheme, parsed.netloc, "", "", ""))


def _normalize_model_for_provider(model: str, provider: str, kind: str) -> str:
    cleaned = (model or "").strip()
    auto_values = {"", "auto", "default"}
    if provider == "gemini":
        if kind in {"text", "analysis"} and cleaned in auto_values | {OLLAMA_TEXT_MODEL}:
            return GEMINI_TEXT_MODEL
        if kind in {"vision", "image"} and cleaned in auto_values | {OLLAMA_VISION_MODEL, OLLAMA_TEXT_MODEL}:
            return GEMINI_VISION_MODEL
    if provider == "ollama":
        if kind in {"text", "analysis"} and cleaned in auto_values | {GEMINI_TEXT_MODEL}:
            return OLLAMA_TEXT_MODEL
        if kind == "vision" and cleaned in auto_values | {GEMINI_VISION_MODEL, GEMINI_TEXT_MODEL}:
            return OLLAMA_VISION_MODEL
        if kind == "image" and cleaned in auto_values | {GEMINI_VISION_MODEL, GEMINI_TEXT_MODEL}:
            return ""
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


def load_ai_config(source: Optional[Mapping[str, Any]] = None) -> AIConfig:
    provider = _pick(source, "X-AI-Provider", "AI_PROVIDER", default="gemini")
    provider_normalized = provider.strip().lower()
    if provider_normalized in {"local", "ollama-local"}:
        provider_normalized = "ollama"

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
        "AI_BASE_URL",
        "OLLAMA_BASE_URL",
        default="",
    )

    text_model = _pick(
        source,
        "X-AI-Model",
        "AI_MODEL",
        "OLLAMA_TEXT_MODEL",
        default=GEMINI_TEXT_MODEL if provider_normalized == "gemini" else OLLAMA_TEXT_MODEL,
    )
    analyze_model = _pick(
        source,
        "X-AI-Analyze-Model",
        "AI_ANALYZE_MODEL",
        default=GEMINI_TEXT_MODEL if provider_normalized == "gemini" else OLLAMA_TEXT_MODEL,
    )
    vision_model = _pick(
        source,
        "X-AI-Vision-Model",
        "AI_VISION_MODEL",
        "OLLAMA_VISION_MODEL",
        default=GEMINI_VISION_MODEL if provider_normalized == "gemini" else OLLAMA_VISION_MODEL,
    )
    image_model = _pick(
        source,
        "X-AI-Image-Model",
        "AI_IMAGE_MODEL",
        "OLLAMA_IMAGE_MODEL",
        default=GEMINI_VISION_MODEL if provider_normalized == "gemini" else "",
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
    )


def ai_config_to_env(config: AIConfig) -> dict[str, str]:
    env = {
        "AI_PROVIDER": config.normalized_provider(),
        "AI_BASE_URL": config.resolved_base_url(),
        "AI_MODEL": config.text_model,
        "AI_ANALYZE_MODEL": config.analyze_model,
        "AI_VISION_MODEL": config.vision_model,
        "AI_IMAGE_MODEL": config.image_model,
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


def _ollama_chat(
    config: AIConfig,
    prompt: str,
    *,
    system_prompt: Optional[str] = None,
    json_mode: bool = False,
    model: Optional[str] = None,
    images: Optional[Sequence[Any]] = None,
    timeout: float = 300.0,
) -> str:
    url = f"{config.resolved_base_url()}/api/chat"
    messages: list[dict[str, Any]] = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})

    user_message: dict[str, Any] = {"role": "user", "content": prompt}
    if images:
        user_message["images"] = [_encode_image_source(image) for image in images]
    messages.append(user_message)

    payload: dict[str, Any] = {
        "model": model or config.text_model,
        "messages": messages,
        "stream": False,
        "options": {
            "temperature": 0.2,
        },
    }
    if json_mode:
        payload["format"] = "json"

    with httpx.Client(timeout=timeout) as client:
        response = client.post(url, json=payload)
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        body = exc.response.text.strip()
        if body:
            raise RuntimeError(
                f"Ollama chat request failed ({exc.response.status_code}) for {url}: {body}"
            ) from exc
        raise RuntimeError(
            f"Ollama chat request failed ({exc.response.status_code}) for {url}"
        ) from exc
    data = response.json()
    message = data.get("message") or {}
    return message.get("content") or data.get("response") or ""


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


def chat_completion(
    config: AIConfig,
    prompt: str,
    *,
    system_prompt: Optional[str] = None,
    json_mode: bool = False,
    model: Optional[str] = None,
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

    if provider == "ollama":
        return _ollama_chat(
            config,
            prompt,
            system_prompt=system_prompt,
            json_mode=json_mode,
            model=model or config.text_model,
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
    images: Optional[Sequence[Any]] = None,
    timeout: float = 300.0,
) -> dict[str, Any]:
    raw = chat_completion(
        config,
        prompt,
        system_prompt=system_prompt,
        json_mode=True,
        model=model,
        images=images,
        timeout=timeout,
    )
    text = extract_json_text(raw)
    return json.loads(text)
