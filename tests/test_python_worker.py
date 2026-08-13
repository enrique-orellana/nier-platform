import json
import shutil
from pathlib import Path

import pytest

from python_worker import build_clip_generation_command, load_generation_result, parse_request


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
