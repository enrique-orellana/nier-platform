import unittest
from unittest.mock import patch

import ai_client


class DummyDiscoveryResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {
            "models": [
                {
                    "type": "llm",
                    "key": "google/gemma-4-27b",
                    "display_name": "Gemma 4 27B",
                    "loaded_instances": [{"id": "google/gemma-4-27b"}],
                    "max_context_length": 262144,
                    "capabilities": {"vision": True},
                },
                {
                    "type": "llm",
                    "key": "deepseek-r1",
                    "display_name": "DeepSeek R1",
                    "loaded_instances": [],
                    "max_context_length": 131072,
                    "capabilities": {"vision": False},
                },
                {
                    "type": "embedding",
                    "key": "nomic-embed",
                    "display_name": "Nomic Embed",
                    "loaded_instances": [],
                    "max_context_length": 2048,
                },
            ]
        }


class DummyDiscoveryClient:
    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def get(self, url, headers=None):
        self.url = url
        self.headers = headers
        return DummyDiscoveryResponse()


class AIClientLmStudioDiscoveryTests(unittest.TestCase):
    @patch("ai_client.httpx.Client", DummyDiscoveryClient)
    def test_discover_lmstudio_models_filters_text_and_vision(self):
        result = ai_client.discover_lmstudio_models("http://localhost:1234/", api_key="token")

        self.assertEqual(
            [model["id"] for model in result["textModels"]],
            ["google/gemma-4-27b", "deepseek-r1"],
        )
        self.assertEqual(
            [model["id"] for model in result["visionModels"]],
            ["google/gemma-4-27b"],
        )
        self.assertTrue(result["textModels"][0]["isLoaded"])
        self.assertEqual(result["textModels"][0]["label"], "Gemma 4 27B")


class DummyChatResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {
            "choices": [
                {
                    "message": {
                        "content": "{\"clips\":[]}"
                    }
                }
            ]
        }


class RecordingChatClient:
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
        RecordingChatClient.last_url = url
        RecordingChatClient.last_headers = headers
        RecordingChatClient.last_json = json
        return DummyChatResponse()


class AIClientLmStudioChatTests(unittest.TestCase):
    @patch("ai_client.httpx.Client", RecordingChatClient)
    def test_chat_completion_uses_openai_compatible_endpoint_for_lmstudio(self):
        config = ai_client.AIConfig(
            provider="lmstudio",
            api_key="token",
            base_url="http://localhost:1234/",
            text_model="google/gemma-4-27b",
        )

        text = ai_client.chat_completion(
            config,
            "Return JSON",
            json_mode=True,
            model="google/gemma-4-27b",
        )

        self.assertEqual(text, "{\"clips\":[]}")
        self.assertEqual(RecordingChatClient.last_url, "http://localhost:1234/v1/chat/completions")
        self.assertEqual(
            RecordingChatClient.last_headers["Authorization"],
            "Bearer token",
        )
        self.assertEqual(
            RecordingChatClient.last_json["response_format"],
            {"type": "json_object"},
        )
