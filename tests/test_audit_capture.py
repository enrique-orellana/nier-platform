from audit_capture import AuditBodyPolicy


def test_allowlisted_body_capture_redacts_sensitive_values_without_truncating():
    policy = AuditBodyPolicy(["chatgpt.com"])
    request_body = (
        '{"prompt":"keep every character","token":"secret-token",'
        '"nested":{"api_key":"secret-key","note":"keep this note"},'
        '"url":"https://cdn.example.test/file?X-Amz-Signature=signed-value"}'
    )
    response_body = '{"result":"' + ("complete-" * 100) + '"}'

    captured = policy.capture(
        host="chatgpt.com",
        request_body=request_body,
        response_body=response_body,
    )

    assert captured["capture_mode"] == "full_redacted"
    assert captured["request_body"]
    assert "keep every character" in captured["request_body"]
    assert "keep this note" in captured["request_body"]
    assert "secret-token" not in captured["request_body"]
    assert "secret-key" not in captured["request_body"]
    assert "signed-value" not in captured["request_body"]
    assert len(captured["response_body"]) > 500


def test_non_allowlisted_host_captures_metadata_without_bodies():
    policy = AuditBodyPolicy(["chatgpt.com"])

    captured = policy.capture(
        host="evil.example",
        request_body='{"safe":"body"}',
        response_body='{"safe":"response"}',
        request_bytes=16,
        response_bytes=20,
        http_status=200,
    )

    assert captured == {
        "capture_mode": "metadata_only",
        "request_body": "",
        "response_body": "",
        "request_bytes": 16,
        "response_bytes": 20,
        "http_status": 200,
    }
