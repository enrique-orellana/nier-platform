import unittest
from unittest.mock import patch

from media_probe import AudioProbe, MediaProbe
from video_output_validation import validate_clip_output


def probed_media(
    *,
    codec="h264",
    width=608,
    height=1080,
    fps=30.0,
    duration=40.0,
    size_bytes=1_000_000,
    frame_count=1200,
    audio=True,
):
    return MediaProbe(
        path="clip.mp4",
        width=width,
        height=height,
        display_width=width,
        display_height=height,
        duration_seconds=duration,
        fps=fps,
        fps_fraction="30/1",
        codec=codec,
        profile="High",
        pixel_format="yuv420p",
        color_range="tv",
        color_space="bt709",
        color_transfer="bt709",
        color_primaries="bt709",
        rotation=0,
        size_bytes=size_bytes,
        audio=AudioProbe("aac", 48000, 2, "stereo", duration, 192000)
        if audio
        else None,
        frame_count=frame_count,
        sample_aspect_ratio="1:1",
        display_aspect_ratio="9:16",
        time_base="1/90000",
        bit_rate=5_000_000,
    )


class VideoOutputValidationTests(unittest.TestCase):
    def test_validate_clip_output_accepts_matching_h264_output(self):
        media = probed_media(fps=30.0002)

        with patch("video_output_validation.probe_media", return_value=media):
            result = validate_clip_output(
                "clip.mp4",
                expected_width=608,
                expected_height=1080,
                expected_fps=30.0,
                source_has_audio=True,
            )

        self.assertIs(result, media)

    def test_validate_clip_output_rejects_missing_video_stream(self):
        with patch(
            "video_output_validation.probe_media",
            side_effect=ValueError("ffprobe payload does not contain a video stream"),
        ):
            with self.assertRaisesRegex(ValueError, "video stream"):
                validate_clip_output(
                    "clip.mp4",
                    expected_width=608,
                    expected_height=1080,
                    expected_fps=30.0,
                    source_has_audio=False,
                )

    def test_validate_clip_output_rejects_zero_duration_or_frames(self):
        for field, value, expected_message in (
            ("duration", 0.0, "duration"),
            ("frame_count", 0, "frame count"),
        ):
            with self.subTest(field=field):
                media = probed_media(**{field: value})
                with patch("video_output_validation.probe_media", return_value=media):
                    with self.assertRaisesRegex(ValueError, expected_message):
                        validate_clip_output(
                            "clip.mp4",
                            expected_width=608,
                            expected_height=1080,
                            expected_fps=30.0,
                            source_has_audio=False,
                        )

    def test_validate_clip_output_rejects_wrong_dimensions(self):
        media = probed_media(width=720)

        with patch("video_output_validation.probe_media", return_value=media):
            with self.assertRaisesRegex(ValueError, "dimensions"):
                validate_clip_output(
                    "clip.mp4",
                    expected_width=608,
                    expected_height=1080,
                    expected_fps=30.0,
                    source_has_audio=False,
                )

    def test_validate_clip_output_requires_audio_when_source_has_audio(self):
        media = probed_media(audio=False)

        with patch("video_output_validation.probe_media", return_value=media):
            with self.assertRaisesRegex(ValueError, "audio"):
                validate_clip_output(
                    "clip.mp4",
                    expected_width=608,
                    expected_height=1080,
                    expected_fps=30.0,
                    source_has_audio=True,
                )


if __name__ == "__main__":
    unittest.main()
