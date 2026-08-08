from __future__ import annotations

import json
import os
import base64
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable, Optional

import httpx


CODEX_AUTH_BASE_URL = "https://auth.openai.com"
CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
DEVICE_USERCODE_URL = f"{CODEX_AUTH_BASE_URL}/api/accounts/deviceauth/usercode"
DEVICE_TOKEN_URL = f"{CODEX_AUTH_BASE_URL}/api/accounts/deviceauth/token"
OAUTH_TOKEN_URL = f"{CODEX_AUTH_BASE_URL}/oauth/token"
DEVICE_VERIFICATION_URL = f"{CODEX_AUTH_BASE_URL}/codex/device"
DEVICE_REDIRECT_URI = f"{CODEX_AUTH_BASE_URL}/deviceauth/callback"
CODEX_ACCESS_TOKEN_REFRESH_SKEW_SECONDS = 120
DEVICE_AUTH_TIMEOUT_SECONDS = 15 * 60


class CodexReauthRequired(RuntimeError):
    """The stored Codex credential can no longer be refreshed."""


class CodexAuthError(RuntimeError):
    """A non-recoverable Codex authentication error."""


@dataclass
class CodexCredentials:
    access_token: str
    refresh_token: str
    id_token: str
    account_id: str
    expires_at: float

    @classmethod
    def from_dict(cls, payload: dict) -> "CodexCredentials":
        return cls(
            access_token=str(payload.get("access_token") or ""),
            refresh_token=str(payload.get("refresh_token") or ""),
            id_token=str(payload.get("id_token") or ""),
            account_id=str(payload.get("account_id") or ""),
            expires_at=float(payload.get("expires_at") or 0),
        )


@dataclass(frozen=True)
class PendingDeviceLogin:
    device_auth_id: str
    user_code: str
    interval_seconds: int
    started_at: float


@dataclass(frozen=True)
class DeviceLoginStart:
    pending: PendingDeviceLogin
    verification_url: str

    def to_public(self) -> dict[str, Any]:
        return {
            "status": "pending",
            "verificationUrl": self.verification_url,
            "userCode": self.pending.user_code,
            "intervalSeconds": self.pending.interval_seconds,
        }


@dataclass(frozen=True)
class DeviceLoginPollResult:
    status: str
    credentials: Optional[CodexCredentials] = None
    error: Optional[str] = None


class CodexCredentialStore:
    def __init__(self, path: Path):
        self.path = Path(path)

    def load(self) -> Optional[CodexCredentials]:
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            return None

        if not isinstance(payload, dict):
            return None

        credentials = CodexCredentials.from_dict(payload)
        if not credentials.access_token or not credentials.refresh_token:
            return None
        return credentials

    def save(self, credentials: CodexCredentials) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = self.path.with_name(f".{self.path.name}.tmp")
        temporary_path.write_text(
            json.dumps(asdict(credentials), separators=(",", ":")),
            encoding="utf-8",
        )
        try:
            os.chmod(temporary_path, 0o600)
        except OSError:
            pass
        os.replace(temporary_path, self.path)

    def update_access_token(
        self,
        access_token: str,
        *,
        expires_at: float,
        refresh_token: Optional[str] = None,
        id_token: Optional[str] = None,
    ) -> None:
        current = self.load()
        if current is None:
            raise RuntimeError("No stored Codex credentials are available.")
        self.save(CodexCredentials(
            access_token=access_token,
            refresh_token=refresh_token or current.refresh_token,
            id_token=id_token or current.id_token,
            account_id=current.account_id,
            expires_at=expires_at,
        ))

    def clear(self) -> None:
        try:
            self.path.unlink()
        except FileNotFoundError:
            pass

    def status(self) -> dict[str, bool]:
        return {"connected": self.load() is not None, "pending": False}


def default_codex_store() -> CodexCredentialStore:
    configured = os.environ.get("OPENSHORTS_CODEX_AUTH_FILE", "").strip()
    return CodexCredentialStore(Path(configured or ".openshorts/codex-auth.json"))


def _decode_jwt_payload(token: str) -> dict[str, Any]:
    try:
        encoded = token.split(".")[1]
        encoded += "=" * (-len(encoded) % 4)
        payload = json.loads(base64.urlsafe_b64decode(encoded).decode("utf-8"))
        return payload if isinstance(payload, dict) else {}
    except (IndexError, ValueError, TypeError, json.JSONDecodeError):
        return {}


def _account_id_from_payload(payload: dict[str, Any]) -> str:
    nested = payload.get("https://api.openai.com/auth")
    if isinstance(nested, dict):
        account_id = nested.get("chatgpt_account_id")
        if account_id:
            return str(account_id)
    account_id = payload.get("chatgpt_account_id")
    return str(account_id) if account_id else ""


def _credentials_from_token_response(
    payload: dict[str, Any],
    *,
    previous: Optional[CodexCredentials] = None,
) -> CodexCredentials:
    access_token = str(payload.get("access_token") or "").strip()
    if not access_token:
        raise CodexAuthError("Codex authentication returned no access token.")

    id_token = str(payload.get("id_token") or (previous.id_token if previous else "")).strip()
    refresh_token = str(payload.get("refresh_token") or (previous.refresh_token if previous else "")).strip()
    if not refresh_token:
        raise CodexAuthError("Codex authentication returned no refresh token.")

    access_payload = _decode_jwt_payload(access_token)
    id_payload = _decode_jwt_payload(id_token)
    expires_at = float(access_payload.get("exp") or id_payload.get("exp") or time.time() + 3600)
    account_id = (
        _account_id_from_payload(id_payload)
        or _account_id_from_payload(access_payload)
        or (previous.account_id if previous else "")
    )
    return CodexCredentials(
        access_token=access_token,
        refresh_token=refresh_token,
        id_token=id_token,
        account_id=account_id,
        expires_at=expires_at,
    )


def _client_context(client: Optional[httpx.Client]):
    if client is not None:
        class ExistingClient:
            def __enter__(self):
                return client

            def __exit__(self, exc_type, exc, tb):
                return False

        return ExistingClient()
    return httpx.Client(timeout=15.0, headers={"Accept": "application/json"})


def start_device_login(*, client: Optional[httpx.Client] = None) -> DeviceLoginStart:
    with _client_context(client) as auth_client:
        response = auth_client.post(
            DEVICE_USERCODE_URL,
            json={"client_id": CODEX_CLIENT_ID},
            headers={"Content-Type": "application/json"},
        )
    if response.status_code != 200:
        raise CodexAuthError("Unable to start ChatGPT device authorization.")
    payload = response.json()
    try:
        interval = int(payload.get("interval") or 5)
        pending = PendingDeviceLogin(
            device_auth_id=str(payload["device_auth_id"]),
            user_code=str(payload.get("user_code") or payload["usercode"]),
            interval_seconds=max(interval, 1),
            started_at=time.time(),
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise CodexAuthError("ChatGPT returned an invalid device authorization response.") from exc
    return DeviceLoginStart(pending=pending, verification_url=DEVICE_VERIFICATION_URL)


def poll_device_login(
    pending: PendingDeviceLogin,
    *,
    client: Optional[httpx.Client] = None,
    sleep: Callable[[float], None] = time.sleep,
    now: Callable[[], float] = time.time,
) -> DeviceLoginPollResult:
    with _client_context(client) as auth_client:
        while now() - pending.started_at < DEVICE_AUTH_TIMEOUT_SECONDS:
            response = auth_client.post(
                DEVICE_TOKEN_URL,
                json={
                    "device_auth_id": pending.device_auth_id,
                    "user_code": pending.user_code,
                },
                headers={"Content-Type": "application/json"},
            )
            if response.status_code in {403, 404}:
                sleep(pending.interval_seconds)
                continue
            if response.status_code != 200:
                return DeviceLoginPollResult(
                    status="error",
                    error="ChatGPT device authorization failed.",
                )

            code_payload = response.json()
            authorization_code = str(code_payload.get("authorization_code") or "").strip()
            code_verifier = str(code_payload.get("code_verifier") or "").strip()
            if not authorization_code or not code_verifier:
                return DeviceLoginPollResult(
                    status="error",
                    error="ChatGPT returned an invalid authorization response.",
                )

            exchange = auth_client.post(
                OAUTH_TOKEN_URL,
                data={
                    "grant_type": "authorization_code",
                    "code": authorization_code,
                    "redirect_uri": DEVICE_REDIRECT_URI,
                    "client_id": CODEX_CLIENT_ID,
                    "code_verifier": code_verifier,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            if exchange.status_code != 200:
                return DeviceLoginPollResult(
                    status="error",
                    error="ChatGPT token exchange failed.",
                )
            credentials = _credentials_from_token_response(exchange.json())
            return DeviceLoginPollResult(status="connected", credentials=credentials)

    return DeviceLoginPollResult(
        status="expired",
        error="ChatGPT device authorization expired. Start again to reconnect.",
    )


def refresh_credentials(
    store: CodexCredentialStore,
    *,
    client: Optional[httpx.Client] = None,
) -> CodexCredentials:
    current = store.load()
    if current is None:
        raise CodexReauthRequired("Connect ChatGPT before using the Codex provider.")

    with _client_context(client) as auth_client:
        response = auth_client.post(
            OAUTH_TOKEN_URL,
            data={
                "grant_type": "refresh_token",
                "refresh_token": current.refresh_token,
                "client_id": CODEX_CLIENT_ID,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    if response.status_code in {401, 403}:
        store.clear()
        raise CodexReauthRequired("ChatGPT authorization was revoked. Reconnect ChatGPT.")
    if response.status_code != 200:
        raise CodexAuthError("Unable to refresh ChatGPT authorization.")

    refreshed = _credentials_from_token_response(response.json(), previous=current)
    store.save(refreshed)
    return refreshed


def get_access_token(
    store: Optional[CodexCredentialStore] = None,
    *,
    client: Optional[httpx.Client] = None,
) -> str:
    store = store or default_codex_store()
    credentials = store.load()
    if credentials is None:
        raise CodexReauthRequired("Connect ChatGPT before using the Codex provider.")
    if credentials.expires_at > time.time() + CODEX_ACCESS_TOKEN_REFRESH_SKEW_SECONDS:
        return credentials.access_token
    return refresh_credentials(store, client=client).access_token


def get_codex_account_id(store: Optional[CodexCredentialStore] = None) -> str:
    credentials = (store or default_codex_store()).load()
    if credentials is None:
        raise CodexReauthRequired("Connect ChatGPT before using the Codex provider.")
    return credentials.account_id
