from pathlib import Path
from unittest.mock import patch

import app as app_module


def test_prepare_minio_job_command_uses_temporary_input_path(tmp_path):
    source_object = {"bucket": "youtube-downloads", "key": "videos/source.bin"}

    with patch.object(app_module.tempfile, "mkdtemp", return_value=str(tmp_path / "source-job")):
        with patch.object(app_module, "download_source_object") as download:
            command, temporary_root = app_module._prepare_minio_job_command(
                "job-1",
                {
                    "cmd": ["python", "-u", "main.py", "--target-clips", "3"],
                    "source_object": source_object,
                },
            )

    source_path = str(Path(temporary_root) / "source.bin")
    download.assert_called_once_with(
        "youtube-downloads",
        "videos/source.bin",
        source_path,
        max_bytes=app_module.MAX_FILE_SIZE_MB * 1024 * 1024,
    )
    assert command[:5] == ["python", "-u", "main.py", "--target-clips", "3"]
    assert command[-2:] == ["--input", source_path]
    assert not str(Path(app_module.OUTPUT_DIR) / "job-1") in source_path
