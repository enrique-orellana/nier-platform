from pathlib import Path

import ai_client


ROOT = Path(__file__).resolve().parents[1]


def test_backend_image_pins_codex_cli_to_the_advertised_client_version():
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")

    assert "npm" in dockerfile
    assert "@openai/codex" in dockerfile
    assert f"ARG CODEX_CLI_VERSION={ai_client.CODEX_DEFAULT_CLIENT_VERSION}" in dockerfile
