import json
from unittest.mock import patch

import pytest

from codex_auth import (
    CodexCredentialStore,
    CodexCredentials,
    CodexReauthRequired,
    PendingDeviceLogin,
    poll_device_login,
    refresh_credentials,
    start_device_login,
)


def test_save_and_load_credentials_round_trip_without_exposing_status_secrets(tmp_path):
    store = CodexCredentialStore(tmp_path / "codex-auth.json")
    store.save(CodexCredentials(
        access_token="access",
        refresh_token="refresh",
        id_token="id",
        account_id="account",
        expires_at=4_000_000_000,
    ))

    assert store.load().refresh_token == "refresh"
    assert store.status() == {"connected": True, "pending": False}
    assert "access" not in json.dumps(store.status())


def test_atomic_refresh_preserves_old_refresh_token_when_response_omits_it(tmp_path):
    store = CodexCredentialStore(tmp_path / "codex-auth.json")
    store.save(CodexCredentials("old-access", "old-refresh", "id", "account", 0))

    store.update_access_token("new-access", expires_at=4_000_000_000)

    saved = store.load()
    assert saved.access_token == "new-access"
    assert saved.refresh_token == "old-refresh"


def test_disconnect_removes_credentials(tmp_path):
    store = CodexCredentialStore(tmp_path / "codex-auth.json")
    store.save(CodexCredentials("access", "refresh", "id", "account", 4_000_000_000))

    store.clear()

    assert store.load() is None
    assert store.status() == {"connected": False, "pending": False}


class FakeResponse:
    def __init__(self, status_code, payload=None):
        self.status_code = status_code
        self._payload = payload or {}

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class FakeCodexAuthClient:
    responses = []

    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def post(self, *args, **kwargs):
        return self.responses.pop(0)


@patch("codex_auth.httpx.Client", FakeCodexAuthClient)
def test_start_device_login_returns_sanitized_verification_details():
    FakeCodexAuthClient.responses = [FakeResponse(200, {
        "device_auth_id": "private-device-id",
        "user_code": "ABCD-EFGH",
        "interval": "5",
    })]

    result = start_device_login()

    assert result.to_public() == {
        "status": "pending",
        "verificationUrl": "https://auth.openai.com/codex/device",
        "userCode": "ABCD-EFGH",
        "intervalSeconds": 5,
    }
    assert "private-device-id" not in json.dumps(result.to_public())


@patch("codex_auth.httpx.Client", FakeCodexAuthClient)
def test_poll_device_login_retries_pending_then_exchanges_authorization_code():
    FakeCodexAuthClient.responses = [
        FakeResponse(403),
        FakeResponse(200, {
            "authorization_code": "authorization-code",
            "code_verifier": "code-verifier",
        }),
        FakeResponse(200, {
            "access_token": "access",
            "refresh_token": "refresh",
            "id_token": "id",
        }),
    ]
    pending = PendingDeviceLogin("device-id", "ABCD-EFGH", 0, 0)

    result = poll_device_login(pending, sleep=lambda _: None, now=lambda: 0)

    assert result.status == "connected"
    assert result.credentials.access_token == "access"


@patch("codex_auth.httpx.Client", FakeCodexAuthClient)
def test_refresh_credentials_preserves_refresh_token_when_response_omits_replacement(tmp_path):
    FakeCodexAuthClient.responses = [FakeResponse(200, {
        "access_token": "new-access",
        "id_token": "new-id",
    })]
    store = CodexCredentialStore(tmp_path / "codex-auth.json")
    store.save(CodexCredentials("old-access", "old-refresh", "old-id", "account", 0))

    refreshed = refresh_credentials(store)

    assert refreshed.access_token == "new-access"
    assert refreshed.refresh_token == "old-refresh"
    assert store.load().id_token == "new-id"


@patch("codex_auth.httpx.Client", FakeCodexAuthClient)
def test_refresh_credentials_clears_invalid_credentials(tmp_path):
    FakeCodexAuthClient.responses = [FakeResponse(401)]
    store = CodexCredentialStore(tmp_path / "codex-auth.json")
    store.save(CodexCredentials("old-access", "old-refresh", "old-id", "account", 0))

    with pytest.raises(CodexReauthRequired):
        refresh_credentials(store)

    assert store.load() is None
