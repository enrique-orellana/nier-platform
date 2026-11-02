"""Cross-process slots for provider inference work, kept outside rendering."""

from __future__ import annotations

import os
import threading
from contextlib import contextmanager
from functools import wraps
from pathlib import Path
from typing import Iterator

from filelock import FileLock, Timeout as FileLockTimeout

_thread_state = threading.local()


def _lock_settings() -> tuple[int, Path]:
    raw_limit = os.environ.get("AI_ANALYSIS_CONCURRENCY", "1")
    try:
        limit = int(raw_limit)
    except (TypeError, ValueError) as exc:
        raise ValueError("AI_ANALYSIS_CONCURRENCY must be a positive integer") from exc
    if limit < 1:
        raise ValueError("AI_ANALYSIS_CONCURRENCY must be a positive integer")
    default_root = (
        Path(os.environ.get("OUTPUT_DIR", "output"))
        / ".openshorts"
        / "audio-analysis-locks"
    )
    raw_directory = os.environ.get("LOCAL_AUDIO_ANALYSIS_LOCK_DIR", "").strip()
    directory = Path(raw_directory or default_root)
    return limit, directory


@contextmanager
def analysis_job_lock() -> Iterator[None]:
    """Hold one configured analysis slot, re-entrantly within the same thread."""
    held = getattr(_thread_state, "held", None)
    if held is not None:
        held["depth"] += 1
        try:
            yield
        finally:
            held["depth"] -= 1
        return

    limit, directory = _lock_settings()
    directory.mkdir(parents=True, exist_ok=True)
    slot_locks = [
        FileLock(str(directory / f"analysis-{index}.lock")) for index in range(limit)
    ]
    acquired = None
    while acquired is None:
        for lock in slot_locks:
            try:
                lock.acquire(timeout=0)
                acquired = lock
                break
            except FileLockTimeout:
                continue
        if acquired is None:
            try:
                slot_locks[0].acquire(timeout=-1)
                acquired = slot_locks[0]
            except FileLockTimeout:
                continue

    _thread_state.held = {"lock": acquired, "depth": 1}
    try:
        yield
    finally:
        _thread_state.held = None
        acquired.release()


def analysis_locked(function):
    """Serialize an AI-only function while leaving subsequent rendering free."""

    @wraps(function)
    def wrapped(*args, **kwargs):
        with analysis_job_lock():
            return function(*args, **kwargs)

    return wrapped
