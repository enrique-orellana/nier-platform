import unittest

from master_policy import choose_master_spec, load_master_policy, master_audio_encode_args, master_video_encode_args
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
    def test_landscape_crop_uses_canonical_social_canvas(self):
        spec = choose_master_spec(video(1920, 1080, 30), strategy="crop")
        self.assertEqual((spec.width, spec.height), (1080, 1920))

    def test_native_portrait_4k_is_preserved(self):
        spec = choose_master_spec(video(2160, 3840, 60), strategy="crop")
        self.assertEqual((spec.width, spec.height), (1080, 1920))
        self.assertEqual(spec.fps, 60)

    def test_fps_is_preserved_and_capped(self):
        self.assertEqual(choose_master_spec(video(1080, 1920, 25), "crop").fps, 25)
        self.assertEqual(choose_master_spec(video(1080, 1920, 120), "crop").fps, 60)

    def test_hdr_requests_tone_mapping(self):
        spec = choose_master_spec(video(2160, 3840, 30, "smpte2084"), "crop")
        self.assertTrue(spec.tone_map_to_sdr)

    def test_encoder_contract_is_fixed(self):
        policy = load_master_policy()
        spec = choose_master_spec(video(1080, 1920, 30), "crop")
        self.assertEqual(spec.codec, policy["codec"])
        self.assertEqual(spec.crf, policy["crf"])
        self.assertEqual(spec.preset, policy["preset"])
        self.assertEqual(spec.pixel_format, policy["pixel_format"])
        self.assertEqual(spec.audio_bitrate, policy["audio_bitrate"])

    def test_ffmpeg_contract_is_centralized(self):
        policy = load_master_policy()
        args = master_video_encode_args()
        self.assertEqual(args[args.index("-crf") + 1], str(policy["crf"]))
        self.assertEqual(args[args.index("-preset") + 1], policy["preset"])
        self.assertEqual(args[args.index("-b:a") + 1], policy["audio_bitrate"])
        self.assertEqual(args[args.index("-ac") + 1], str(policy["audio_channels"]))
        self.assertEqual(args[args.index("-colorspace") + 1], policy["color_space"])

    def test_ffmpeg_contract_can_fix_gop_to_two_seconds(self):
        args = master_video_encode_args(fps=30)
        self.assertEqual(args[args.index("-g") + 1], "60")

    def test_standalone_audio_contract_is_centralized(self):
        policy = load_master_policy()
        args = master_audio_encode_args()
        self.assertEqual(args[args.index("-c:a") + 1], policy["audio_codec"])
        self.assertEqual(args[args.index("-ar") + 1], str(policy["audio_sample_rate"]))
        self.assertEqual(args[args.index("-b:a") + 1], policy["audio_bitrate"])


if __name__ == "__main__":
    unittest.main()
