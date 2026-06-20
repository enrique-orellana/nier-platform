import unittest
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

import app


class BuildAIConfigTests(unittest.TestCase):
    @patch.dict("os.environ", {"AI_BASE_URL": ""}, clear=False)
    def test_build_ai_config_requires_base_url_for_lmstudio(self):
        with self.assertRaises(HTTPException) as context:
            app.build_ai_config(provider="lmstudio")

        self.assertEqual(context.exception.status_code, 400)
        self.assertIn("base URL", context.exception.detail)


class LmStudioDiscoveryRouteTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app.app)

    @patch("app.discover_lmstudio_models")
    def test_discover_endpoint_returns_normalized_model_lists(self, discover_mock):
        discover_mock.return_value = {
            "textModels": [
                {"id": "google/gemma-4-27b", "label": "Gemma 4 27B", "supportsText": True, "supportsVision": True, "isLoaded": True, "contextLength": 262144}
            ],
            "visionModels": [
                {"id": "google/gemma-4-27b", "label": "Gemma 4 27B", "supportsText": True, "supportsVision": True, "isLoaded": True, "contextLength": 262144}
            ],
        }

        response = self.client.post(
            "/api/ai/lmstudio/discover",
            json={"baseUrl": "http://localhost:1234", "apiKey": "token"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["available"])
        self.assertEqual(response.json()["provider"], "lmstudio")

    @patch("app.discover_lmstudio_models", side_effect=RuntimeError("boom"))
    def test_discover_endpoint_returns_clean_failure_payload(self, discover_mock):
        response = self.client.post(
            "/api/ai/lmstudio/discover",
            json={"baseUrl": "http://localhost:1234", "apiKey": ""},
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["available"])
        self.assertEqual(response.json()["textModels"], [])
        self.assertIn("Unable to discover LM Studio models", response.json()["error"])
