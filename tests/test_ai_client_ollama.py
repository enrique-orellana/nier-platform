import base64
import socket
from unittest.mock import patch

import pytest

from openshorts.ai import ai_client


class Response:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


class Client:
    calls = []
    responses = []
    options = []

    def __init__(self, *args, **kwargs):
        self.calls = type(self).calls
        type(self).options.append(kwargs)

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def post(self, url, *, json, headers):
        self.calls.append((url, json, headers))
        return type(self).responses.pop(0)


@pytest.fixture(autouse=True)
def reset_client():
    Client.calls = []
    Client.responses = []
    Client.options = []


def test_ollama_chat_json_sends_transient_base64_images_and_keep_alive():
    Client.responses = [Response({"message": {"content": '{"shorts": []}'}})]
    with (
        patch("openshorts.ai.ai_client.httpx.Client", Client),
        patch(
            "openshorts.ai.ai_client.socket.getaddrinfo",
            return_value=[
                (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("192.168.65.254", 11434))
            ],
        ),
    ):
        result = ai_client.ollama_chat_json(
            "http://host.docker.internal:11434/",
            "qwen3-vl:8b-instruct-q4_K_M",
            "Choose clips",
            system_prompt="Return JSON",
            images=[b"jpeg-data"],
            keep_alive="30s",
        )

    assert result == {"shorts": []}
    url, payload, headers = Client.calls[0]
    assert url == "http://192.168.65.254:11434/api/chat"
    assert headers == {"Host": "host.docker.internal:11434"}
    assert Client.options[0] == {
        "timeout": 300.0,
        "follow_redirects": False,
        "trust_env": False,
    }
    assert payload["model"] == "qwen3-vl:8b-instruct-q4_K_M"
    assert payload["keep_alive"] == "30s"
    assert payload["format"] == "json"
    assert payload["messages"][0] == {"role": "system", "content": "Return JSON"}
    assert payload["messages"][1]["images"] == [base64.b64encode(b"jpeg-data").decode()]


def test_ollama_chat_json_rejects_dns_rebinding_to_a_public_address():
    with (
        patch("openshorts.ai.ai_client.httpx.Client", Client),
        patch(
            "openshorts.ai.ai_client.socket.getaddrinfo",
            return_value=[
                (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 11434))
            ],
        ),
    ):
        with pytest.raises(ValueError, match="resolve only to a local address"):
            ai_client.ollama_chat_json(
                "http://host.docker.internal:11434",
                "vision-model",
                "Choose clips",
            )

    assert Client.calls == []


def test_ollama_chat_json_requires_a_model():
    with pytest.raises(ValueError, match="vision model is required"):
        ai_client.ollama_chat_json("http://localhost:11434", "", "Choose clips")


def test_ollama_chat_json_rejects_invalid_model_response_json():
    Client.responses = [Response({"message": {"content": "not json"}})]
    with (
        patch("openshorts.ai.ai_client.httpx.Client", Client),
        patch(
            "openshorts.ai.ai_client.socket.getaddrinfo",
            return_value=[
                (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 11434))
            ],
        ),
    ):
        with pytest.raises(ValueError, match="invalid JSON"):
            ai_client.ollama_chat_json(
                "http://localhost:11434", "vision-model", "Choose clips"
            )


def test_unload_ollama_model_uses_zero_keep_alive_without_inference_prompt():
    Client.responses = [Response({})]
    with (
        patch("openshorts.ai.ai_client.httpx.Client", Client),
        patch(
            "openshorts.ai.ai_client.socket.getaddrinfo",
            return_value=[
                (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 11434))
            ],
        ),
    ):
        ai_client.unload_ollama_model("http://localhost:11434", "vision-model")

    url, payload, headers = Client.calls[0]
    assert url == "http://127.0.0.1:11434/api/generate"
    assert headers == {"Host": "localhost:11434"}
    assert payload == {"model": "vision-model", "keep_alive": 0, "stream": False}
