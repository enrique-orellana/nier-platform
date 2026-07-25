import unittest

from crop_track import CropKeyframe, CropRect, CropScene, CropTrack


class CropTrackTests(unittest.TestCase):
    def test_interpolates_within_scene(self):
        track = CropTrack((CropScene(
            0, 2, "TRACK", (
                CropKeyframe(0, CropRect(0, 0, 0.5, 1)),
                CropKeyframe(2, CropRect(0.5, 0, 0.5, 1)),
            ),
        ),))
        rect = track.rectangle_at(1)
        self.assertAlmostEqual(rect.x, 0.25)
        self.assertAlmostEqual(rect.width, 0.5)

    def test_scene_boundary_is_a_hard_cut(self):
        track = CropTrack((
            CropScene(0, 1, "TRACK", (CropKeyframe(0, CropRect(0, 0, 0.5, 1)),)),
            CropScene(1, 2, "TRACK", (CropKeyframe(1, CropRect(0.5, 0, 0.5, 1)),)),
        ))
        self.assertEqual(track.rectangle_at(1).x, 0.5)

    def test_round_trip_serialization(self):
        track = CropTrack((CropScene(0, 1, "GENERAL", (CropKeyframe(0, CropRect(0, 0, 0.5, 1)),)),))
        self.assertEqual(CropTrack.from_dict(track.to_dict()), track)

    def test_rejects_out_of_bounds_rectangles(self):
        with self.assertRaises(ValueError):
            CropRect(0.75, 0, 0.5, 1)


if __name__ == "__main__":
    unittest.main()
