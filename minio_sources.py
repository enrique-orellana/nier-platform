"""Authenticated access to the allowlisted MinIO source bucket."""

from __future__ import annotations

import os
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from threading import Lock

from botocore.exceptions import ClientError

from audit_capture import get_audit_emitter
from s3_uploader import get_s3_client, get_s3_download_config


SOURCE_BUCKET = "youtube-downloads"
DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 100


def validate_source_object(value: dict) -> tuple[str, str]:
    """Validate a client-selected source object without accepting path escapes."""
    if not isinstance(value, dict):
        raise ValueError("Source object must be an object")

    bucket = str(value.get("bucket") or "").strip()
    key = str(value.get("key") or "").strip().lstrip("/")
    if bucket != SOURCE_BUCKET:
        raise ValueError("Only the youtube-downloads source bucket is allowed")
    if (
        not key
        or "\\" in key
        or any(part in {"", ".", ".."} for part in key.split("/"))
    ):
        raise ValueError("Source object key is invalid")
    return bucket, key


def _iso_datetime(value: datetime | str | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _safe_object(item: dict) -> dict:
    key = str(item.get("Key") or "")
    return {
        "key": key,
        "name": Path(key).name,
        "size": int(item.get("Size") or 0),
        "last_modified": _iso_datetime(item.get("LastModified")),
    }


def list_source_objects(
    search: str = "",
    limit: int = DEFAULT_PAGE_SIZE,
    continuation_token: str | None = None,
) -> dict:
    """List safe metadata for objects in the configured source bucket."""
    client = get_s3_client()
    if client is None:
        raise RuntimeError("MinIO credentials are not configured")

    normalized_search = str(search or "").strip().casefold()
    page_size = max(1, min(int(limit or DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE))
    objects: list[dict] = []
    request_token = continuation_token or None
    next_token = None

    while len(objects) < page_size:
        request = {
            "Bucket": SOURCE_BUCKET,
            "MaxKeys": page_size,
        }
        if request_token:
            request["ContinuationToken"] = request_token
        try:
            response = client.list_objects_v2(**request)
        except ClientError as error:
            raise RuntimeError("MinIO source bucket could not be listed") from error

        for item in response.get("Contents") or []:
            safe_item = _safe_object(item)
            if normalized_search and normalized_search not in safe_item["key"].casefold():
                continue
            objects.append(safe_item)
            if len(objects) >= page_size:
                break

        if len(objects) >= page_size or not response.get("IsTruncated"):
            next_token = response.get("NextContinuationToken") if response.get("IsTruncated") else None
            break
        request_token = response.get("NextContinuationToken")
        if not request_token:
            break

    return {
        "bucket": SOURCE_BUCKET,
        "objects": objects,
        "next_continuation_token": next_token,
    }


def download_source_object(
    bucket: str,
    key: str,
    destination: str,
    max_bytes: int,
    progress_callback: Callable[[int, int | None], None] | None = None,
) -> None:
    """Download one MinIO object with multipart concurrency and atomic rename."""
    validated_bucket, validated_key = validate_source_object({"bucket": bucket, "key": key})
    client = get_s3_client()
    if client is None:
        raise RuntimeError("MinIO credentials are not configured")

    destination_path = Path(destination)
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    partial_path = destination_path.with_name(f"{destination_path.name}.part")
    endpoint = os.environ.get("AWS_S3_ENDPOINT_URL", "").strip() or "https://s3.amazonaws.com"
    audit = get_audit_emitter()
    audit_event_id = audit.start_request(
        name="source.download",
        url=f"{endpoint.rstrip('/')}/{validated_bucket}/{validated_key}",
        method="GET",
        binary=True,
        metadata={"bucket": validated_bucket, "key": validated_key},
    )
    written = 0
    try:
        response = client.head_object(Bucket=validated_bucket, Key=validated_key)
        content_length = response.get("ContentLength")
        if content_length is not None and int(content_length) > max_bytes:
            raise ValueError("Source object exceeds the configured file size limit")

        progress_lock = Lock()

        def on_progress(bytes_amount):
            nonlocal written
            with progress_lock:
                written += int(bytes_amount or 0)
                if written > max_bytes:
                    raise ValueError("Source object exceeds the configured file size limit")
                if progress_callback:
                    progress_callback(
                        written,
                        int(content_length) if content_length is not None else None,
                    )

        client.download_file(
            validated_bucket,
            validated_key,
            str(partial_path),
            Callback=on_progress,
            Config=get_s3_download_config(),
        )

        os.replace(partial_path, destination_path)
        audit.finish_request(audit_event_id, status_code=200, response_bytes=written, binary=True)
    except ClientError as error:
        audit.finish_request(audit_event_id, status="failed", response_bytes=written, error=str(error), binary=True)
        code = str((error.response or {}).get("Error", {}).get("Code", ""))
        if code in {"404", "NoSuchKey", "NoSuchObject", "NotFound"}:
            raise FileNotFoundError(f"MinIO source object not found: {validated_key}") from error
        raise RuntimeError("MinIO source object could not be downloaded") from error
    except Exception:
        audit.finish_request(audit_event_id, status="failed", response_bytes=written, error="source download failed", binary=True)
        if partial_path.exists():
            partial_path.unlink()
        raise
