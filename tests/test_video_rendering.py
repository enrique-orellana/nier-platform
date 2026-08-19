import unittest

import cv2

from clip_timeline import ClipFrameRange, build_audio_seek_filter
from main import should_run_person_detection
from video_rendering import build_audio_extract_command, seek_capture_to_frame


class FakeCapture:
    def __init__(self, *, initial_position=0, seek_succeeds=True, read_succeeds=True):
        self.position = initial_position
        self.seek_succeeds = seek_succeeds
        self.read_succeeds = read_succeeds

    def set(self, property_id, value):
        self.set_property = property_id
        self.requested_position = value
        if self.seek_succeeds:
            self.position = int(value) - 5
        return self.seek_succeeds

    def get(self, property_id):
        self.get_property = property_id
        return self.position

    def read(self):
        if not self.read_succeeds:
            return False, None
        self.position += 1
        return True, object()


class VideoRenderingTests(unittest.TestCase):
    def test_audio_command_uses_fast_input_seek_and_exact_duration(self):
        trim = ClipFrameRange(
            start_frame=600,
            end_frame=1800,
            start_sec=20.0,
            end_sec=60.0,
        )

        command = build_audio_extract_command("source.mp4", "audio.m4a", trim)

        self.assertEqual(command[:5], ["ffmpeg", "-y", "-ss", "20.000000", "-i"])
        self.assertEqual(command[command.index("-t") + 1], "40.000000")
        self.assertEqual(command[-1], "audio.m4a")
        self.assertEqual(
            command[command.index("-af") + 1],
            build_audio_seek_filter(trim),
        )

    def test_seek_discards_only_decoder_preroll_and_positions_on_target(self):
        capture = FakeCapture()

        first_frame, discarded = seek_capture_to_frame(capture, 120)

        self.assertEqual(first_frame, 120)
        self.assertEqual(discarded, 5)
        self.assertEqual(capture.position, 120)
        self.assertEqual(capture.set_property, cv2.CAP_PROP_POS_FRAMES)

    def test_seek_rejects_capture_that_cannot_seek(self):
        capture = FakeCapture(seek_succeeds=False)

        with self.assertRaisesRegex(RuntimeError, "could not seek"):
            seek_capture_to_frame(capture, 120)

    def test_seek_rejects_capture_that_cannot_decode_preroll(self):
        capture = FakeCapture(read_succeeds=False)

        with self.assertRaisesRegex(RuntimeError, "could not decode"):
            seek_capture_to_frame(capture, 120)

    def test_person_detection_runs_at_scene_start(self):
        self.assertTrue(should_run_person_detection(900, 900, -1, 60.0, 1.5))

    def test_person_detection_waits_for_interval(self):
        self.assertFalse(should_run_person_detection(930, 900, 900, 60.0, 1.5))
        self.assertTrue(should_run_person_detection(991, 900, 900, 60.0, 1.5))


if __name__ == "__main__":
    unittest.main()
