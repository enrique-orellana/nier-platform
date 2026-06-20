import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

import app


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
