import asyncio
import os
import unittest
from unittest.mock import patch

from fastapi import Request

from app import _build_inline_content_disposition, video_proxy


class VideoProxyTests(unittest.TestCase):
    def test_unicode_filename_uses_utf8_content_disposition(self):
        header = _build_inline_content_disposition(
            "job_ESTE JUEGO ME INCOMODÓ MUCHÍSIMO 📸_clip_3.mp4"
        )

        header.encode("latin-1")
        self.assertIn('filename="job_ESTE JUEGO ME INCOMOD MUCHSIMO _clip_3.mp4"', header)
        self.assertIn("filename*=UTF-8''", header)

    def test_video_proxy_streams_upstream_chunks_without_buffering(self):
        class FakeResponse:
            status_code = 206
            headers = {
                "content-type": "video/mp4",
                "content-length": "4",
                "content-range": "bytes 0-3/4",
                "etag": '"video-etag"',
                "cache-control": "public, max-age=31536000, immutable",
            }

            async def aiter_bytes(self):
                yield b"ab"
                yield b"cd"

            async def aclose(self):
                self.closed = True

        class FakeClient:
            response = FakeResponse()
            request_headers = None
            closed = False

            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                self.closed = True

            def build_request(self, method, url, headers):
                self.request_headers = headers
                return (method, url)

            async def send(self, request, stream):
                self.stream = stream
                return self.response

            async def aclose(self):
                self.closed = True

        scope = {
            "type": "http",
            "method": "GET",
            "path": "/api/video-proxy",
            "headers": [(b"range", b"bytes=0-3")],
            "query_string": b"",
            "server": ("testserver", 80),
            "client": ("testclient", 123),
            "scheme": "http",
            "root_path": "",
            "http_version": "1.1",
        }

        async def exercise():
            request = Request(scope)
            with patch.dict(
                os.environ,
                {
                    "AWS_S3_PUBLIC_ENDPOINT_URL": "http://minio.example",
                    "AWS_S3_ENDPOINT_URL": "",
                },
                clear=False,
            ), patch("httpx.AsyncClient", FakeClient):
                response = await video_proxy(
                    request,
                    url="http://minio.example/media/video.mp4?signature=x",
                )
                chunks = [chunk async for chunk in response.body_iterator]
                if response.background:
                    await response.background()

            return response, chunks, FakeClient.response

        response, chunks, upstream = asyncio.run(exercise())

        self.assertEqual(response.status_code, 206)
        self.assertEqual(chunks, [b"ab", b"cd"])
        self.assertEqual(response.headers["content-range"], "bytes 0-3/4")
        self.assertEqual(response.headers["cache-control"], "public, max-age=31536000, immutable")
        self.assertEqual(upstream.closed, True)


if __name__ == "__main__":
    unittest.main()
