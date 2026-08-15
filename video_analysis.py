"""Reusable source-video analysis and cache serialization."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
import json
import os
from pathlib import Path
import tempfile
from typing import Any


ANALYSIS_VERSION = 2


def _json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, Mapping):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    return str(value)


def _frame_number(value: Any) -> int:
    frame_number = getattr(value, "frame_num", value)
    return int(frame_number)


def _normalize_scene_boundaries(scenes: Any) -> list[tuple[int, int]]:
    boundaries: list[tuple[int, int]] = []
    for scene in scenes or []:
        if len(scene) != 2:
            raise ValueError("each scene must contain a start and end frame")
        start_frame = _frame_number(scene[0])
        end_frame = _frame_number(scene[1])
        if start_frame < 0 or end_frame <= start_frame:
            raise ValueError("scene boundaries must be positive and increasing")
        boundaries.append((start_frame, end_frame))
    return boundaries


def _normalize_strategies(strategies: Any) -> list[str]:
    return [str(strategy) for strategy in (strategies or [])]


@dataclass(frozen=True)
class SourceAnalysis:
    source_fingerprint: dict[str, object]
    source_fps: float
    total_frames: int
    width: int
    height: int
    scene_boundaries: list[tuple[int, int]]
    scene_strategies: list[str]
    analysis_version: int = ANALYSIS_VERSION

    def to_dict(self) -> dict[str, object]:
        return {
            "source_fingerprint": _json_safe(self.source_fingerprint),
            "source_fps": float(self.source_fps),
            "total_frames": int(self.total_frames),
            "width": int(self.width),
            "height": int(self.height),
            "scene_boundaries": [
                [int(start_frame), int(end_frame)]
                for start_frame, end_frame in self.scene_boundaries
            ],
            "scene_strategies": [str(strategy) for strategy in self.scene_strategies],
            "analysis_version": int(self.analysis_version),
        }

    @classmethod
    def from_dict(cls, payload: dict[str, object]) -> "SourceAnalysis":
        if not isinstance(payload, Mapping):
            raise ValueError("source analysis cache must contain an object")

        boundaries = _normalize_scene_boundaries(payload["scene_boundaries"])
        strategies = _normalize_strategies(payload["scene_strategies"])
        fingerprint = payload["source_fingerprint"]
        if not isinstance(fingerprint, Mapping):
            raise ValueError("source analysis fingerprint must be an object")

        return cls(
            source_fingerprint=dict(_json_safe(fingerprint)),
            source_fps=float(payload["source_fps"]),
            total_frames=int(payload["total_frames"]),
            width=int(payload["width"]),
            height=int(payload["height"]),
            scene_boundaries=boundaries,
            scene_strategies=strategies,
            analysis_version=int(payload["analysis_version"]),
        )


def _cache_matches(
    cached: SourceAnalysis,
    *,
    source_fingerprint: dict[str, object],
    source_fps: float,
    total_frames: int,
    width: int,
    height: int,
) -> bool:
    return (
        cached.analysis_version == ANALYSIS_VERSION
        and cached.source_fingerprint == dict(_json_safe(source_fingerprint))
        and cached.source_fps == float(source_fps)
        and cached.total_frames == int(total_frames)
        and cached.width == int(width)
        and cached.height == int(height)
    )


def _read_cache(cache_path: Path) -> SourceAnalysis | None:
    try:
        with cache_path.open("r", encoding="utf-8") as cache_file:
            return SourceAnalysis.from_dict(json.load(cache_file))
    except (OSError, TypeError, ValueError, KeyError, json.JSONDecodeError):
        return None


def _write_cache(cache_path: Path, analysis: SourceAnalysis) -> None:
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=cache_path.parent,
            prefix=f".{cache_path.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary_file:
            temporary_path = Path(temporary_file.name)
            json.dump(analysis.to_dict(), temporary_file, indent=2, sort_keys=True)
            temporary_file.write("\n")
            temporary_file.flush()
            os.fsync(temporary_file.fileno())
        os.replace(temporary_path, cache_path)
        temporary_path = None
    finally:
        if temporary_path is not None:
            try:
                temporary_path.unlink()
            except FileNotFoundError:
                pass


def load_or_build_source_analysis(
    *,
    cache_path: Path,
    source_fingerprint: dict[str, object],
    source_fps: float,
    total_frames: int,
    width: int,
    height: int,
    scene_builder: Callable[[], list[Any]],
    strategy_builder: Callable[[list[Any]], list[str]],
    cache_status_callback: Callable[[str], None] | None = None,
) -> SourceAnalysis:
    """Load matching source analysis or build and atomically cache it."""
    cache_path = Path(cache_path)
    cached = _read_cache(cache_path) if cache_path.exists() else None
    if cached is not None and _cache_matches(
        cached,
        source_fingerprint=source_fingerprint,
        source_fps=source_fps,
        total_frames=total_frames,
        width=width,
        height=height,
    ):
        if cache_status_callback is not None:
            cache_status_callback("hit")
        return cached

    if cache_status_callback is not None:
        cache_status_callback("miss")

    scenes = scene_builder()
    boundaries = _normalize_scene_boundaries(scenes)
    strategies = _normalize_strategies(strategy_builder(scenes))
    if len(boundaries) != len(strategies):
        raise ValueError("scene strategy count must match scene boundary count")

    analysis = SourceAnalysis(
        source_fingerprint=dict(_json_safe(source_fingerprint)),
        source_fps=float(source_fps),
        total_frames=int(total_frames),
        width=int(width),
        height=int(height),
        scene_boundaries=boundaries,
        scene_strategies=strategies,
    )
    _write_cache(cache_path, analysis)
    return analysis
