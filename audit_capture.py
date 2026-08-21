"""Safe request/response body capture for processing audit events."""

from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


_SENSITIVE_KEY_PARTS = (
    "token",
    "secret",
    "password",
    "apikey",
    "authorization",
    "cookie",
    "signature",
    "credential",
    "session",
)
_SENSITIVE_QUERY_KEYS = {
    "access_token",
    "api_key",
    "apikey",
    "signature",
    "sig",
    "token",
    "x-amz-credential",
    "x-amz-security-token",
    "x-amz-signature",
}


def _normalize_host(value: str) -> str:
    value = value.strip().lower()
    if not value:
        return ""
    if "://" not in value:
        value = f"http://{value}"
    return urlsplit(value).hostname or ""


def _sensitive_key(key: str) -> bool:
    normalized = re.sub(r"[-_]", "", key.lower())
    return any(part in normalized for part in _SENSITIVE_KEY_PARTS)


def _redact_url(value: str) -> str:
    parsed = urlsplit(value)
    if not parsed.query:
        return value
    query = []
    for key, item in parse_qsl(parsed.query, keep_blank_values=True):
        if key.lower() in _SENSITIVE_QUERY_KEYS:
            item = "[REDACTED]"
        query.append((key, item))
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(query), parsed.fragment))


def _redact_value(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {
            key: "[REDACTED]" if _sensitive_key(str(key)) else _redact_value(item)
            for key, item in value.items()
        }
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return [_redact_value(item) for item in value]
    if isinstance(value, str):
        return _redact_url(value)
    return value


def redact_body(body: Any) -> str:
    if body is None:
        return ""
    if isinstance(body, (bytes, bytearray)):
        body = body.decode("utf-8", errors="replace")
    text = str(body)
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        redacted = re.sub(
            r"(?i)(bearer\s+)[^\s,;]+",
            r"\1[REDACTED]",
            text,
        )
        redacted = re.sub(
            r"(?i)([?&](?:access_token|api_key|apikey|signature|sig|token|x-amz-[^=&#\s]+)=)[^&#\s]+",
            r"\1[REDACTED]",
            redacted,
        )
        return redacted
    return json.dumps(_redact_value(parsed), ensure_ascii=False, separators=(",", ":"))


class AuditBodyPolicy:
    def __init__(self, allowlist: Sequence[str]):
        self.allowlist = {_normalize_host(value) for value in allowlist if _normalize_host(value)}

    def allows(self, host: str) -> bool:
        return _normalize_host(host) in self.allowlist

    def capture(
        self,
        *,
        host: str,
        request_body: Any = None,
        response_body: Any = None,
        request_bytes: int | None = None,
        response_bytes: int | None = None,
        http_status: int = 0,
        binary: bool = False,
    ) -> dict[str, Any]:
        if request_bytes is None:
            request_bytes = len(request_body) if isinstance(request_body, (bytes, bytearray)) else len(str(request_body or "").encode())
        if response_bytes is None:
            response_bytes = len(response_body) if isinstance(response_body, (bytes, bytearray)) else len(str(response_body or "").encode())
        if not self.allows(host) or binary:
            return {
                "capture_mode": "metadata_only",
                "request_body": "",
                "response_body": "",
                "request_bytes": request_bytes,
                "response_bytes": response_bytes,
                "http_status": http_status,
            }
        return {
            "capture_mode": "full_redacted",
            "request_body": redact_body(request_body),
            "response_body": redact_body(response_body),
            "request_bytes": request_bytes,
            "response_bytes": response_bytes,
            "http_status": http_status,
        }
