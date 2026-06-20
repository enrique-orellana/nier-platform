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
