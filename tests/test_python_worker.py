import json
import shutil
from unittest.mock import patch
from pathlib import Path

import pytest

from python_worker import _legacy_api, build_clip_generation_command, load_generation_result, parse_request


def test_parse_request_requires_id_and_operation():
    with pytest.raises(ValueError, match="request id is required"):
        parse_request(json.dumps({"operation": "clip_generation"}))


def test_build_clip_generation_command_preserves_job_inputs():
    request = parse_request(
        json.dumps(
            {
                "id": "job-1",
                "operation": "clip_generation",
                "source_url": "https://example.com/video.mp4",
                "output_dir": "output/job-1",
                "clip_count": 4,
                "source_context_url": "https://example.com/source",
            }
        )
    )

    assert build_clip_generation_command(request) == [
        "-u",
        "main.py",
        "--direct-url",
        "https://example.com/video.mp4",
        "--source-url",
        "https://example.com/source",
        "--target-clips",
        "4",
        "--keep-original",
        "-o",
        "output/job-1",
    ]


def test_build_clip_generation_command_rejects_missing_source():
    request = parse_request(
        json.dumps(
            {
                "id": "job-1",
                "operation": "clip_generation",
                "output_dir": "output/job-1",
            }
        )
    )

    with pytest.raises(ValueError, match="exactly one source"):
        build_clip_generation_command(request)


def test_load_generation_result_reads_metadata_for_go_status_api():
    output_dir = Path(".cache") / "python-worker-test"
    output_dir.mkdir(parents=True, exist_ok=True)
    try:
        (output_dir / "source_metadata.json").write_text(
            json.dumps({"shorts": [{"title": "First clip"}], "cost_analysis": {"total": 1.2}}),
            encoding="utf-8",
        )

        assert load_generation_result(str(output_dir)) == {
            "clips": [{"title": "First clip"}],
            "cost_analysis": {"total": 1.2},
        }
    finally:
        shutil.rmtree(output_dir, ignore_errors=True)


def test_thumbnail_publish_status_returns_persisted_result():
    tmp_path = Path(".cache") / "python-worker-publish-test"
    tmp_path.mkdir(parents=True, exist_ok=True)
    state = {"status": "done", "result": {"upload_id": "upload-1"}, "error": None}
    try:
        (tmp_path / ".thumbnail_publish_publish-1.json").write_text(json.dumps(state), encoding="utf-8")

        result = _legacy_api(
            {
                "payload": {"action": "thumbnail_publish_status", "publish_id": "publish-1"},
                "output_dir": str(tmp_path),
                "headers": {},
            }
        )

        assert result == state
    finally:
        shutil.rmtree(tmp_path, ignore_errors=True)


def test_thumbnail_publish_uses_caller_supplied_publish_id():
    tmp_path = Path(".cache") / "python-worker-publish-id-test"
    tmp_path.mkdir(parents=True, exist_ok=True)
    try:
        video_path = tmp_path / "source.mp4"
        video_path.write_bytes(b"video")
        thumbnail_path = tmp_path / "thumbnails" / "session-1" / "thumb.jpg"
        thumbnail_path.parent.mkdir(parents=True, exist_ok=True)
        thumbnail_path.write_bytes(b"thumbnail")
        (tmp_path / ".thumbnail_sessions.json").write_text(
            json.dumps({"session-1": {"video_path": str(video_path)}}), encoding="utf-8"
        )

        class FakeResponse:
            status_code = 200
            text = ""

            @staticmethod
            def json():
                return {"upload_id": "upload-1"}

        class FakeClient:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            @staticmethod
            def post(*_args, **_kwargs):
                return FakeResponse()

        with patch("httpx.Client", return_value=FakeClient()):
            result = _legacy_api(
                {
                    "payload": {
                        "action": "thumbnail_publish",
                        "session_id": "session-1",
                        "publish_id": "publish-1",
                        "thumbnail_url": "/thumbnails/session-1/thumb.jpg",
                        "api_key": "key",
                        "user_id": "user",
                    },
                    "output_dir": str(tmp_path),
                    "headers": {},
                }
            )

        assert result["publish_id"] == "publish-1"
        assert (tmp_path / ".thumbnail_publish_publish-1.json").is_file()
    finally:
        shutil.rmtree(tmp_path, ignore_errors=True)
