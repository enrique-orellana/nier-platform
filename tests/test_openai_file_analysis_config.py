import pytest

import ai_client
import main


def _config(provider="openai-codex", *, analyze_model="analyze-model", text_model="text-model"):
    return ai_client.AIConfig(
        provider=provider,
        analyze_model=analyze_model,
        text_model=text_model,
    )


def test_openai_clip_analysis_mode_defaults_to_auto(monkeypatch):
    monkeypatch.delenv("OPENAI_CLIP_ANALYSIS_MODE", raising=False)

    assert main.openai_clip_analysis_mode() == "auto"


def test_openai_clip_analysis_mode_normalizes_and_rejects_unknown_values(monkeypatch):
    monkeypatch.setenv("OPENAI_CLIP_ANALYSIS_MODE", " FILE ")
    assert main.openai_clip_analysis_mode() == "file"

    monkeypatch.setenv("OPENAI_CLIP_ANALYSIS_MODE", "unsupported")
    with pytest.raises(ValueError, match="auto, file, legacy"):
        main.openai_clip_analysis_mode()


def test_auto_file_analysis_uses_connected_codex_without_public_key(monkeypatch):
    monkeypatch.setenv("OPENAI_CLIP_ANALYSIS_MODE", "auto")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    assert main.should_use_openai_file_analysis(_config())

    monkeypatch.setenv("OPENAI_API_KEY", "server-key")
    assert main.should_use_openai_file_analysis(_config())
    assert not main.should_use_openai_file_analysis(_config("openrouter"))


def test_legacy_mode_never_selects_file_analysis(monkeypatch):
    monkeypatch.setenv("OPENAI_CLIP_ANALYSIS_MODE", "legacy")
    monkeypatch.setenv("OPENAI_API_KEY", "server-key")

    assert not main.should_use_openai_file_analysis(_config())


def test_file_mode_allows_connected_codex_without_public_key(monkeypatch):
    monkeypatch.setenv("OPENAI_CLIP_ANALYSIS_MODE", "file")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    assert main.should_use_openai_file_analysis(_config())


def test_file_analysis_settings_resolve_public_model_and_base_url(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "server-key")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://api.example.test/v1/")
    monkeypatch.setenv("OPENAI_ANALYZE_MODEL", "public-model")

    assert main.openai_file_analysis_settings(_config()) == {
        "api_key": "server-key",
        "base_url": "https://api.example.test/v1",
        "model": "public-model",
    }
