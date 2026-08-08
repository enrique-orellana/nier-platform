import pytest

import ai_client


def test_load_ai_config_recognizes_openai_codex_without_api_key():
    config = ai_client.load_ai_config({"X-AI-Provider": "openai-codex"})

    assert config.provider == "openai-codex"
    assert config.is_openai_codex()
    assert config.api_key == ""


def test_unsupported_provider_still_fails_fast():
    with pytest.raises(ValueError, match="Unsupported AI provider"):
        ai_client.chat_completion(ai_client.AIConfig(provider="unknown"), "hello")


class FakeCodexStreamResponse:
    def __init__(self, lines, status_code=200):
        self.status_code = status_code
        self.lines = lines

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def raise_for_status(self):
        return None

    def iter_lines(self):
        return iter(self.lines)


class FakeCodexStreamClient:
    responses = []
    last_url = None
    last_headers = None
    last_payload = None

    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def stream(self, method, url, headers=None, json=None):
        self.__class__.last_url = url
        self.__class__.last_headers = headers
        self.__class__.last_payload = json
        if self.__class__.responses:
            return self.__class__.responses.pop(0)
        return FakeCodexStreamResponse([
            'data: {"type":"response.output_text.delta","delta":"{\\"clips\\":"}',
            'data: {"type":"response.output_text.delta","delta":"[]}"}',
            "data: [DONE]",
        ])


def test_codex_transport_aggregates_response_output_text_deltas(monkeypatch):
    config = ai_client.AIConfig(provider="openai-codex", text_model="auto")
    monkeypatch.setattr(ai_client, "get_access_token", lambda: "access")
    monkeypatch.setattr(ai_client, "get_codex_account_id", lambda: "account")
    monkeypatch.setattr(ai_client.httpx, "Client", FakeCodexStreamClient)

    result = ai_client.chat_completion(config, "Return JSON", json_mode=True)

    assert result == '{"clips":[]}'
    assert FakeCodexStreamClient.last_url == "https://chatgpt.com/backend-api/codex/responses"
    assert FakeCodexStreamClient.last_headers["Authorization"] == "Bearer access"
    assert FakeCodexStreamClient.last_headers["ChatGPT-Account-ID"] == "account"
    assert FakeCodexStreamClient.last_payload["model"] == ai_client.CODEX_DEFAULT_MODEL
    assert FakeCodexStreamClient.last_payload["stream"] is True
    assert FakeCodexStreamClient.last_payload["store"] is False


def test_codex_transport_refreshes_once_after_auth_rejection(monkeypatch):
    config = ai_client.AIConfig(provider="openai-codex", text_model="auto")
    access_tokens = iter(["old-access", "new-access"])
    FakeCodexStreamClient.responses = [
        FakeCodexStreamResponse([], status_code=401),
        FakeCodexStreamResponse(['data: {"type":"response.output_text.delta","delta":"ok"}']),
    ]
    monkeypatch.setattr(ai_client, "get_access_token", lambda: next(access_tokens))
    monkeypatch.setattr(ai_client, "get_codex_account_id", lambda: "account")
    monkeypatch.setattr(ai_client, "refresh_credentials", lambda store: None)
    monkeypatch.setattr(ai_client.httpx, "Client", FakeCodexStreamClient)

    result = ai_client.chat_completion(config, "Say ok")

    assert result == "ok"
    assert FakeCodexStreamClient.last_headers["Authorization"] == "Bearer new-access"
