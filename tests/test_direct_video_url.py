import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import main
from audit_capture import AuditEmitter


class DirectVideoUrlTests(unittest.TestCase):
    def test_localhost_url_uses_configured_s3_endpoint(self):
        with patch.dict(os.environ, {"AWS_S3_ENDPOINT_URL": "http://minio:9000"}, clear=False):
            self.assertEqual(
                main.resolve_direct_video_url("http://localhost:9000/media/video.mp4?X-Amz-Signature=x"),
                "http://minio:9000/media/video.mp4?X-Amz-Signature=x",
            )

    def test_non_loopback_url_is_unchanged(self):
        url = "https://minio.example/media/video.mp4?signature=x"
        self.assertEqual(main.resolve_direct_video_url(url), url)

    def test_direct_download_streams_to_output_and_uses_path_filename(self):
        response = Mock(status_code=200, headers={"content-length": "5"})
        response.iter_bytes.return_value = iter([b"he", b"llo"])
        response.raise_for_status.return_value = None

        with tempfile.TemporaryDirectory() as directory, patch.object(main.httpx, "stream") as stream:
            stream.return_value.__enter__.return_value = response
            path, title = main.download_direct_video("http://minio:9000/media/source-video.mp4", directory)

            self.assertEqual(title, "source-video")
            self.assertEqual(Path(path).read_bytes(), b"hello")

    def test_direct_download_emits_binary_source_audit_events(self):
        response = Mock(status_code=200, headers={"content-length": "5"}, content=b"hello")
        response.iter_bytes.return_value = iter([b"hello"])
        response.raise_for_status.return_value = None
        events = []
        emitter = AuditEmitter(["minio:9000"], emit=events.append)

        with tempfile.TemporaryDirectory() as directory, patch.object(main.httpx, "stream") as stream, patch.object(
            main, "get_audit_emitter", return_value=emitter
        ):
            stream.return_value.__enter__.return_value = response
            main.download_direct_video("http://minio:9000/media/source-video.mp4", directory)

        assert [event["audit"]["phase"] for event in events] == ["start", "finish"]
        assert events[0]["audit"]["name"] == "source.download"
        assert events[1]["audit"]["response_body"] == ""

    def test_direct_download_rejects_response_over_max_size(self):
        response = Mock(status_code=200, headers={"content-length": str(main.DIRECT_VIDEO_MAX_BYTES + 1)})
        response.raise_for_status.return_value = None

        with tempfile.TemporaryDirectory() as directory, patch.object(main.httpx, "stream") as stream:
            stream.return_value.__enter__.return_value = response
            with self.assertRaisesRegex(ValueError, "exceeds the configured file size limit"):
                main.download_direct_video("http://minio:9000/media/video.mp4", directory)

    def test_direct_download_propagates_http_failure(self):
        response = Mock(status_code=404, headers={})
        response.raise_for_status.side_effect = RuntimeError("404 Not Found")

        with tempfile.TemporaryDirectory() as directory, patch.object(main.httpx, "stream") as stream:
            stream.return_value.__enter__.return_value = response
            with self.assertRaisesRegex(RuntimeError, "404 Not Found"):
                main.download_direct_video("http://minio:9000/media/video.mp4", directory)

    def test_direct_download_rejects_non_http_scheme(self):
        with self.assertRaises(ValueError):
            main.resolve_direct_video_url("file:///tmp/video.mp4")


if __name__ == "__main__":
    unittest.main()
