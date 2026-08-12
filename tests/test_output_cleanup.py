from pathlib import Path

from app import is_expirable_output_directory


def test_cleanup_never_treats_persistent_codex_directory_as_an_expirable_job(tmp_path):
    output_dir = tmp_path / "output"
    auth_dir = output_dir / ".openshorts"
    job_dir = output_dir / "job-123"
    auth_dir.mkdir(parents=True)
    job_dir.mkdir()

    assert is_expirable_output_directory(auth_dir, output_dir) is False
    assert is_expirable_output_directory(job_dir, output_dir) is True
