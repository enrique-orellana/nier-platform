import unittest
from types import SimpleNamespace
from unittest.mock import patch

import main


class VideoDecodeTests(unittest.TestCase):
    def test_av1_prepare_keeps_original_source_without_transcoding(self):
        with patch.object(main, "probe_media", return_value=SimpleNamespace(codec="av1")), patch.object(
            main.subprocess, "run"
        ) as run, patch.object(main.httpx, "post") as post:
            result = main.prepare_opencv_video("input.av1.mp4")

        self.assertEqual(result, "input.av1.mp4")
        run.assert_not_called()
        post.assert_not_called()

if __name__ == "__main__":
    unittest.main()
