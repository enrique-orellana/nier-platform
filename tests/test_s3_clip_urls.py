import unittest
import tempfile
from pathlib import Path
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
            with patch.object(s3_uploader, "get_s3_client", return_value=None):
                result = s3_uploader.resolve_clip_video_url(
                    bucket_name="openshorts-media",
                    job_id="job-1",
                    base_name="source",
                    clip=clip,
                    clip_index=0,
                )

        self.assertEqual(result, "fresh-url")
        presign.assert_called_once_with("openshorts-media", "job-1/clip-1.mp4", expiration=7200)

    def test_history_clip_url_falls_back_to_uploaded_temp_video(self):
        class FakeS3Client:
            def head_object(self, *, Bucket, Key):
                if Key.endswith("_temp_video.mp4"):
                    return {}
                raise s3_uploader.ClientError(
                    {"Error": {"Code": "404", "Message": "missing"}},
                    "HeadObject",
                )

        clip = {
            "video_url": "http://minio.example/media/job-1/source_clip_1.mp4?signature=old",
        }

        with patch.object(s3_uploader, "get_s3_client", return_value=FakeS3Client()):
            with patch.object(
                s3_uploader,
                "generate_presigned_url",
                side_effect=lambda bucket, key, expiration: f"signed:{key}",
            ):
                result = s3_uploader.resolve_clip_video_url(
                    bucket_name="openshorts-media",
                    job_id="job-1",
                    base_name="source",
                    clip=clip,
                    clip_index=0,
                )

        self.assertEqual(result, "signed:job-1/source_clip_1_temp_video.mp4")

    def test_upload_job_artifacts_does_not_publish_temporary_video(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, "clip.mp4").write_bytes(b"final")
            Path(directory, "clip_temp_video.mp4").write_bytes(b"temporary")
            Path(directory, "metadata.json").write_text("{}", encoding="utf-8")

            with patch.object(s3_uploader, "upload_file_to_s3") as upload:
                s3_uploader.upload_job_artifacts(directory, "job-1")

        uploaded_names = [call.args[2] for call in upload.call_args_list]
        self.assertIn("job-1/clip.mp4", uploaded_names)
        self.assertIn("job-1/metadata.json", uploaded_names)
        self.assertNotIn("job-1/clip_temp_video.mp4", uploaded_names)


if __name__ == "__main__":
    unittest.main()
