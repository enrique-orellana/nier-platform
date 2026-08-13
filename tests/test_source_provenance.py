import pytest

from main import parse_source_object_argument


def test_parse_source_object_argument_normalizes_allowlisted_reference():
    assert parse_source_object_argument(
        '{"bucket":"youtube-downloads","key":"/videos/source.bin"}'
    ) == {
        "bucket": "youtube-downloads",
        "key": "videos/source.bin",
    }


def test_parse_source_object_argument_rejects_invalid_json_or_bucket():
    with pytest.raises(ValueError, match="JSON"):
        parse_source_object_argument("not-json")
    with pytest.raises(ValueError, match="source bucket"):
        parse_source_object_argument(
            '{"bucket":"other","key":"videos/source.bin"}'
        )
