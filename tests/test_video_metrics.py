import json
import tempfile
import unittest
from pathlib import Path

from video_metrics import JobVideoMetrics


class VideoMetricsTests(unittest.TestCase):
    def test_metrics_accumulate_durations_counters_and_cache_status(self):
        clock_values = iter([10.0, 12.5])
        metrics = JobVideoMetrics(clock=lambda: next(clock_values))

        with metrics.timed("scene_analysis"):
            pass
        metrics.increment("decoded_frames", 120)
        metrics.increment("output_frames", 60)
        metrics.set_cache_status("source_analysis", "miss")

        payload = metrics.to_dict()

        self.assertEqual(payload["durations"]["scene_analysis"], 2.5)
        self.assertEqual(payload["counters"]["decoded_frames"], 120)
        self.assertEqual(payload["counters"]["output_frames"], 60)
        self.assertEqual(payload["cache_status"]["source_analysis"], "miss")

    def test_metrics_write_json_is_readable(self):
        metrics = JobVideoMetrics()
        metrics.increment("output_bytes", 42)

        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "generation_metrics.json"
            metrics.write_json(destination)
            payload = json.loads(destination.read_text(encoding="utf-8"))

        self.assertEqual(payload["counters"]["output_bytes"], 42)


if __name__ == "__main__":
    unittest.main()
