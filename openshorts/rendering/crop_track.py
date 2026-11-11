"""Serializable, deterministic camera crop tracks."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


def _bounded(value: float, name: str) -> float:
    if not 0.0 <= value <= 1.0:
        raise ValueError(f"{name} must be between 0 and 1")
    return float(value)


@dataclass(frozen=True)
class CropRect:
    x: float
    y: float
    width: float
    height: float

    def __post_init__(self):
        for name, value in (("x", self.x), ("y", self.y), ("width", self.width), ("height", self.height)):
            _bounded(value, name)
        if self.width <= 0 or self.height <= 0 or self.x + self.width > 1 or self.y + self.height > 1:
            raise ValueError("crop rectangle must be positive and inside the source")

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "CropRect":
        return cls(float(value["x"]), float(value["y"]), float(value["width"]), float(value["height"]))

    def to_dict(self) -> dict[str, float]:
        return {"x": self.x, "y": self.y, "width": self.width, "height": self.height}


@dataclass(frozen=True)
class CropKeyframe:
    time_sec: float
    rect: CropRect

    def to_dict(self) -> dict[str, Any]:
        return {"time_sec": self.time_sec, "rect": self.rect.to_dict()}


@dataclass(frozen=True)
class CropScene:
    start_sec: float
    end_sec: float
    strategy: str
    keyframes: tuple[CropKeyframe, ...]

    def __post_init__(self):
        if self.strategy not in {"TRACK", "GENERAL"}:
            raise ValueError("crop strategy must be TRACK or GENERAL")
        if self.start_sec < 0 or self.end_sec <= self.start_sec:
            raise ValueError("crop scene times must be increasing")
        previous = self.start_sec - 1
        for keyframe in self.keyframes:
            if keyframe.time_sec < self.start_sec or keyframe.time_sec > self.end_sec or keyframe.time_sec < previous:
                raise ValueError("crop keyframes must be sorted within their scene")
            previous = keyframe.time_sec

    def to_dict(self) -> dict[str, Any]:
        return {
            "start_sec": self.start_sec,
            "end_sec": self.end_sec,
            "strategy": self.strategy,
            "keyframes": [keyframe.to_dict() for keyframe in self.keyframes],
        }


@dataclass(frozen=True)
class CropTrack:
    scenes: tuple[CropScene, ...]

    def __post_init__(self):
        previous_end = 0.0
        for scene in self.scenes:
            if scene.start_sec < previous_end:
                raise ValueError("crop scenes must not overlap")
            previous_end = scene.end_sec

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "CropTrack":
        scenes = []
        for scene in value.get("scenes", []):
            keyframes = tuple(
                CropKeyframe(float(key["time_sec"]), CropRect.from_dict(key["rect"]))
                for key in scene.get("keyframes", [])
            )
            scenes.append(CropScene(float(scene["start_sec"]), float(scene["end_sec"]), scene["strategy"], keyframes))
        return cls(tuple(scenes))

    def to_dict(self) -> dict[str, Any]:
        return {"scenes": [scene.to_dict() for scene in self.scenes]}

    def rectangle_at(self, time_sec: float) -> CropRect | None:
        scene = None
        for index, item in enumerate(self.scenes):
            is_last = index == len(self.scenes) - 1
            if item.start_sec <= time_sec < item.end_sec or (is_last and time_sec == item.end_sec):
                scene = item
                break
        if scene is None or not scene.keyframes:
            return None
        if scene.strategy == "GENERAL":
            return scene.keyframes[0].rect
        if time_sec <= scene.keyframes[0].time_sec:
            return scene.keyframes[0].rect
        if time_sec >= scene.keyframes[-1].time_sec:
            return scene.keyframes[-1].rect
        for left, right in zip(scene.keyframes, scene.keyframes[1:]):
            if left.time_sec <= time_sec <= right.time_sec:
                span = right.time_sec - left.time_sec
                factor = 0.0 if span == 0 else (time_sec - left.time_sec) / span
                return CropRect(
                    x=left.rect.x + (right.rect.x - left.rect.x) * factor,
                    y=left.rect.y + (right.rect.y - left.rect.y) * factor,
                    width=left.rect.width + (right.rect.width - left.rect.width) * factor,
                    height=left.rect.height + (right.rect.height - left.rect.height) * factor,
                )
        return scene.keyframes[-1].rect
