import unittest
import tempfile
import os
from pathlib import Path
from unittest.mock import patch

import s3_uploader


class S3ClipUrlTests(unittest.TestCase):
    def test_download_transfer_config_is_environment_configurable(self):
        with patch.dict(
            os.environ,
            {
                "MINIO_DOWNLOAD_MAX_CONCURRENCY": "24",
                "MINIO_DOWNLOAD_MULTIPART_THRESHOLD_MB": "32",
                "MINIO_DOWNLOAD_MULTIPART_CHUNKSIZE_MB": "64",
            },
            clear=False,
        ):
            config = s3_uploader.get_s3_download_config()

        self.assertEqual(config.max_concurrency, 24)
        self.assertEqual(config.multipart_threshold, 32 * 1024 * 1024)
        self.assertEqual(config.multipart_chunksize, 64 * 1024 * 1024)

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
                upload.return_value = True
                assert s3_uploader.upload_job_artifacts(directory, "job-1") is True

        uploaded_names = [call.args[2] for call in upload.call_args_list]
        self.assertIn("job-1/clip.mp4", uploaded_names)
        self.assertIn("job-1/metadata.json", uploaded_names)
        self.assertNotIn("job-1/clip_temp_video.mp4", uploaded_names)

    def test_upload_job_artifacts_skips_clip_that_fails_output_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, "clip.mp4").write_bytes(b"broken")
            Path(directory, "source_metadata.json").write_text(
                '{"shorts": [{"video_filename": "clip.mp4", '
                '"output_width": 608, "output_height": 1080, '
                '"output_fps": 30, "source_has_audio": true}]}',
                encoding="utf-8",
            )

            with patch.object(
                s3_uploader,
                "validate_clip_output",
                side_effect=ValueError("invalid clip"),
            ):
                with patch.object(s3_uploader, "upload_file_to_s3") as upload:
                    s3_uploader.upload_job_artifacts(directory, "job-1")

        uploaded_names = [call.args[2] for call in upload.call_args_list]
        self.assertNotIn("job-1/clip.mp4", uploaded_names)

    def test_upload_job_artifacts_reports_failed_upload(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, "clip.mp4").write_bytes(b"final")

            with patch.object(s3_uploader, "upload_file_to_s3", return_value=False):
                self.assertFalse(s3_uploader.upload_job_artifacts(directory, "job-1"))

    def test_upload_job_artifacts_includes_nested_manifests(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest = Path(directory, "manifests", "clip_0.json")
            manifest.parent.mkdir()
            manifest.write_text("{}", encoding="utf-8")

            with patch.object(s3_uploader, "upload_file_to_s3", return_value=True) as upload:
                self.assertTrue(s3_uploader.upload_job_artifacts(directory, "job-1"))

            self.assertIn("job-1/manifests/clip_0.json", [call.args[2] for call in upload.call_args_list])

    def test_hydrate_job_artifacts_downloads_only_job_files(self):
        class FakePaginator:
            def paginate(self, **kwargs):
                assert kwargs == {"Bucket": "openshorts-media", "Prefix": "job-1/"}
                return [{"Contents": [
                    {"Key": "job-1/source.mp4"},
                    {"Key": "job-1/source_metadata.json"},
                    {"Key": "job-1/manifests/clip_0.json"},
                    {"Key": "other-job/secret.mp4"},
                ]}]

        class FakeS3Client:
            def get_paginator(self, name):
                assert name == "list_objects_v2"
                return FakePaginator()

            def download_file(self, bucket, key, destination, **kwargs):
                assert bucket == "openshorts-media"
                Path(destination).write_bytes(key.encode("utf-8"))

        with tempfile.TemporaryDirectory() as directory:
            with patch.object(s3_uploader, "get_s3_client", return_value=FakeS3Client()):
                hydrated = s3_uploader.hydrate_job_artifacts(directory, "job-1")

            self.assertEqual(hydrated, 3)
            self.assertEqual(Path(directory, "source.mp4").read_bytes(), b"job-1/source.mp4")
            self.assertEqual(Path(directory, "source_metadata.json").read_bytes(), b"job-1/source_metadata.json")
            self.assertEqual(Path(directory, "manifests", "clip_0.json").read_bytes(), b"job-1/manifests/clip_0.json")

    def test_hydrate_job_artifacts_forwards_multipart_transfer_config(self):
        class FakePaginator:
            def paginate(self, **kwargs):
                return [{"Contents": [{"Key": "job-1/clip.mp4"}]}]

        class FakeS3Client:
            def __init__(self):
                self.config = None

            def get_paginator(self, name):
                assert name == "list_objects_v2"
                return FakePaginator()

            def download_file(self, bucket, key, destination, **kwargs):
                self.config = kwargs["Config"]
                Path(destination).write_bytes(b"clip")

        client = FakeS3Client()
        transfer_config = object()
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(s3_uploader, "get_s3_client", return_value=client):
                with patch.object(s3_uploader, "get_s3_download_config", return_value=transfer_config):
                    self.assertEqual(s3_uploader.hydrate_job_artifacts(directory, "job-1"), 1)

        self.assertIs(client.config, transfer_config)

    def test_hydrate_job_artifacts_reuses_existing_non_empty_files(self):
        class FakePaginator:
            def paginate(self, **kwargs):
                assert kwargs == {"Bucket": "openshorts-media", "Prefix": "job-1/"}
                return [{"Contents": [
                    {"Key": "job-1/source.mp4"},
                    {"Key": "job-1/source_metadata.json"},
                ]}]

        class FakeS3Client:
            def __init__(self):
                self.downloads = []

            def get_paginator(self, name):
                assert name == "list_objects_v2"
                return FakePaginator()

            def download_file(self, bucket, key, destination, **kwargs):
                self.downloads.append((bucket, key, destination))
                Path(destination).write_bytes(key.encode("utf-8"))

        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory, "source.mp4")
            source.write_bytes(b"existing-source")
            client = FakeS3Client()
            with patch.object(s3_uploader, "get_s3_client", return_value=client):
                hydrated = s3_uploader.hydrate_job_artifacts(directory, "job-1")

            self.assertEqual(hydrated, 1)
            self.assertEqual(source.read_bytes(), b"existing-source")
            self.assertEqual(client.downloads[0][1], "job-1/source_metadata.json")

    def test_upload_job_artifacts_can_exclude_worker_source(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, "source.mp4").write_bytes(b"source")
            Path(directory, "source_metadata.json").write_text("{}", encoding="utf-8")

            with patch.object(s3_uploader, "upload_file_to_s3", return_value=True) as upload:
                self.assertTrue(
                    s3_uploader.upload_job_artifacts(
                        directory,
                        "job-1",
                        excluded_paths={"source.mp4"},
                    )
                )

            uploaded = [call.args[2] for call in upload.call_args_list]
            self.assertNotIn("job-1/source.mp4", uploaded)
            self.assertIn("job-1/source_metadata.json", uploaded)


if __name__ == "__main__":
    unittest.main()
