import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import ai_client


class DummyResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {"choices": [{"message": {"content": '{"highlights":[]}'}}]}


class RecordingClient:
    last_url = None
    last_headers = None
    last_json = None

    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def post(self, url, headers=None, json=None):
        type(self).last_url = url
        type(self).last_headers = headers
        type(self).last_json = json
        return DummyResponse()


class InvalidTranscriptionResponse:
    status_code = 200
    text = "upstream returned an empty body"

    def raise_for_status(self):
        return None

    def json(self):
        raise ValueError("not json")


class InvalidTranscriptionClient(RecordingClient):
    def post(self, url, headers=None, json=None):
        return InvalidTranscriptionResponse()


class OpenRouterTests(unittest.TestCase):
    def test_load_ai_config_applies_openrouter_defaults(self):
        config = ai_client.load_ai_config({
            "X-AI-Provider": "openrouter",
            "X-AI-Api-Key": "secret",
        })

        self.assertEqual(config.normalized_provider(), "openrouter")
        self.assertTrue(config.is_openrouter())
        self.assertEqual(config.resolved_base_url(), "https://openrouter.ai/api/v1")
        self.assertEqual(config.text_model, "openai/gpt-4o-mini")
        self.assertEqual(config.analyze_model, "openai/gpt-4o-mini")
        self.assertEqual(config.transcription_provider, "local")
        self.assertEqual(config.transcription_model, "openai/whisper-large-v3")

    @patch("ai_client.httpx.Client", RecordingClient)
    def test_chat_completion_uses_openrouter_compatible_endpoint(self):
        config = ai_client.AIConfig(
            provider="openrouter",
            api_key="secret",
            text_model="openai/gpt-4o-mini",
        )

        result = ai_client.chat_completion(config, "Return JSON", json_mode=True)

        self.assertEqual(result, '{"highlights":[]}')
        self.assertEqual(RecordingClient.last_url, "https://openrouter.ai/api/v1/chat/completions")
        self.assertEqual(RecordingClient.last_headers["Authorization"], "Bearer secret")
        self.assertEqual(RecordingClient.last_json["model"], "openai/gpt-4o-mini")
        self.assertEqual(RecordingClient.last_json["response_format"], {"type": "json_object"})

    @patch("ai_client.httpx.Client", InvalidTranscriptionClient)
    def test_transcription_reports_non_json_provider_response(self):
        config = ai_client.AIConfig(
            provider="openrouter",
            api_key="secret",
            transcription_model="qwen/qwen3-asr-1.7b",
        )
        with TemporaryDirectory() as directory:
            audio_path = Path(directory) / "audio.wav"
            audio_path.write_bytes(b"audio")
            with self.assertRaisesRegex(RuntimeError, "invalid transcription response.*HTTP 200.*empty body"):
                ai_client.transcribe_audio_openrouter(str(audio_path), config)
