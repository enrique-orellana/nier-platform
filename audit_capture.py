"""Safe request/response body capture for processing audit events."""

from __future__ import annotations

import json
import os
import re
import sys
import time
import uuid
from collections.abc import Mapping, Sequence
from contextlib import contextmanager
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


class AuditEmitter:
    def __init__(self, allowlist: Sequence[str], emit=None):
        self.policy = AuditBodyPolicy(allowlist)
        self.emit = emit or self._emit_stdout
        self._active: dict[str, dict[str, Any]] = {}

    @staticmethod
    def _emit_stdout(event: dict[str, Any]) -> None:
        sys.stdout.write(json.dumps(event, ensure_ascii=False) + "\n")
        sys.stdout.flush()

    def start_request(
        self,
        *,
        name: str,
        url: str = "",
        method: str = "",
        request_body: Any = None,
        request_bytes: int | None = None,
        category: str = "external_request",
        provider: str = "",
        detail: str = "",
        metadata: dict[str, Any] | None = None,
        binary: bool = False,
    ) -> str:
        event_id = str(uuid.uuid4())
        parsed = urlsplit(url)
        host = parsed.hostname or _normalize_host(url)
        path = parsed.path or ""
        captured = self.policy.capture(
            host=host,
            request_body=request_body,
            request_bytes=request_bytes,
            binary=binary,
        )
        self._active[event_id] = {
            "name": name,
            "category": category,
            "provider": provider,
            "host": host,
            "path": path,
            "method": method,
            "request_body": request_body,
            "request_bytes": captured["request_bytes"],
            "started_at": time.monotonic(),
            "binary": binary,
        }
        self.emit({
            "type": "audit",
            "audit": {
                "phase": "start",
                "event_id": event_id,
                "category": category,
                "name": name,
                "provider": provider,
                "host": host,
                "path": path,
                "method": method,
                "status": "started",
                "request_bytes": captured["request_bytes"],
                "request_body": captured["request_body"],
                "capture_mode": captured["capture_mode"],
                "detail": detail,
                "metadata": metadata or {},
            },
        })
        return event_id

    def finish_request(
        self,
        event_id: str,
        *,
        response_body: Any = None,
        response_bytes: int | None = None,
        status_code: int = 0,
        status: str = "completed",
        error: str = "",
        detail: str = "",
        response_content_type: str = "",
        metadata: dict[str, Any] | None = None,
        binary: bool | None = None,
    ) -> None:
        active = self._active.pop(event_id, {})
        is_binary = active.get("binary", False) if binary is None else binary
        captured = self.policy.capture(
            host=str(active.get("host") or ""),
            request_body=active.get("request_body"),
            response_body=response_body,
            request_bytes=active.get("request_bytes"),
            response_bytes=response_bytes,
            http_status=status_code,
            binary=is_binary,
        )
        duration_ms = round((time.monotonic() - float(active.get("started_at", time.monotonic()))) * 1000)
        self.emit({
            "type": "audit",
            "audit": {
                "phase": "finish",
                "event_id": event_id,
                "category": active.get("category", "external_request"),
                "name": active.get("name", "unknown"),
                "provider": active.get("provider", ""),
                "host": active.get("host", ""),
                "path": active.get("path", ""),
                "method": active.get("method", ""),
                "status": status,
                "http_status": captured["http_status"],
                "request_bytes": captured["request_bytes"],
                "response_bytes": captured["response_bytes"],
                "duration_ms": duration_ms,
                "response_body": captured["response_body"],
                "capture_mode": captured["capture_mode"],
                "response_content_type": response_content_type,
                "detail": detail,
                "error": error,
                "metadata": metadata or {},
            },
        })

    @contextmanager
    def stage(self, name: str, *, detail: str = "", metadata: dict[str, Any] | None = None):
        event_id = self.start_request(
            name=name,
            category="stage",
            detail=detail,
            metadata=metadata,
        )
        try:
            yield event_id
        except Exception as error:
            self.finish_request(event_id, status="failed", error=str(error), detail=detail)
            raise
        else:
            self.finish_request(event_id, status="completed", detail=detail)


class _NullAuditEmitter(AuditEmitter):
    def __init__(self):
        super().__init__([], emit=lambda _event: None)


_emitter: AuditEmitter | None = None


def get_audit_emitter() -> AuditEmitter:
    global _emitter
    if _emitter is not None:
        return _emitter
    enabled = os.environ.get("OPENSHORTS_AUDIT_ENABLED", "").strip().lower()
    if enabled not in {"1", "true", "yes", "on"}:
        _emitter = _NullAuditEmitter()
        return _emitter
    raw_allowlist = os.environ.get(
        "AUDIT_BODY_HOST_ALLOWLIST",
        "chatgpt.com,openrouter.ai,generativelanguage.googleapis.com",
    )
    _emitter = AuditEmitter([value.strip() for value in raw_allowlist.split(",")])
    return _emitter
