import json

import openshorts.ai.ai_client as ai_client
import pytest


class CompatibleResponse:
    status_code = 200
    text = "ok"

    def raise_for_status(self):
        return None

    def json(self):
        return {"choices": [{"message": {"content": json.dumps({"shorts": []})}}]}


class CompatibleClient:
    last_url = None
    last_headers = None
    last_json = None

    def __init__(self, timeout=None):
        self.timeout = timeout

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def post(self, url, headers=None, json=None, **_kwargs):
        self.__class__.last_url = url
        self.__class__.last_headers = headers
        self.__class__.last_json = json
        return CompatibleResponse()


def test_openai_compatible_chat_preserves_configured_path_and_uses_only_selected_endpoint(
    monkeypatch,
):
    monkeypatch.setattr(ai_client.httpx, "Client", CompatibleClient)
    config = ai_client.AIConfig(
        provider="openai-compatible",
        api_key="local-key",
        base_url="http://127.0.0.1:11434/api/v1",
        text_model="qwen-local",
    )

    result = ai_client.chat_json(config, "Return JSON")

    assert result == {"shorts": []}
    assert CompatibleClient.last_url == "http://127.0.0.1:11434/api/v1/chat/completions"
    assert CompatibleClient.last_headers["Authorization"] == "Bearer local-key"
    assert CompatibleClient.last_json["model"] == "qwen-local"


def test_openai_compatible_chat_omits_auth_header_when_key_is_empty(monkeypatch):
    monkeypatch.setattr(ai_client.httpx, "Client", CompatibleClient)
    config = ai_client.AIConfig(
        provider="openai-compatible",
        base_url="http://127.0.0.1:11434/v1",
        text_model="qwen-local",
    )

    ai_client.chat_completion(config, "Return JSON", json_mode=True)

    assert "Authorization" not in CompatibleClient.last_headers


def test_openai_compatible_chat_requires_a_configured_base_url():
    config = ai_client.AIConfig(provider="openai-compatible", text_model="qwen-local")

    with pytest.raises(ValueError, match="AI_BASE_URL is required"):
        ai_client.chat_completion(config, "Return JSON")
