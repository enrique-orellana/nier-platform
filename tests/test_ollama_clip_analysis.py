import pytest

from openshorts.analysis.analysis_providers import (
    OllamaVisionClipAnalysisProvider,
    ProviderConfigurationError,
)


def test_ollama_clip_analysis_adds_timestamped_frames_and_bounded_images():
    calls = {}

    def sample(path, start, end, *, max_frames, max_dimension):
        calls["sample"] = (path, start, end, max_frames, max_dimension)
        return [(12.5, b"frame-one"), (27.5, b"frame-two")]

    def chat(base_url, model, prompt, **options):
        calls["chat"] = (base_url, model, prompt, options)
        return {"shorts": []}

    provider = OllamaVisionClipAnalysisProvider(
        "http://host.docker.internal:11434/",
        "qwen3-vl:8b-instruct-q4_K_M",
        frame_sampler=sample,
        chat_json_fn=chat,
    )
    result = provider.analyze_json(
        "Choose clips from this transcript.",
        video_path="source.mp4",
        frame_start=10,
        frame_end=30,
        timeout=45,
    )

    assert result == {"shorts": []}
    assert calls["sample"] == ("source.mp4", 10, 30, 8, 768)
    base_url, model, prompt, options = calls["chat"]
    assert base_url == "http://host.docker.internal:11434"
    assert model == "qwen3-vl:8b-instruct-q4_K_M"
    assert "Image 1: source timestamp 12.500 seconds" in prompt
    assert "Image 2: source timestamp 27.500 seconds" in prompt
    assert options["images"] == [b"frame-one", b"frame-two"]
    assert options["keep_alive"] == "30s"
    assert options["timeout"] == 45


def test_ollama_clip_analysis_can_explicitly_unload_model():
    calls = []
    provider = OllamaVisionClipAnalysisProvider(
        "http://localhost:11434",
        "vision-model",
        unload_fn=lambda base_url, model: calls.append((base_url, model)),
    )

    provider.unload()

    assert calls == [("http://localhost:11434", "vision-model")]


@pytest.mark.parametrize(
    ("base_url", "model", "message"),
    [
        ("", "vision-model", "base URL is required"),
        ("http://localhost:11434", "", "vision model is required"),
    ],
)
def test_ollama_clip_analysis_requires_configuration(base_url, model, message):
    with pytest.raises(ProviderConfigurationError, match=message):
        OllamaVisionClipAnalysisProvider(base_url, model)
