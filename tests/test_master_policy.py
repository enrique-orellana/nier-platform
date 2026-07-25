import unittest

from master_policy import choose_master_spec
from media_probe import MediaProbe


def video(width, height, fps, transfer="bt709"):
    return MediaProbe(
        path="fixture.mp4", width=width, height=height,
        display_width=width, display_height=height,
        duration_seconds=10.0, fps=fps, fps_fraction=f"{fps}/1",
        codec="h264", profile="High", pixel_format="yuv420p",
        color_range="tv", color_space="bt709", color_transfer=transfer,
        color_primaries="bt709", rotation=0, size_bytes=1, audio=None,
    )


class MasterPolicyTests(unittest.TestCase):
    def test_landscape_crop_is_not_upscaled(self):
        spec = choose_master_spec(video(1920, 1080, 30), strategy="crop")
        self.assertEqual((spec.width, spec.height), (608, 1080))

    def test_native_portrait_4k_is_preserved(self):
        spec = choose_master_spec(video(2160, 3840, 60), strategy="crop")
        self.assertEqual((spec.width, spec.height), (2160, 3840))
        self.assertEqual(spec.fps, 60)

    def test_fps_is_preserved_and_capped(self):
        self.assertEqual(choose_master_spec(video(1080, 1920, 25), "crop").fps, 25)
        self.assertEqual(choose_master_spec(video(1080, 1920, 120), "crop").fps, 60)

    def test_hdr_requests_tone_mapping(self):
        spec = choose_master_spec(video(2160, 3840, 30, "smpte2084"), "crop")
        self.assertTrue(spec.tone_map_to_sdr)

    def test_encoder_contract_is_fixed(self):
        spec = choose_master_spec(video(1080, 1920, 30), "crop")
        self.assertEqual(spec.codec, "h264")
        self.assertEqual(spec.crf, 14)
        self.assertEqual(spec.preset, "veryslow")
        self.assertEqual(spec.pixel_format, "yuv420p")
        self.assertEqual(spec.audio_bitrate, "320k")


if __name__ == "__main__":
    unittest.main()
