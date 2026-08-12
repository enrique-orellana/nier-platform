import tempfile
import unittest
from pathlib import Path

from video_analysis import SourceAnalysis, load_or_build_source_analysis


class VideoAnalysisTests(unittest.TestCase):
    def test_source_analysis_round_trips_through_json_safe_dict(self):
        analysis = SourceAnalysis(
            source_fingerprint={"size": 123, "mtime_ns": 456, "codec": "h264"},
            source_fps=30.0,
            total_frames=900,
            width=1080,
            height=1920,
            scene_boundaries=[(0, 300), (300, 900)],
            scene_strategies=["GENERAL", "TRACK"],
            analysis_version=1,
        )

        restored = SourceAnalysis.from_dict(analysis.to_dict())

        self.assertEqual(restored, analysis)

    def test_cache_hit_does_not_repeat_expensive_builders(self):
        calls = {"scenes": 0, "strategies": 0}

        def build_scenes():
            calls["scenes"] += 1
            return [(0, 100), (100, 200)]

        def build_strategies(_scenes):
            calls["strategies"] += 1
            return ["TRACK", "GENERAL"]

        with tempfile.TemporaryDirectory() as directory:
            cache_path = Path(directory) / "source_analysis.json"
            first = load_or_build_source_analysis(
                cache_path=cache_path,
                source_fingerprint={"size": 10, "mtime_ns": 20, "codec": "h264"},
                source_fps=30.0,
                total_frames=200,
                width=1920,
                height=1080,
                scene_builder=build_scenes,
                strategy_builder=build_strategies,
            )
            second = load_or_build_source_analysis(
                cache_path=cache_path,
                source_fingerprint={"size": 10, "mtime_ns": 20, "codec": "h264"},
                source_fps=30.0,
                total_frames=200,
                width=1920,
                height=1080,
                scene_builder=build_scenes,
                strategy_builder=build_strategies,
            )

        self.assertEqual(first, second)
        self.assertEqual(calls, {"scenes": 1, "strategies": 1})

    def test_cache_is_rebuilt_when_source_fingerprint_changes(self):
        calls = {"scenes": 0, "strategies": 0}

        def build_scenes():
            calls["scenes"] += 1
            return [(0, 100)]

        def build_strategies(_scenes):
            calls["strategies"] += 1
            return ["TRACK"]

        with tempfile.TemporaryDirectory() as directory:
            cache_path = Path(directory) / "source_analysis.json"
            common = {
                "cache_path": cache_path,
                "source_fps": 30.0,
                "total_frames": 100,
                "width": 1920,
                "height": 1080,
                "scene_builder": build_scenes,
                "strategy_builder": build_strategies,
            }
            load_or_build_source_analysis(
                **common,
                source_fingerprint={"size": 10, "mtime_ns": 20, "codec": "h264"},
            )
            load_or_build_source_analysis(
                **common,
                source_fingerprint={"size": 10, "mtime_ns": 21, "codec": "h264"},
            )

        self.assertEqual(calls, {"scenes": 2, "strategies": 2})


if __name__ == "__main__":
    unittest.main()
