import unittest
from unittest.mock import patch

import s3_uploader


class S3ClipUrlTests(unittest.TestCase):
    def test_history_clip_url_is_refreshed_from_its_object_key(self):
        stored_url = (
            "http://minio.example/media/job-1/clip-1.mp4?"
            "X-Amz-Date=20260725T235351Z&X-Amz-Expires=7200"
        )
        clip = {"video_url": stored_url}

        with patch.object(s3_uploader, "generate_presigned_url", return_value="fresh-url") as presign:
            result = s3_uploader.resolve_clip_video_url(
                bucket_name="openshorts-media",
                job_id="job-1",
                base_name="source",
                clip=clip,
                clip_index=0,
            )

        self.assertEqual(result, "fresh-url")
        presign.assert_called_once_with("openshorts-media", "job-1/clip-1.mp4", expiration=7200)


if __name__ == "__main__":
    unittest.main()
