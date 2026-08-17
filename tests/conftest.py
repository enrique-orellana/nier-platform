"""Test-only filesystem helpers for the managed Windows test environment."""

from __future__ import annotations

import shutil
import tempfile
import uuid
from pathlib import Path

import pytest


_TEST_TEMP_ROOT = Path(__file__).parent / ".pytest-workspace-temp"


def _new_workspace_temp_dir(*, prefix: str = "tmp", suffix: str = "") -> Path:
    _TEST_TEMP_ROOT.mkdir(parents=True, exist_ok=True)
    path = _TEST_TEMP_ROOT / f"{prefix}{uuid.uuid4().hex}{suffix}"
    path.mkdir(parents=True, exist_ok=False)
    return path


def _workspace_mkdtemp(suffix: str | None = None, prefix: str | None = None, dir: str | None = None) -> str:
    parent = Path(dir) if dir else _TEST_TEMP_ROOT
    parent.mkdir(parents=True, exist_ok=True)
    path = parent / f"{prefix or 'tmp'}{uuid.uuid4().hex}{suffix or ''}"
    path.mkdir(parents=True, exist_ok=False)
    return str(path)


class _WorkspaceTemporaryDirectory:
    def __init__(self, suffix: str | None = None, prefix: str | None = None, dir: str | None = None, **_kwargs):
        self.name = _workspace_mkdtemp(suffix=suffix, prefix=prefix, dir=dir)

    def __enter__(self) -> str:
        return self.name

    def __exit__(self, exc_type, exc_value, traceback) -> None:
        self.cleanup()

    def cleanup(self) -> None:
        shutil.rmtree(self.name, ignore_errors=True)


# Python-created temporary directories are inaccessible in this managed
# Windows environment. Keep the production code untouched and redirect only
# test-created temporary files to a repository-local directory.
tempfile.mkdtemp = _workspace_mkdtemp
tempfile.TemporaryDirectory = _WorkspaceTemporaryDirectory


@pytest.fixture
def tmp_path(request) -> Path:
    path = _new_workspace_temp_dir(prefix=f"{request.node.name}-")
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)
