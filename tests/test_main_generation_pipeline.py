import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import main
from media_probe import AudioProbe, MediaProbe
from video_analysis import SourceAnalysis


def source_media():
    return MediaProbe(
        path="source.mp4",
        width=1920,
        height=1080,
        display_width=1920,
        display_height=1080,
        duration_seconds=10.0,
        fps=30.0,
        fps_fraction="30/1",
        codec="h264",
        profile="High",
        pixel_format="yuv420p",
        color_range="tv",
        color_space="bt709",
        color_transfer="bt709",
        color_primaries="bt709",
        rotation=0,
        size_bytes=100,
        audio=AudioProbe("aac", 48000, 2, "stereo", 10.0),
        frame_count=300,
    )


class FakeCapture:
    def __init__(self):
        self.released = False

    def get(self, property_id):
        values = {
            main.cv2.CAP_PROP_FPS: 30.0,
            main.cv2.CAP_PROP_FRAME_COUNT: 300,
            main.cv2.CAP_PROP_FRAME_WIDTH: 1920,
            main.cv2.CAP_PROP_FRAME_HEIGHT: 1080,
        }
        return values[property_id]

    def release(self):
        self.released = True


class MainGenerationPipelineTests(unittest.TestCase):
    def test_source_analysis_builders_run_once_and_cache_reuses_result(self):
        with tempfile.TemporaryDirectory() as directory:
            source_path = Path(directory) / "source.mp4"
            output_dir = Path(directory) / "output"
            source_path.write_bytes(b"source")
            output_dir.mkdir()
            scene_calls = Mock(return_value=([(0, 100), (100, 300)], 30.0))
            strategy_calls = Mock(return_value=["TRACK", "GENERAL"])

            with patch.object(main, "probe_media", return_value=source_media()), patch.object(
                main.cv2, "VideoCapture", return_value=FakeCapture()
            ), patch.object(main, "detect_scenes", scene_calls), patch.object(
                main, "analyze_scenes_strategy", strategy_calls
            ):
                first = main.build_source_analysis_for_job(str(source_path), str(output_dir))
                second = main.build_source_analysis_for_job(str(source_path), str(output_dir))

        self.assertEqual(first, second)
        scene_calls.assert_called_once_with(str(source_path))
        strategy_calls.assert_called_once()

    def test_empty_scene_detection_uses_one_full_source_scene(self):
        with tempfile.TemporaryDirectory() as directory:
            source_path = Path(directory) / "source.mp4"
            output_dir = Path(directory) / "output"
            source_path.write_bytes(b"source")
            output_dir.mkdir()

            with patch.object(main, "probe_media", return_value=source_media()), patch.object(
                main.cv2, "VideoCapture", return_value=FakeCapture()
            ), patch.object(main, "detect_scenes", return_value=([], 30.0)), patch.object(
                main, "analyze_scenes_strategy", return_value=["GENERAL"]
            ) as strategy:
                analysis = main.build_source_analysis_for_job(str(source_path), str(output_dir))

        self.assertEqual(analysis.scene_boundaries, [(0, 300)])
        self.assertEqual(analysis.scene_strategies, ["GENERAL"])
        strategy.assert_called_once_with(str(source_path), [(0, 300)])

    def test_render_clip_plan_passes_one_analysis_to_every_clip(self):
        analysis = SourceAnalysis(
            source_fingerprint={"size": 1},
            source_fps=30.0,
            total_frames=300,
            width=1920,
            height=1080,
            scene_boundaries=[(0, 300)],
            scene_strategies=["TRACK"],
        )
        clips = [
            {"start": 0.0, "end": 2.0, "video_title_for_youtube_short": "one"},
            {"start": 3.0, "end": 5.0, "video_title_for_youtube_short": "two"},
        ]

        with tempfile.TemporaryDirectory() as directory:
            with patch.object(main, "process_video_to_vertical", return_value=True) as render:
                with patch.object(main, "_write_clip_manifest", return_value="manifests/clip.json"):
                    with patch.object(main, "detect_scenes") as detect_scenes, patch.object(
                        main, "analyze_scenes_strategy"
                    ) as analyze_strategy:
                        result = main.render_clip_plan(
                            input_video="source.mp4",
                            output_dir=directory,
                            video_title="source",
                            clips=clips,
                            source_analysis=analysis,
                            transcript={},
                            source_asset={"asset_id": "source"},
                            source_media=source_media(),
                        )

        self.assertEqual(len(result), 2)
        self.assertEqual(render.call_count, 2)
        for call in render.call_args_list:
            self.assertIs(call.kwargs["source_analysis"], analysis)
        self.assertEqual(
            [clip["video_filename"] for clip in result],
            ["source_clip_1.mp4", "source_clip_2.mp4"],
        )
        self.assertTrue(all("_temp" not in clip["video_filename"] for clip in result))
        detect_scenes.assert_not_called()
        analyze_strategy.assert_not_called()

    def test_render_clip_plan_propagates_streamer_layout_options(self):
        analysis = SourceAnalysis(
            source_fingerprint={"size": 1},
            source_fps=30.0,
            total_frames=300,
            width=1920,
            height=1080,
            scene_boundaries=[(0, 300)],
            scene_strategies=["TRACK"],
        )
        clips = [{"start": 0.0, "end": 2.0}]

        with tempfile.TemporaryDirectory() as directory:
            with patch.object(main, "process_video_to_vertical", return_value=True) as render:
                with patch.object(main, "_write_clip_manifest", return_value="manifests/clip.json"):
                    result = main.render_clip_plan(
                        input_video="source.mp4",
                        output_dir=directory,
                        video_title="source",
                        clips=clips,
                        source_analysis=analysis,
                        transcript={},
                        source_asset={"asset_id": "source"},
                        source_media=source_media(),
                        layout_format="streamer_stack",
                        facecam_size="large",
                    )

        self.assertEqual(render.call_count, 1)
        self.assertEqual(render.call_args.kwargs["layout_format"], "streamer_stack")
        self.assertEqual(render.call_args.kwargs["facecam_size"], "large")
        self.assertEqual(result[0]["layout_format"], "streamer_stack")
        self.assertEqual(result[0]["facecam_size"], "large")

    def test_clip_manifest_records_streamer_layout_metadata(self):
        clip = {"start": 1.0, "end": 4.0}

        with tempfile.TemporaryDirectory() as directory:
            manifest_path = main._write_clip_manifest(
                directory,
                "source",
                1,
                clip,
                {"asset_id": "source"},
                source_media(),
                {},
                layout_format="streamer_stack",
                facecam_size="large",
            )
            manifest = json.loads(
                (Path(directory) / manifest_path).read_text(encoding="utf-8")
            )

        self.assertEqual(manifest["layers"]["layout"], {"format": "streamer_stack", "facecam_size": "large"})
        self.assertEqual(manifest["export_policy"]["layout_format"], "streamer_stack")
        self.assertEqual(manifest["export_policy"]["facecam_size"], "large")


if __name__ == "__main__":
    unittest.main()
