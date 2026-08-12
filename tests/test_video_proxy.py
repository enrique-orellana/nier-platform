import unittest

from app import _build_inline_content_disposition


class VideoProxyTests(unittest.TestCase):
    def test_unicode_filename_uses_utf8_content_disposition(self):
        header = _build_inline_content_disposition(
            "job_ESTE JUEGO ME INCOMODÓ MUCHÍSIMO 📸_clip_3.mp4"
        )

        header.encode("latin-1")
        self.assertIn('filename="job_ESTE JUEGO ME INCOMOD MUCHSIMO _clip_3.mp4"', header)
        self.assertIn("filename*=UTF-8''", header)


if __name__ == "__main__":
    unittest.main()
