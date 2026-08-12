import json

import pytest

import s3_uploader


class MissingObjectS3Client:
    def get_object(self, *, Bucket, Key):
        raise s3_uploader.ClientError(
            {"Error": {"Code": "NoSuchKey", "Message": "missing"}},
            "GetObject",
        )


class RecordingS3Client:
    def __init__(self, body=None):
        self.body = body
        self.put_calls = []

    def get_object(self, *, Bucket, Key):
        return {"Body": Body(self.body or b'{}')}

    def put_object(self, **kwargs):
        self.put_calls.append(kwargs)


class Body:
    def __init__(self, content):
        self.content = content

    def read(self):
        return self.content


def test_read_clip_statuses_returns_empty_document_when_sidecar_is_missing(monkeypatch):
    fake = MissingObjectS3Client()
    monkeypatch.setattr(s3_uploader, "get_s3_client", lambda: fake)

    assert s3_uploader.load_clip_statuses("job-1") == {
        "version": 1,
        "clips": {},
    }


def test_write_clip_statuses_uses_project_sidecar_and_json_content_type(monkeypatch):
    fake = RecordingS3Client()
    monkeypatch.setattr(s3_uploader, "get_s3_client", lambda: fake)

    s3_uploader.save_clip_statuses("job-1", {"0": {"status": "edited"}})

    assert fake.put_calls[0]["Key"] == "job-1/clip_statuses.json"
    assert fake.put_calls[0]["ContentType"] == "application/json"
    assert json.loads(fake.put_calls[0]["Body"]) == {
        "version": 1,
        "clips": {"0": {"status": "edited"}},
    }


def test_read_clip_statuses_rejects_malformed_sidecar(monkeypatch):
    fake = RecordingS3Client(body=b'{"clips": []}')
    monkeypatch.setattr(s3_uploader, "get_s3_client", lambda: fake)

    with pytest.raises(ValueError, match="clip status"):
        s3_uploader.load_clip_statuses("job-1")
