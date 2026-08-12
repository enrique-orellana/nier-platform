import unittest

from video_decode import build_decode_compatibility_command, requires_decode_compatibility


class VideoDecodeTests(unittest.TestCase):
    def test_av1_requires_a_decode_compatible_working_source(self):
        self.assertTrue(requires_decode_compatibility("av1"))
        self.assertTrue(requires_decode_compatibility("av01"))
        self.assertFalse(requires_decode_compatibility("h264"))

    def test_compatibility_command_transcodes_video_and_audio_to_working_codecs(self):
        command = build_decode_compatibility_command("input.av1.mp4", "working.mp4")

        self.assertEqual(command[:4], ["ffmpeg", "-y", "-i", "input.av1.mp4"])
        self.assertIn("-map", command)
        self.assertIn("0:v:0", command)
        self.assertIn("0:a:0?", command)
        self.assertEqual(command[command.index("-c:v") + 1], "libx264")
        self.assertEqual(command[command.index("-c:a") + 1], "aac")
        self.assertEqual(command[-1], "working.mp4")


if __name__ == "__main__":
    unittest.main()
