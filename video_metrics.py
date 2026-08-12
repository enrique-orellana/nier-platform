"""Structured timing and counter collection for video-generation jobs."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
import json
import os
from pathlib import Path
import tempfile
import time
from typing import Callable


class JobVideoMetrics:
    def __init__(self, *, clock: Callable[[], float] = time.monotonic):
        self._clock = clock
        self.durations: dict[str, float] = {}
        self.counters: dict[str, int] = {}
        self.cache_status: dict[str, str] = {}

    def add_duration(self, name: str, seconds: float) -> None:
        self.durations[name] = self.durations.get(name, 0.0) + float(seconds)

    def increment(self, name: str, amount: int = 1) -> None:
        self.counters[name] = self.counters.get(name, 0) + int(amount)

    def set_cache_status(self, name: str, status: str) -> None:
        if status not in {"hit", "miss"}:
            raise ValueError("cache status must be hit or miss")
        self.cache_status[name] = status

    @contextmanager
    def timed(self, name: str) -> Iterator[None]:
        started = self._clock()
        try:
            yield
        finally:
            self.add_duration(name, self._clock() - started)

    def to_dict(self) -> dict[str, object]:
        return {
            "durations": dict(sorted(self.durations.items())),
            "counters": dict(sorted(self.counters.items())),
            "cache_status": dict(sorted(self.cache_status.items())),
        }

    def write_json(self, path: str | Path) -> None:
        destination = Path(path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=destination.parent,
                prefix=f".{destination.name}.",
                suffix=".tmp",
                delete=False,
            ) as temporary_file:
                temporary_path = Path(temporary_file.name)
                json.dump(self.to_dict(), temporary_file, indent=2, sort_keys=True)
                temporary_file.write("\n")
                temporary_file.flush()
                os.fsync(temporary_file.fileno())
            os.replace(temporary_path, destination)
            temporary_path = None
        finally:
            if temporary_path is not None:
                try:
                    temporary_path.unlink()
                except FileNotFoundError:
                    pass
