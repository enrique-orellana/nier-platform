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


class SuccessfulTranscriptionResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {
            "text": "Transcript",
            "segments": [{"start": 0, "end": 1, "text": "Transcript"}],
        }


class DetailedTranscriptionResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {
            "text": "Hola mundo",
            "segments": [{
                "start": 0.2,
                "end": 1.4,
                "text": "Hola mundo",
            }],
            "words": [
                {"word": "Hola", "start": 0.2, "end": 0.7},
                {"word": "mundo", "start": 0.8, "end": 1.4},
            ],
        }


class RecordingTranscriptionClient(RecordingClient):
    def post(self, url, headers=None, json=None):
        type(self).last_url = url
        type(self).last_json = json
        return SuccessfulTranscriptionResponse()


class DetailedTranscriptionClient(RecordingClient):
    def post(self, url, headers=None, json=None):
        type(self).last_json = json
        return DetailedTranscriptionResponse()


class UnsupportedVerboseJsonResponse:
    status_code = 400
    text = '{"error":{"message":"The selected model does not support response_format \\\"verbose_json\\\". Use \\\"json\\\" instead."}}'

    def raise_for_status(self):
        raise AssertionError("the compatibility fallback should handle this response before raise_for_status")


class VerboseJsonFallbackClient(RecordingClient):
    payloads = []

    def post(self, url, headers=None, json=None):
        type(self).payloads.append(json)
        if len(type(self).payloads) == 1:
            return UnsupportedVerboseJsonResponse()
        return DetailedTranscriptionResponse()


class RetryableTranscriptionClient(RecordingClient):
    attempts = 0

    def post(self, url, headers=None, json=None):
        type(self).attempts += 1
        if type(self).attempts < 3:
            raise ai_client.httpx.ConnectError("connection refused")
        return type("SuccessfulResponse", (), {
            "raise_for_status": lambda self: None,
            "json": lambda self: {
                "text": "Recovered transcript",
                "segments": [{"start": 0, "end": 1, "text": "Recovered transcript"}],
            },
        })()


class AlwaysUnavailableTranscriptionClient(RecordingClient):
    def post(self, url, headers=None, json=None):
        raise ai_client.httpx.ConnectError("connection refused")


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
        self.assertEqual(config.transcription_provider, "openrouter")
        self.assertEqual(config.transcription_model, "openai/whisper-large-v3")

    def test_openrouter_root_base_url_is_normalized_to_api_root(self):
        config = ai_client.AIConfig(
            provider="openrouter",
            base_url="https://openrouter.ai",
        )

        self.assertEqual(config.resolved_base_url(), "https://openrouter.ai/api/v1")

    @patch("ai_client.httpx.Client", RecordingTranscriptionClient)
    def test_transcription_uses_openrouter_endpoint_when_main_provider_is_lmstudio(self):
        config = ai_client.AIConfig(
            provider="lmstudio",
            api_key="secret",
            base_url="http://host.docker.internal:1234",
            transcription_provider="openrouter",
            transcription_model="openai/whisper-large-v3",
        )
        with TemporaryDirectory() as directory:
            audio_path = Path(directory) / "audio.wav"
            audio_path.write_bytes(b"audio")

            result = ai_client.transcribe_audio_openrouter(str(audio_path), config)

        self.assertEqual(result["text"], "Transcript")
        self.assertEqual(
            RecordingTranscriptionClient.last_url,
            "https://openrouter.ai/api/v1/audio/transcriptions",
        )

    @patch("ai_client.httpx.Client", DetailedTranscriptionClient)
    def test_transcription_preserves_word_timestamps_and_requests_detailed_format(self):
        config = ai_client.AIConfig(
            provider="openrouter",
            api_key="secret",
            transcription_model="qwen/qwen3-asr-1.7b",
        )
        with TemporaryDirectory() as directory:
            audio_path = Path(directory) / "audio.wav"
            audio_path.write_bytes(b"audio")

            result = ai_client.transcribe_audio_openrouter(str(audio_path), config)

        self.assertEqual(result["segments"][0]["words"], [
            {"word": "Hola", "start": 0.2, "end": 0.7},
            {"word": "mundo", "start": 0.8, "end": 1.4},
        ])
        self.assertEqual(DetailedTranscriptionClient.last_json["response_format"], "verbose_json")
        self.assertEqual(DetailedTranscriptionClient.last_json["timestamp_granularities"], ["segment", "word"])

    @patch("ai_client.httpx.Client", VerboseJsonFallbackClient)
    def test_transcription_falls_back_to_json_for_models_without_timestamp_support(self):
        VerboseJsonFallbackClient.payloads = []
        config = ai_client.AIConfig(
            provider="openrouter",
            api_key="secret",
            transcription_model="qwen/qwen3-asr-1.7b",
        )
        with TemporaryDirectory() as directory:
            audio_path = Path(directory) / "audio.wav"
            audio_path.write_bytes(b"audio")

            result = ai_client.transcribe_audio_openrouter(str(audio_path), config)

        assert result["text"] == "Hola mundo"
        assert len(VerboseJsonFallbackClient.payloads) == 2
        assert VerboseJsonFallbackClient.payloads[0]["response_format"] == "verbose_json"
        assert VerboseJsonFallbackClient.payloads[1]["response_format"] == "json"
        assert "timestamp_granularities" not in VerboseJsonFallbackClient.payloads[1]

    def test_transcription_requires_an_openrouter_api_key(self):
        config = ai_client.AIConfig(
            provider="lmstudio",
            base_url="http://host.docker.internal:1234",
            transcription_provider="openrouter",
        )
        with TemporaryDirectory() as directory:
            audio_path = Path(directory) / "audio.wav"
            audio_path.write_bytes(b"audio")

            with self.assertRaisesRegex(RuntimeError, "requires an API key"):
                ai_client.transcribe_audio_openrouter(str(audio_path), config)

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

    @patch("time.sleep")
    @patch("ai_client.httpx.Client", RetryableTranscriptionClient)
    def test_transcription_retries_connection_refused(self, _sleep):
        RetryableTranscriptionClient.attempts = 0
        config = ai_client.AIConfig(provider="openrouter", api_key="secret")
        with TemporaryDirectory() as directory:
            audio_path = Path(directory) / "audio.wav"
            audio_path.write_bytes(b"audio")

            result = ai_client.transcribe_audio_openrouter(str(audio_path), config)

        self.assertEqual(result["text"], "Recovered transcript")
        self.assertEqual(RetryableTranscriptionClient.attempts, 3)
        self.assertEqual(_sleep.call_count, 2)

    @patch("time.sleep")
    @patch("ai_client.httpx.Client", AlwaysUnavailableTranscriptionClient)
    def test_transcription_reports_connection_failure_after_retries(self, _sleep):
        config = ai_client.AIConfig(provider="openrouter", api_key="secret")
        with TemporaryDirectory() as directory:
            audio_path = Path(directory) / "audio.wav"
            audio_path.write_bytes(b"audio")

            with self.assertRaisesRegex(RuntimeError, "could not connect to OpenRouter"):
                ai_client.transcribe_audio_openrouter(str(audio_path), config)
