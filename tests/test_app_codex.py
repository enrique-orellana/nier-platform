import time

from fastapi.testclient import TestClient

import app as app_module
from codex_auth import CodexReauthRequired, PendingDeviceLogin


def test_codex_status_is_sanitized():
    response = TestClient(app_module.app).get("/api/ai/openai-codex/status")

    assert response.status_code == 200
    assert response.json() == {"connected": False, "pending": False}


def test_codex_connect_returns_verification_url_and_code_only(monkeypatch):
    class FakeStart:
        pending = PendingDeviceLogin("private-device-id", "ABCD-EFGH", 5, time.time())

        def to_public(self):
            return {
                "status": "pending",
                "verificationUrl": "https://auth.openai.com/codex/device",
                "userCode": "ABCD-EFGH",
                "intervalSeconds": 5,
            }

    monkeypatch.setattr(app_module, "start_device_login", lambda: FakeStart())

    response = TestClient(app_module.app).post("/api/ai/openai-codex/connect")

    assert response.status_code == 200
    assert response.json() == {
        "status": "pending",
        "verificationUrl": "https://auth.openai.com/codex/device",
        "userCode": "ABCD-EFGH",
        "intervalSeconds": 5,
    }


def test_codex_disconnect_clears_credentials():
    response = TestClient(app_module.app).post("/api/ai/openai-codex/disconnect")

    assert response.status_code == 200
    assert response.json() == {"connected": False, "pending": False}


def test_build_ai_config_allows_codex_without_api_key():
    config = app_module.build_ai_config(provider="openai-codex")

    assert config.provider == "openai-codex"
    assert config.api_key == ""


def test_build_ai_config_reads_codex_reasoning_effort_headers():
    config = app_module.build_ai_config(
        provider="openai-codex",
        extra={
            "X-AI-Reasoning-Effort": "high",
            "X-AI-Analyze-Reasoning-Effort": "xhigh",
            "X-AI-Vision-Reasoning-Effort": "medium",
        },
    )

    assert config.reasoning_effort == "high"
    assert config.analyze_reasoning_effort == "xhigh"
    assert config.vision_reasoning_effort == "medium"


def test_codex_models_returns_account_available_models(monkeypatch):
    monkeypatch.setattr(app_module, "discover_codex_models", lambda: {
        "models": [{
            "id": "gpt-5.4",
            "label": "GPT-5.4",
            "supportsVision": True,
            "efforts": [{"id": "high", "label": "High", "description": "Deep"}],
            "defaultEffort": "high",
        }],
        "defaultModel": "gpt-5.4",
    })

    response = TestClient(app_module.app).get("/api/ai/openai-codex/models")

    assert response.status_code == 200
    assert response.json() == {
        "provider": "openai-codex",
        "models": [{
            "id": "gpt-5.4",
            "label": "GPT-5.4",
            "supportsVision": True,
            "efforts": [{"id": "high", "label": "High", "description": "Deep"}],
            "defaultEffort": "high",
        }],
        "defaultModel": "gpt-5.4",
    }


def test_codex_models_requires_a_connected_account(monkeypatch):
    monkeypatch.setattr(
        app_module,
        "discover_codex_models",
        lambda: (_ for _ in ()).throw(CodexReauthRequired("Connect ChatGPT before using Codex.")),
    )

    response = TestClient(app_module.app).get("/api/ai/openai-codex/models")

    assert response.status_code == 401
    assert response.json() == {"detail": "Connect ChatGPT before using Codex."}
