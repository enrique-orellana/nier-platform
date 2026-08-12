import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import app
from media_probe import AudioProbe, MediaProbe


def valid_media():
    return MediaProbe(
        path="clip.mp4",
        width=608,
        height=1080,
        display_width=608,
        display_height=1080,
        duration_seconds=2.0,
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
        audio=AudioProbe("aac", 48000, 2, "stereo", 2.0),
        frame_count=60,
    )


class VideoArtifactReadinessTests(unittest.TestCase):
    def test_policy_metadata_requires_full_output_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "clip.mp4"
            path.write_bytes(b"video")
            clip = {
                "output_width": 608,
                "output_height": 1080,
                "output_fps": 30.0,
                "source_has_audio": True,
            }

            with patch.object(app, "validate_clip_output", return_value=valid_media()) as validate:
                self.assertTrue(app._clip_artifact_is_valid(str(path), clip))

        validate.assert_called_once()

    def test_policy_metadata_rejects_invalid_media(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "clip.mp4"
            path.write_bytes(b"broken")
            clip = {
                "output_width": 608,
                "output_height": 1080,
                "output_fps": 30.0,
            }

            with patch.object(
                app,
                "validate_clip_output",
                side_effect=ValueError("invalid dimensions"),
            ):
                self.assertFalse(app._clip_artifact_is_valid(str(path), clip))

    def test_legacy_metadata_still_requires_decodable_h264_media(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "clip.mp4"
            path.write_bytes(b"legacy")

            with patch.object(app, "probe_media", return_value=valid_media()):
                self.assertTrue(app._clip_artifact_is_valid(str(path), {}))


if __name__ == "__main__":
    unittest.main()
