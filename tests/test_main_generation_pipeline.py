import json
import subprocess
import sys
import tempfile
import types
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import Mock, patch

import main
import numpy as np
from media_probe import AudioProbe, MediaProbe
from streamer_layout import streamer_panel_heights
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


class FakeStrategyCapture:
    def __init__(self, frame):
        self.frame = frame
        self.read_count = 0
        self.released = False

    def isOpened(self):
        return self.read_count < 3

    def set(self, _property_id, _value):
        return True

    def read(self):
        if self.read_count >= 3:
            return False, None
        self.read_count += 1
        return True, self.frame.copy()

    def release(self):
        self.released = True


class FakeStreamerCapture:
    def __init__(self):
        self.frames = [np.zeros((1080, 1920, 3), dtype=np.uint8) for _ in range(2)]
        self.index = 0
        self.released = False

    def isOpened(self):
        return self.index < len(self.frames)

    def read(self):
        if self.index >= len(self.frames):
            return False, None
        frame = self.frames[self.index]
        self.index += 1
        return True, frame

    def release(self):
        self.released = True


class FakePipe:
    def write(self, value):
        return len(value)

    def close(self):
        return None

    def read(self):
        return b""


class FakeProcess:
    def __init__(self):
        self.stdin = FakePipe()
        self.stderr = FakePipe()
        self.returncode = 0

    def wait(self):
        return self.returncode


class MainGenerationPipelineTests(unittest.TestCase):
    def test_scene_frame_skip_configuration_accepts_zero_and_rejects_invalid_values(self):
        with patch.dict(main.os.environ, {"SCENE_DETECTION_FRAME_SKIP": "0"}, clear=False):
            self.assertEqual(main.scene_detection_frame_skip(), 0)
        with patch.dict(main.os.environ, {"SCENE_DETECTION_FRAME_SKIP": "bad"}, clear=False):
            self.assertEqual(main.scene_detection_frame_skip(), 2)
        with patch.dict(main.os.environ, {"SCENE_DETECTION_FRAME_SKIP": "-1"}, clear=False):
            self.assertEqual(main.scene_detection_frame_skip(), 2)

    def test_detect_scenes_passes_frame_skip_to_scene_manager(self):
        scene_manager = Mock()
        scene_manager.get_scene_list.return_value = []
        video = Mock(frame_rate=30.0)
        fake_scenedetect = types.ModuleType("scenedetect")
        fake_detectors = types.ModuleType("scenedetect.detectors")
        fake_scenedetect.open_video = Mock(return_value=video)
        fake_scenedetect.SceneManager = Mock(return_value=scene_manager)
        fake_detectors.ContentDetector = Mock()
        with patch.dict(
            sys.modules,
            {"scenedetect": fake_scenedetect, "scenedetect.detectors": fake_detectors},
        ):
            scenes, fps = main.detect_scenes("source.mp4", frame_skip=2)
        self.assertEqual(scenes, [])
        self.assertEqual(fps, 30.0)
        scene_manager.detect_scenes.assert_called_once_with(video=video, frame_skip=2)

    def test_scene_strategy_downscales_face_samples(self):
        frame = np.zeros((1080, 1920, 3), dtype=np.uint8)
        capture = FakeStrategyCapture(frame)
        with patch.object(main.cv2, "VideoCapture", return_value=capture), patch.object(
            main, "detect_face_candidates", return_value=[]
        ) as detect_faces:
            result = main.analyze_scenes_strategy("source.mp4", [(0, 90)])
        self.assertEqual(result, ["GENERAL"])
        analyzed_frame = detect_faces.call_args.args[0]
        self.assertEqual(max(analyzed_frame.shape[:2]), 640)

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
        scene_calls.assert_called_once_with(str(source_path), frame_skip=2)
        strategy_calls.assert_called_once()

    def test_source_analysis_cache_rebuilds_when_scene_frame_skip_changes(self):
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
            ), patch.dict(main.os.environ, {"SCENE_DETECTION_FRAME_SKIP": "2"}, clear=False):
                main.build_source_analysis_for_job(str(source_path), str(output_dir))
                with patch.dict(main.os.environ, {"SCENE_DETECTION_FRAME_SKIP": "0"}, clear=False):
                    main.build_source_analysis_for_job(str(source_path), str(output_dir))

        self.assertEqual(scene_calls.call_count, 2)
        self.assertEqual(strategy_calls.call_count, 2)

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
        strategy.assert_called_once_with(str(source_path), [(0, 300)], max_dimension=640)

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

    def test_streamer_render_validates_master_dimensions_fps_and_audio(self):
        analysis = SourceAnalysis(
            source_fingerprint={"size": 1},
            source_fps=30.0,
            total_frames=2,
            width=1920,
            height=1080,
            scene_boundaries=[(0, 2)],
            scene_strategies=["TRACK"],
        )

        with tempfile.TemporaryDirectory() as directory:
            output_path = Path(directory) / "streamer.mp4"

            def fake_run(command, **_kwargs):
                Path(command[-1]).touch()

            with patch.object(main.cv2, "VideoCapture", return_value=FakeStreamerCapture()), patch.object(
                main, "seek_capture_to_frame", return_value=(0, 0)
            ), patch.object(main, "detect_face_candidates", return_value=[]), patch.object(
                main, "detect_person_yolo", return_value=None
            ), patch.object(main, "compose_streamer_stack_frame", return_value=np.zeros((1920, 1080, 3), dtype=np.uint8)) as compose, patch.object(
                main.subprocess, "Popen", return_value=FakeProcess()
            ), patch.object(main.subprocess, "run", side_effect=fake_run), patch.object(
                main, "validate_clip_output"
            ) as validate:
                result = main.process_video_to_vertical(
                    "source.mp4",
                    str(output_path),
                    source_analysis=analysis,
                    source_media=source_media(),
                    layout_format="streamer_stack",
                    facecam_size="large",
                )

        self.assertTrue(result)
        self.assertEqual(compose.call_count, 2)
        validate.assert_called_once_with(
            str(output_path),
            expected_width=1080,
            expected_height=1920,
            expected_fps=30.0,
            source_has_audio=True,
        )

    def test_streamer_render_composes_real_facecam_and_gameplay_panels(self):
        analysis = SourceAnalysis(
            source_fingerprint={"size": 1},
            source_fps=30.0,
            total_frames=60,
            width=1920,
            height=1080,
            scene_boundaries=[(0, 60)],
            scene_strategies=["TRACK"],
        )

        with tempfile.TemporaryDirectory() as directory:
            source_path = Path(directory) / "source.mp4"
            output_path = Path(directory) / "streamer.mp4"
            subprocess.run(
                [
                    "ffmpeg", "-y",
                    "-f", "lavfi", "-i", "color=c=black:s=1920x540:r=30:d=2",
                    "-f", "lavfi", "-i", "color=c=white:s=1920x540:r=30:d=2",
                    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2",
                    "-filter_complex", "[0:v][1:v]vstack=inputs=2[v]",
                    "-map", "[v]", "-map", "2:a:0",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-shortest", str(source_path),
                ],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )
            media = replace(
                source_media(),
                path=str(source_path),
                duration_seconds=2.0,
                frame_count=60,
                audio=AudioProbe("aac", 48000, 2, "stereo", 2.0),
            )

            with patch.object(
                main,
                "detect_face_candidates",
                return_value=[{"box": [900, 100, 200, 300], "score": 60000}],
            ), patch.object(main, "detect_person_yolo", return_value=None):
                result = main.process_video_to_vertical(
                    str(source_path),
                    str(output_path),
                    source_analysis=analysis,
                    source_media=media,
                    layout_format="streamer_stack",
                    facecam_size="medium",
                )

            self.assertTrue(result)
            capture = main.cv2.VideoCapture(str(output_path))
            try:
                self.assertEqual(int(capture.get(main.cv2.CAP_PROP_FRAME_WIDTH)), 1080)
                self.assertEqual(int(capture.get(main.cv2.CAP_PROP_FRAME_HEIGHT)), 1920)
                self.assertAlmostEqual(capture.get(main.cv2.CAP_PROP_FPS), 30.0, places=1)
                ret, frame = capture.read()
            finally:
                capture.release()

            self.assertTrue(ret)
            facecam_height, _ = streamer_panel_heights(1080, 1920, "medium")
            facecam = frame[:facecam_height]
            gameplay = frame[facecam_height:]
            facecam_luma = float(facecam.mean())
            gameplay_luma = float(gameplay.mean())
            self.assertLess(facecam_luma, 100)
            self.assertGreater(gameplay_luma, facecam_luma + 30)

            probe = main.probe_media(str(output_path))
            self.assertIsNotNone(probe.audio)


if __name__ == "__main__":
    unittest.main()
