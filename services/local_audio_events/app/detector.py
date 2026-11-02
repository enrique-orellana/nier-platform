"""Provider-neutral audio-event detection contracts and detector registry."""

from __future__ import annotations

import csv
import math
import os
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Callable, Sequence


YAMNET_FRAME_HOP_SECONDS = 0.48
YAMNET_FRAME_WINDOW_SECONDS = 0.96

_EVENT_LABELS = {
    "applause": "Applause",
    "clapping": "Applause",
    "cheering": "Cheering",
    "cough": "Coughing",
    "coughing": "Coughing",
    "crying": "Crying",
    "crying, sobbing": "Crying",
    "giggle": "Laughter",
    "gasp": "Gasp",
    "groan": "Breathing",
    "laughter": "Laughter",
    "knock": "Impact",
    "bang": "Impact",
    "crash": "Impact",
    "explosion": "Impact",
    "slap": "Impact",
    "thump": "Impact",
    "screaming": "Shouting",
    "shout": "Shouting",
    "sigh": "Breathing",
    "sneeze": "Coughing",
    "snicker": "Laughter",
    "snoring": "Breathing",
    "sobbing": "Crying",
    "throat clearing": "Coughing",
    "whimper": "Crying",
    "yell": "Shouting",
}


class AudioEventDetector(ABC):
    """Contract implemented by a single local sound-event model."""

    identifier: str

    @abstractmethod
    def detect(
        self, waveform: Any, *, duration_seconds: float
    ) -> list[dict[str, Any]]:
        """Return normalized event intervals for one decoded audio chunk."""


class DetectorRegistry:
    """Explicit deterministic registry; an unknown detector never falls back."""

    def __init__(self) -> None:
        self._factories: dict[str, Callable[[], AudioEventDetector]] = {}

    def register(
        self, identifier: str, factory: Callable[[], AudioEventDetector]
    ) -> None:
        key = identifier.strip().lower()
        if not key:
            raise ValueError("detector identifier cannot be empty")
        if key in self._factories:
            raise ValueError(f"audio-event detector '{key}' is already registered")
        self._factories[key] = factory

    def create(self, identifier: str) -> AudioEventDetector:
        key = identifier.strip().lower()
        try:
            factory = self._factories[key]
        except KeyError as exc:
            raise ValueError(
                f"unsupported audio-event detector: {key or '<empty>'}"
            ) from exc
        return factory()


class YamNetAudioEventDetector(AudioEventDetector):
    """Convert YAMNet frame scores into compact, timestamped event intervals."""

    identifier = "yamnet"

    def __init__(
        self,
        model: Any,
        class_names: Sequence[str],
        *,
        min_confidence: float = 0.4,
        frame_hop_seconds: float = YAMNET_FRAME_HOP_SECONDS,
        frame_window_seconds: float = YAMNET_FRAME_WINDOW_SECONDS,
        merge_gap_frames: int = 1,
    ) -> None:
        if not math.isfinite(min_confidence) or not 0.0 <= min_confidence <= 1.0:
            raise ValueError("min_confidence must be between 0 and 1")
        if frame_hop_seconds <= 0 or frame_window_seconds <= 0:
            raise ValueError("YAMNet frame durations must be positive")
        if merge_gap_frames < 0:
            raise ValueError("merge_gap_frames cannot be negative")
        self._model = model
        self._class_names = tuple(class_names)
        self._min_confidence = min_confidence
        self._frame_hop_seconds = frame_hop_seconds
        self._frame_window_seconds = frame_window_seconds
        self._merge_gap_frames = merge_gap_frames

    @classmethod
    def from_environment(cls) -> "YamNetAudioEventDetector":
        """Load only the explicitly selected TensorFlow Hub model."""
        try:
            import tensorflow_hub as hub
        except ImportError as exc:
            raise RuntimeError(
                "The yamnet detector requires tensorflow-cpu and tensorflow-hub"
            ) from exc

        model_url = os.environ.get("YAMNET_MODEL_URL", "").strip()
        if not model_url:
            raise ValueError("YAMNET_MODEL_URL must be configured")
        try:
            min_confidence = float(
                os.environ.get("YAMNET_EVENT_MIN_CONFIDENCE", "")
            )
        except ValueError as exc:
            raise ValueError(
                "YAMNET_EVENT_MIN_CONFIDENCE must be between 0 and 1"
            ) from exc
        if not math.isfinite(min_confidence) or not 0.0 <= min_confidence <= 1.0:
            raise ValueError("YAMNET_EVENT_MIN_CONFIDENCE must be between 0 and 1")

        model = hub.load(model_url)
        class_map = Path(model.class_map_path().numpy().decode("utf-8"))
        with class_map.open("r", encoding="utf-8", newline="") as csv_file:
            class_names = [row["display_name"] for row in csv.DictReader(csv_file)]
        return cls(model, class_names, min_confidence=min_confidence)

    def detect(
        self, waveform: Any, *, duration_seconds: float
    ) -> list[dict[str, Any]]:
        if not math.isfinite(duration_seconds) or duration_seconds <= 0:
            raise ValueError("duration_seconds must be finite and positive")

        output = self._model(waveform)
        scores = output[0] if isinstance(output, (tuple, list)) else output
        score_rows = self._to_rows(scores)
        if any(len(row) != len(self._class_names) for row in score_rows):
            raise ValueError("YAMNet scores do not match its class map")

        scores_by_event: dict[str, dict[int, float]] = {}
        for class_index, class_name in enumerate(self._class_names):
            event_label = _EVENT_LABELS.get(class_name.strip().casefold())
            if event_label is None:
                continue
            for frame_index, row in enumerate(score_rows):
                confidence = row[class_index]
                if confidence < self._min_confidence:
                    continue
                label_frames = scores_by_event.setdefault(event_label, {})
                label_frames[frame_index] = max(
                    label_frames.get(frame_index, 0.0), confidence
                )

        events: list[dict[str, Any]] = []
        for label, frame_scores in scores_by_event.items():
            events.extend(self._merge_frames(label, frame_scores, duration_seconds))
        events.sort(key=lambda event: (event["start"], event["end"], event["label"]))
        return events

    def _merge_frames(
        self,
        label: str,
        frame_scores: dict[int, float],
        duration_seconds: float,
    ) -> list[dict[str, Any]]:
        active = sorted(frame_scores.items())
        if not active:
            return []

        groups: list[list[tuple[int, float]]] = []
        current = [active[0]]
        for item in active[1:]:
            if item[0] - current[-1][0] <= self._merge_gap_frames + 1:
                current.append(item)
            else:
                groups.append(current)
                current = [item]
        groups.append(current)

        events = []
        for group in groups:
            start = group[0][0] * self._frame_hop_seconds
            end = group[-1][0] * self._frame_hop_seconds + self._frame_window_seconds
            start = min(duration_seconds, max(0.0, start))
            end = min(duration_seconds, max(start, end))
            events.append(
                {
                    "start": round(start, 3),
                    "end": round(end, 3),
                    "label": label,
                    "confidence": round(max(score for _, score in group), 4),
                }
            )
        return events

    @staticmethod
    def _to_rows(scores: Any) -> list[list[float]]:
        if hasattr(scores, "numpy"):
            scores = scores.numpy()
        if hasattr(scores, "tolist"):
            scores = scores.tolist()
        try:
            rows = [[float(value) for value in row] for row in scores]
        except (TypeError, ValueError) as exc:
            raise ValueError("YAMNet returned an invalid score matrix") from exc
        if any(
            not math.isfinite(value) or not 0.0 <= value <= 1.0
            for row in rows
            for value in row
        ):
            raise ValueError("YAMNet returned an invalid confidence score")
        return rows


detector_registry = DetectorRegistry()
detector_registry.register("yamnet", YamNetAudioEventDetector.from_environment)


def create_detector(identifier: str) -> AudioEventDetector:
    return detector_registry.create(identifier)
