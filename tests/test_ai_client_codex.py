import pytest

import ai_client


def test_load_ai_config_recognizes_openai_codex_without_api_key():
    config = ai_client.load_ai_config({"X-AI-Provider": "openai-codex"})

    assert config.provider == "openai-codex"
    assert config.is_openai_codex()
    assert config.api_key == ""


def test_load_ai_config_reads_codex_reasoning_efforts():
    config = ai_client.load_ai_config({
        "X-AI-Provider": "openai-codex",
        "X-AI-Reasoning-Effort": "high",
        "X-AI-Analyze-Reasoning-Effort": "xhigh",
        "X-AI-Vision-Reasoning-Effort": "medium",
    })

    assert config.reasoning_effort == "high"
    assert config.analyze_reasoning_effort == "xhigh"
    assert config.vision_reasoning_effort == "medium"


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


class BrokenCodexStreamResponse(FakeCodexStreamResponse):
    def iter_lines(self):
        raise ai_client.httpx.RemoteProtocolError(
            "peer closed connection without sending complete message body"
        )


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


class FakeCodexCatalogResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload

    def raise_for_status(self):
        return None


class FakeCodexCatalogClient:
    responses = []
    last_url = None
    last_headers = None
    last_params = None

    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def get(self, url, headers=None, params=None):
        self.__class__.last_url = url
        self.__class__.last_headers = headers
        self.__class__.last_params = params
        return self.__class__.responses.pop(0)


def test_codex_model_discovery_normalizes_available_models(monkeypatch):
    FakeCodexCatalogClient.responses = [FakeCodexCatalogResponse(200, {
        "models": [
            {
                "slug": "gpt-5.4",
                "title": "GPT-5.4",
                "input_modalities": ["text", "image"],
                "visibility": "list",
                "default_reasoning_level": "medium",
                "supported_reasoning_levels": [
                    {"effort": "low", "description": "Fast"},
                    {"effort": "high", "description": "Deep"},
                ],
            },
            {"id": "hidden-model", "display_name": "Hidden", "visibility": "hidden"},
            {"slug": "", "title": "Invalid"},
        ],
        "default_model": "gpt-5.4",
    })]
    monkeypatch.setattr(ai_client.httpx, "Client", FakeCodexCatalogClient)
    monkeypatch.setattr(ai_client, "get_access_token", lambda: "access")
    monkeypatch.setattr(ai_client, "get_codex_account_id", lambda: "account")

    result = ai_client.discover_codex_models()

    assert result == {
        "models": [{
            "id": "gpt-5.4",
            "label": "GPT-5.4",
            "supportsVision": True,
            "efforts": [
                {"id": "low", "label": "Low", "description": "Fast"},
                {"id": "high", "label": "High", "description": "Deep"},
            ],
            "defaultEffort": "medium",
        }],
        "defaultModel": "gpt-5.4",
    }
    assert FakeCodexCatalogClient.last_url == "https://chatgpt.com/backend-api/codex/models"
    assert FakeCodexCatalogClient.last_params == {"client_version": "0.144.1"}
    assert FakeCodexCatalogClient.last_headers["Authorization"] == "Bearer access"
    assert FakeCodexCatalogClient.last_headers["ChatGPT-Account-ID"] == "account"


def test_codex_model_discovery_refreshes_once_after_auth_rejection(monkeypatch):
    FakeCodexCatalogClient.responses = [
        FakeCodexCatalogResponse(401, {}),
        FakeCodexCatalogResponse(200, {"models": [{"slug": "gpt-5.4"}]}),
    ]
    access_tokens = iter(["old-access", "new-access"])
    refreshes = []
    monkeypatch.setattr(ai_client.httpx, "Client", FakeCodexCatalogClient)
    monkeypatch.setattr(ai_client, "get_access_token", lambda: next(access_tokens))
    monkeypatch.setattr(ai_client, "get_codex_account_id", lambda: "account")
    monkeypatch.setattr(ai_client, "refresh_credentials", lambda store: refreshes.append(store))

    result = ai_client.discover_codex_models()

    assert result["models"][0]["id"] == "gpt-5.4"
    assert len(refreshes) == 1
    assert FakeCodexCatalogClient.last_headers["Authorization"] == "Bearer new-access"


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


def test_codex_transport_sends_selected_reasoning_effort(monkeypatch):
    config = ai_client.AIConfig(
        provider="openai-codex",
        text_model="gpt-5.6-luna",
        reasoning_effort="high",
    )
    monkeypatch.setattr(ai_client, "get_access_token", lambda: "access")
    monkeypatch.setattr(ai_client, "get_codex_account_id", lambda: "account")
    monkeypatch.setattr(ai_client.httpx, "Client", FakeCodexStreamClient)

    ai_client.chat_completion(config, "Return JSON", json_mode=True)

    assert FakeCodexStreamClient.last_payload["model"] == "gpt-5.6-luna"
    assert FakeCodexStreamClient.last_payload["reasoning"] == {"effort": "high"}


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


def test_codex_transport_retries_an_interrupted_stream(monkeypatch):
    config = ai_client.AIConfig(provider="openai-codex", text_model="auto")
    FakeCodexStreamClient.responses = [
        BrokenCodexStreamResponse([]),
        FakeCodexStreamResponse([
            'data: {"type":"response.output_text.delta","delta":"ok"}',
            "data: [DONE]",
        ]),
    ]
    monkeypatch.setattr(ai_client, "get_access_token", lambda: "access")
    monkeypatch.setattr(ai_client, "get_codex_account_id", lambda: "account")
    monkeypatch.setattr(ai_client.time, "sleep", lambda _: None)
    monkeypatch.setattr(ai_client.httpx, "Client", FakeCodexStreamClient)

    result = ai_client.chat_completion(config, "Say ok")

    assert result == "ok"
    assert not FakeCodexStreamClient.responses


def test_codex_sse_parser_enforces_absolute_deadline(monkeypatch):
    monkeypatch.setattr(ai_client.time, "monotonic", lambda: 10.0)

    with pytest.raises(TimeoutError, match="configured timeout"):
        ai_client._extract_codex_sse_text(
            ['data: {"type":"response.output_text.delta","delta":"ok"}'],
            deadline=9.0,
        )
