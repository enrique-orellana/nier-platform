import unittest

import app


class ImproveClipQualityCommandTests(unittest.TestCase):
    def test_quality_reencode_uses_higher_fidelity_settings(self):
        command = app._build_quality_ffmpeg_command("input.mp4", "output.mp4")

        self.assertEqual(command[:4], ["ffmpeg", "-y", "-i", "input.mp4"])
        self.assertIn("-vf", command)
        self.assertIn("-profile:v", command)

        filter_chain = command[command.index("-vf") + 1]
        self.assertIn("scale=iw:ih:flags=lanczos", filter_chain)
        self.assertIn("unsharp=5:5:0.8:3:3:0.4", filter_chain)

        self.assertEqual(command[command.index("-preset") + 1], "slower")
        self.assertEqual(command[command.index("-crf") + 1], "16")
        self.assertEqual(command[command.index("-profile:v") + 1], "high")
        self.assertEqual(command[-1], "output.mp4")
