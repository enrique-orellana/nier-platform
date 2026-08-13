import unittest

from media_probe import parse_probe_payload


class MediaProbeTests(unittest.TestCase):
    def test_parses_rotation_rational_fps_color_and_audio(self):
        payload = {
            "streams": [
                {
                    "index": 0,
                    "codec_type": "video",
                    "codec_name": "h264",
                    "profile": "High",
                    "width": 3840,
                    "height": 2160,
                    "sample_aspect_ratio": "1:1",
                    "display_aspect_ratio": "9:16",
                    "time_base": "1/90000",
                    "bit_rate": "5000000",
                    "r_frame_rate": "60000/1001",
                    "avg_frame_rate": "60000/1001",
                    "pix_fmt": "yuv420p",
                    "color_range": "tv",
                    "color_space": "bt709",
                    "color_transfer": "bt709",
                    "color_primaries": "bt709",
                    "tags": {"rotate": "90"},
                },
                {
                    "index": 1,
                    "codec_type": "audio",
                    "codec_name": "aac",
                    "sample_rate": "48000",
                    "channels": 2,
                    "channel_layout": "stereo",
                    "bit_rate": "192000",
                },
            ],
            "format": {"duration": "12.512", "size": "1234567"},
        }
        media = parse_probe_payload(payload)
        self.assertEqual((media.display_width, media.display_height), (2160, 3840))
        self.assertAlmostEqual(media.fps, 59.94005994)
        self.assertEqual(media.color_transfer, "bt709")
        self.assertEqual(media.audio.sample_rate, 48000)
        self.assertEqual(media.audio.bitrate, 192000)
        self.assertEqual(media.sample_aspect_ratio, "1:1")
        self.assertEqual(media.display_aspect_ratio, "9:16")
        self.assertEqual(media.time_base, "1/90000")
        self.assertEqual(media.duration_seconds, 12.512)

    def test_rejects_payload_without_video(self):
        with self.assertRaisesRegex(ValueError, "video stream"):
            parse_probe_payload({"streams": [], "format": {}})

    def test_uses_average_rate_when_nominal_rate_is_invalid(self):
        media = parse_probe_payload({
            "streams": [{
                "codec_type": "video", "width": 1080, "height": 1920,
                "r_frame_rate": "0/0", "avg_frame_rate": "25/1",
            }],
            "format": {"duration": "1"},
        })
        self.assertEqual(media.fps, 25.0)


if __name__ == "__main__":
    unittest.main()
