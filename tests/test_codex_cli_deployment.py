from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_backend_image_installs_codex_cli_for_chatgpt_connected_file_analysis():
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")

    assert "npm" in dockerfile
    assert "@openai/codex" in dockerfile
