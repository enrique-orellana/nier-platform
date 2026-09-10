import json
import subprocess
from pathlib import Path

import httpx
import pytest

import ai_client
from audit_capture import AuditEmitter
from codex_auth import CodexCredentialStore, CodexCredentials


class FakeResponse:
    def __init__(self, url, status_code, payload):
        self.url = url
        self.status_code = status_code
        self._payload = payload
        self.text = json.dumps(payload) if not isinstance(payload, str) else payload

    def json(self):
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            request = httpx.Request("POST", self.url)
            response = httpx.Response(self.status_code, request=request, text=self.text)
            raise httpx.HTTPStatusError(
                f"HTTP {self.status_code}",
                request=request,
                response=response,
            )


class FakeClient:
    responses = []
    instances = []

    def __init__(self, *args, **kwargs):
        self.timeout = kwargs.get("timeout")
        self.calls = []
        self.__class__.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def post(self, url, *, headers=None, data=None, files=None, json=None):
        self.calls.append({
            "method": "POST",
            "url": url,
            "headers": headers,
            "data": data,
            "files": files,
            "json": json,
        })
        return self.__class__.responses.pop(0)

    def delete(self, url, *, headers=None):
        self.calls.append({
            "method": "DELETE",
            "url": url,
            "headers": headers,
        })
        return self.__class__.responses.pop(0)


def _install_fake_client(monkeypatch, responses):
    FakeClient.responses = list(responses)
    FakeClient.instances = []
    monkeypatch.setattr(ai_client.httpx, "Client", FakeClient)


def test_openai_file_analysis_uploads_once_analyzes_once_and_deletes_remote_file(
    monkeypatch,
    tmp_path,
):
    transcript_path = tmp_path / "timeline.jsonl"
    transcript_path.write_text('{"unit_id":"s000000"}\n', encoding="utf-8")
    _install_fake_client(
        monkeypatch,
        [
            FakeResponse("https://api.openai.com/v1/files", 200, {"id": "file-test-123"}),
            FakeResponse(
                "https://api.openai.com/v1/responses",
                200,
                {"output_text": "```json\n{\"shorts\": []}\n```"},
            ),
            FakeResponse("https://api.openai.com/v1/files/file-test-123", 204, {}),
        ],
    )

    result = ai_client.openai_file_analysis_json(
        transcript_path,
        "analysis prompt",
        model="configured-model",
        api_key="secret-key",
    )

    client = FakeClient.instances[0]
    assert client.timeout is None
    assert result == {"shorts": []}
    assert [call["method"] for call in client.calls] == ["POST", "POST", "DELETE"]
    upload, analysis, deletion = client.calls
    assert upload["url"] == "https://api.openai.com/v1/files"
    assert upload["headers"] == {"Authorization": "Bearer secret-key"}
    assert upload["data"] == {
        "purpose": "user_data",
        "expires_after[anchor]": "created_at",
        "expires_after[seconds]": "86400",
    }
    assert upload["files"]["file"][0] == "timeline.jsonl"
    assert upload["files"]["file"][2] == "application/jsonl"
    assert analysis["url"] == "https://api.openai.com/v1/responses"
    assert analysis["json"] == {
        "model": "configured-model",
        "store": False,
        "input": [{
            "role": "user",
            "content": [
                {"type": "input_text", "text": "analysis prompt"},
                {"type": "input_file", "file_id": "file-test-123"},
            ],
        }],
    }
    assert "secret-key" not in json.dumps(analysis["json"])
    assert deletion["url"] == "https://api.openai.com/v1/files/file-test-123"


def test_openai_file_analysis_parses_nested_output_text(monkeypatch, tmp_path):
    transcript_path = tmp_path / "timeline.jsonl"
    transcript_path.write_text("{}\n", encoding="utf-8")
    _install_fake_client(
        monkeypatch,
        [
            FakeResponse("https://api.openai.com/v1/files", 200, {"id": "file-test-123"}),
            FakeResponse(
                "https://api.openai.com/v1/responses",
                200,
                {
                    "output": [{
                        "type": "message",
                        "content": [{
                            "type": "output_text",
                            "text": '{"shorts": [{"score": 0.9}]}',
                        }],
                    }]
                },
            ),
            FakeResponse("https://api.openai.com/v1/files/file-test-123", 204, {}),
        ],
    )

    result = ai_client.openai_file_analysis_json(
        transcript_path,
        "prompt",
        model="configured-model",
        api_key="secret-key",
    )

    assert result == {"shorts": [{"score": 0.9}]}


def test_openai_file_analysis_deletes_file_and_preserves_analysis_error(
    monkeypatch,
    tmp_path,
):
    transcript_path = tmp_path / "timeline.jsonl"
    transcript_path.write_text("{}\n", encoding="utf-8")
    _install_fake_client(
        monkeypatch,
        [
            FakeResponse("https://api.openai.com/v1/files", 200, {"id": "file-test-123"}),
            FakeResponse("https://api.openai.com/v1/responses", 500, {"error": "bad"}),
            FakeResponse("https://api.openai.com/v1/files/file-test-123", 500, {"error": "bad"}),
        ],
    )

    with pytest.raises(RuntimeError, match="analysis.*HTTP 500") as error:
        ai_client.openai_file_analysis_json(
            transcript_path,
            "prompt",
            model="configured-model",
            api_key="secret-key",
        )

    assert "secret-key" not in str(error.value)
    assert FakeClient.instances[0].calls[-1]["method"] == "DELETE"


def test_openai_file_analysis_rejects_malformed_json(monkeypatch, tmp_path):
    transcript_path = tmp_path / "timeline.jsonl"
    transcript_path.write_text("{}\n", encoding="utf-8")
    _install_fake_client(
        monkeypatch,
        [
            FakeResponse("https://api.openai.com/v1/files", 200, {"id": "file-test-123"}),
            FakeResponse("https://api.openai.com/v1/responses", 200, {"output_text": "not json"}),
            FakeResponse("https://api.openai.com/v1/files/file-test-123", 204, {}),
        ],
    )

    with pytest.raises(RuntimeError, match="JSON"):
        ai_client.openai_file_analysis_json(
            transcript_path,
            "prompt",
            model="configured-model",
            api_key="secret-key",
        )


@pytest.mark.parametrize("status_code", [401, 413, 429, 500])
def test_openai_file_analysis_reports_upload_http_errors_without_secret(
    monkeypatch,
    tmp_path,
    status_code,
):
    transcript_path = tmp_path / "timeline.jsonl"
    transcript_path.write_text("{}\n", encoding="utf-8")
    _install_fake_client(
        monkeypatch,
        [FakeResponse("https://api.openai.com/v1/files", status_code, {"error": "bad"})],
    )

    with pytest.raises(RuntimeError, match=rf"file upload failed with HTTP {status_code}") as error:
        ai_client.openai_file_analysis_json(
            transcript_path,
            "prompt",
            model="configured-model",
            api_key="secret-key",
        )

    assert "secret-key" not in str(error.value)
    assert len(FakeClient.instances[0].calls) == 1


def test_openai_file_analysis_cleanup_warning_does_not_expose_secret(monkeypatch, tmp_path, capsys):
    transcript_path = tmp_path / "timeline.jsonl"
    transcript_path.write_text("{}\n", encoding="utf-8")
    _install_fake_client(
        monkeypatch,
        [
            FakeResponse("https://api.openai.com/v1/files", 200, {"id": "file-test-123"}),
            FakeResponse("https://api.openai.com/v1/responses", 200, {"output_text": '{"shorts": []}'}),
            FakeResponse("https://api.openai.com/v1/files/file-test-123", 500, {"error": "bad"}),
        ],
    )

    assert ai_client.openai_file_analysis_json(
        transcript_path,
        "prompt",
        model="configured-model",
        api_key="secret-key",
    ) == {"shorts": []}

    output = capsys.readouterr().out
    assert "OpenAI file cleanup warning" in output
    assert "secret-key" not in output


def test_openai_file_analysis_audit_events_do_not_capture_secret(monkeypatch, tmp_path):
    transcript_path = tmp_path / "timeline.jsonl"
    transcript_path.write_text("{}\n", encoding="utf-8")
    _install_fake_client(
        monkeypatch,
        [
            FakeResponse("https://api.openai.com/v1/files", 200, {"id": "file-test-123"}),
            FakeResponse("https://api.openai.com/v1/responses", 200, {"output_text": '{"shorts": []}'}),
            FakeResponse("https://api.openai.com/v1/files/file-test-123", 204, {}),
        ],
    )
    events = []
    monkeypatch.setattr(
        ai_client,
        "_audit_request_start",
        lambda **kwargs: (
            AuditEmitter(["api.openai.com"], emit=events.append),
            "audit-event",
        ),
    )
    monkeypatch.setattr(ai_client, "_audit_request_finish", lambda *_args, **_kwargs: None)

    ai_client.openai_file_analysis_json(
        transcript_path,
        "prompt",
        model="configured-model",
        api_key="secret-key",
    )

    assert "secret-key" not in json.dumps(events)


def test_openai_file_analysis_rejects_upload_without_file_id(monkeypatch, tmp_path):
    transcript_path = tmp_path / "timeline.jsonl"
    transcript_path.write_text("{}\n", encoding="utf-8")
    _install_fake_client(
        monkeypatch,
        [FakeResponse("https://api.openai.com/v1/files", 200, {"object": "file"})],
    )

    with pytest.raises(RuntimeError, match="file upload"):
        ai_client.openai_file_analysis_json(
            transcript_path,
            "prompt",
            model="configured-model",
            api_key="secret-key",
        )

    assert len(FakeClient.instances[0].calls) == 1


def test_codex_file_analysis_uses_chatgpt_oauth_and_complete_local_artifact(
    monkeypatch,
    tmp_path,
):
    transcript_path = tmp_path / "timeline.jsonl"
    transcript_path.write_text(
        '{"unit_id":"s000000","start":0,"end":12,"text":"complete"}\n',
        encoding="utf-8",
    )
    auth_path = tmp_path / "codex-auth.json"
    credentials = CodexCredentials(
        access_token="access-token",
        refresh_token="refresh-token",
        id_token="id-token",
        account_id="account-id",
        expires_at=4_000_000_000,
    )
    CodexCredentialStore(auth_path).save(credentials)
    monkeypatch.setattr(
        ai_client,
        "default_codex_store",
        lambda: CodexCredentialStore(auth_path),
    )
    observed = {}

    monkeypatch.setattr(ai_client.shutil, "which", lambda command: observed.setdefault("which", command) or "codex")

    def fake_run(command, **kwargs):
        observed["command"] = command
        observed["env"] = kwargs["env"]
        cli_auth = json.loads(
            (Path(observed["env"]["CODEX_HOME"]) / "auth.json").read_text(encoding="utf-8")
        )
        observed["cli_auth"] = cli_auth
        schema_path = Path(command[command.index("--output-schema") + 1])
        observed["output_schema"] = json.loads(schema_path.read_text(encoding="utf-8"))
        output_path = Path(command[command.index("--output-last-message") + 1])
        output_path.write_text(
            '{"coverage":{"complete":true,"start":0,"end":12,"units_reviewed":1},"shorts":[]}',
            encoding="utf-8",
        )
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    monkeypatch.setattr(ai_client.subprocess, "run", fake_run)

    result = ai_client.codex_file_analysis_json(
        transcript_path,
        "analysis prompt",
        model="gpt-5.4",
    )

    assert result == {
        "coverage": {"complete": True, "start": 0, "end": 12, "units_reviewed": 1},
        "shorts": [],
    }
    assert observed["which"] == "codex"
    assert observed["command"][1:3] == ["exec", "--ephemeral"]
    assert "--sandbox" in observed["command"]
    assert observed["command"][observed["command"].index("--sandbox") + 1] == "read-only"
    assert "--ask-for-approval" not in observed["command"]
    assert "--output-schema" in observed["command"]
    assert observed["output_schema"]["required"] == ["coverage", "shorts"]
    assert observed["output_schema"]["additionalProperties"] is False
    assert observed["output_schema"]["properties"]["coverage"]["required"] == [
        "complete",
        "start",
        "end",
        "units_reviewed",
    ]
    assert observed["output_schema"]["properties"]["coverage"]["additionalProperties"] is False
    assert observed["output_schema"]["properties"]["coverage"]["properties"]["complete"] == {
        "enum": [True],
    }
    assert observed["command"][observed["command"].index("--model") + 1] == "gpt-5.4"
    assert observed["command"][observed["command"].index("--config") + 1] == 'model_reasoning_effort="high"'
    assert "timeline.jsonl" in observed["command"][-1]
    assert "OPENAI_API_KEY" not in observed["env"]
    assert observed["cli_auth"]["auth_mode"] == "chatgpt"
    assert observed["cli_auth"]["OPENAI_API_KEY"] is None
    assert observed["cli_auth"]["tokens"] == {
        "access_token": "access-token",
        "refresh_token": "refresh-token",
        "id_token": "id-token",
        "account_id": "account-id",
    }


def test_codex_file_analysis_reports_cli_failure_without_secret(monkeypatch, tmp_path):
    transcript_path = tmp_path / "timeline.jsonl"
    transcript_path.write_text("{}\n", encoding="utf-8")
    auth_path = tmp_path / "codex-auth.json"
    CodexCredentialStore(auth_path).save(
        CodexCredentials("access-token", "refresh-token", "id-token", "account-id", 4_000_000_000)
    )
    monkeypatch.setattr(
        ai_client,
        "default_codex_store",
        lambda: CodexCredentialStore(auth_path),
    )
    monkeypatch.setattr(ai_client.shutil, "which", lambda _command: "codex")
    monkeypatch.setattr(
        ai_client.subprocess,
        "run",
        lambda command, **_kwargs: subprocess.CompletedProcess(
            command,
            7,
            stdout="",
            stderr="Codex CLI failed",
        ),
    )

    with pytest.raises(RuntimeError, match="Codex CLI file analysis failed") as error:
        ai_client.codex_file_analysis_json(
            transcript_path,
            "prompt",
            model="gpt-5.4",
        )

    assert "access-token" not in str(error.value)
