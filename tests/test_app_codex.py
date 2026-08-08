import time

from fastapi.testclient import TestClient

import app as app_module
from codex_auth import PendingDeviceLogin


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
