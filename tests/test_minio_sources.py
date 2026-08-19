from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import pytest

import minio_sources
from minio_sources import download_source_object, list_source_objects, validate_source_object


class FakeS3:
    def list_objects_v2(self, **kwargs):
        assert kwargs["Bucket"] == "youtube-downloads"
        assert kwargs["MaxKeys"] == 2
        return {
            "Contents": [
                {
                    "Key": "videos/a.mp4",
                    "Size": 12,
                    "LastModified": datetime(2026, 8, 13, tzinfo=timezone.utc),
                },
                {
                    "Key": "videos/b.bin",
                    "Size": 34,
                    "LastModified": datetime(2026, 8, 12, tzinfo=timezone.utc),
                },
            ],
            "IsTruncated": False,
        }


class FakeBody:
    def __init__(self, chunks):
        self.chunks = iter(chunks)

    def read(self, _size):
        return next(self.chunks, b"")

    def close(self):
        return None


class DownloadS3:
    def __init__(self, response):
        self.response = response
        self.downloads = []

    def head_object(self, **kwargs):
        assert kwargs == {"Bucket": "youtube-downloads", "Key": "videos/source.bin"}
        return {"ContentLength": self.response["ContentLength"]}

    def download_file(self, bucket, key, destination, *, Callback=None, Config=None):
        self.downloads.append((bucket, key, destination, Callback, Config))
        body = self.response["Body"]
        with open(destination, "wb") as handle:
            while True:
                chunk = body.read(1024 * 1024)
                if not chunk:
                    break
                handle.write(chunk)
                if Callback:
                    Callback(len(chunk))


def test_list_source_objects_returns_safe_object_metadata():
    with patch("minio_sources.get_s3_client", return_value=FakeS3()):
        result = list_source_objects(search="a.mp4", limit=2)

    assert result["bucket"] == "youtube-downloads"
    assert result["objects"] == [{
        "key": "videos/a.mp4",
        "name": "a.mp4",
        "size": 12,
        "last_modified": "2026-08-13T00:00:00+00:00",
    }]
    assert "url" not in result["objects"][0]
    assert "presigned_url" not in result["objects"][0]


def test_validate_source_object_rejects_arbitrary_bucket():
    with pytest.raises(ValueError, match="source bucket"):
        validate_source_object({"bucket": "other", "key": "video.mp4"})


def test_validate_source_object_rejects_empty_or_traversal_key():
    with pytest.raises(ValueError):
        validate_source_object({"bucket": "youtube-downloads", "key": ""})
    with pytest.raises(ValueError):
        validate_source_object({"bucket": "youtube-downloads", "key": "../secret.mp4"})


def test_download_source_object_streams_and_atomically_renames(tmp_path):
    destination = tmp_path / "source.bin"
    client = DownloadS3({"ContentLength": 5, "Body": FakeBody([b"he", b"llo"])})

    with patch("minio_sources.get_s3_client", return_value=client):
        download_source_object("youtube-downloads", "videos/source.bin", str(destination), 10)

    assert destination.read_bytes() == b"hello"
    assert not Path(f"{destination}.part").exists()


def test_download_source_object_removes_partial_file_when_limit_is_exceeded(tmp_path):
    destination = tmp_path / "source.bin"
    client = DownloadS3({"ContentLength": 5, "Body": FakeBody([b"hello"])})

    with patch("minio_sources.get_s3_client", return_value=client):
        with pytest.raises(ValueError, match="file size limit"):
            download_source_object("youtube-downloads", "videos/source.bin", str(destination), 4)

    assert not destination.exists()
    assert not Path(f"{destination}.part").exists()


def test_download_source_object_forwards_multipart_transfer_config(tmp_path):
    destination = tmp_path / "source.bin"
    client = DownloadS3({"ContentLength": 5, "Body": FakeBody([b"hello"])})
    transfer_config = object()

    with patch("minio_sources.get_s3_client", return_value=client):
        with patch.object(minio_sources, "get_s3_download_config", return_value=transfer_config):
            download_source_object("youtube-downloads", "videos/source.bin", str(destination), 10)

    assert client.downloads[0][4] is transfer_config
