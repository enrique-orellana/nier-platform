import unittest

from clip_timeline import build_audio_trim_filter, resolve_clip_frame_range


class ClipTimelineTests(unittest.TestCase):
    def test_fractional_clip_uses_one_effective_clock_for_video_and_audio(self):
        trim = resolve_clip_frame_range(125.61, 157.61, source_fps=25.0, total_frames=10000)

        self.assertEqual((trim.start_frame, trim.end_frame), (3140, 3940))
        self.assertEqual(trim.start_sec, 125.6)
        self.assertEqual(trim.end_sec, 157.6)
        self.assertEqual(trim.duration_sec, 32.0)
        self.assertEqual(
            build_audio_trim_filter(trim),
            "atrim=start=125.600000:end=157.600000,asetpts=PTS-STARTPTS",
        )

    def test_range_is_clamped_to_available_frames(self):
        trim = resolve_clip_frame_range(-2.0, 12.0, source_fps=30.0, total_frames=300)

        self.assertEqual((trim.start_frame, trim.end_frame), (0, 300))
        self.assertEqual((trim.start_sec, trim.end_sec), (0.0, 10.0))

    def test_empty_or_invalid_ranges_are_rejected(self):
        with self.assertRaises(ValueError):
            resolve_clip_frame_range(5.0, 5.0, source_fps=30.0, total_frames=300)
        with self.assertRaises(ValueError):
            resolve_clip_frame_range(0.0, 2.0, source_fps=0.0, total_frames=300)


if __name__ == "__main__":
    unittest.main()
