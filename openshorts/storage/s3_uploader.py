import os
import json
from urllib.parse import urlparse
from dotenv import load_dotenv
load_dotenv()
import boto3
from botocore.exceptions import ClientError
from botocore.config import Config
from boto3.s3.transfer import TransferConfig
import logging
from openshorts.rendering.video_output_validation import validate_clip_output
from openshorts.observability.audit_capture import get_audit_emitter

# Configure silent logging for boto3 and botocore
logging.getLogger('boto3').setLevel(logging.CRITICAL)
logging.getLogger('botocore').setLevel(logging.CRITICAL)
logging.getLogger('s3transfer').setLevel(logging.CRITICAL)

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

def _get_s3_endpoint_url():
    endpoint_url = os.environ.get("AWS_S3_ENDPOINT_URL", "").strip()
    return endpoint_url or None

def _get_public_s3_endpoint_url():
    endpoint_url = os.environ.get("AWS_S3_PUBLIC_ENDPOINT_URL", "").strip()
    if endpoint_url:
        return endpoint_url
    return _get_s3_endpoint_url()

def _force_path_style():
    value = os.environ.get("AWS_S3_FORCE_PATH_STYLE", "false").strip().lower()
    return value in ("1", "true", "yes", "on")

def upload_file_to_s3(file_path, bucket_name, s3_key):
    """
    Upload a file to an S3 bucket silently.
    """
    access_key = os.environ.get('AWS_ACCESS_KEY_ID')
    secret_key = os.environ.get('AWS_SECRET_ACCESS_KEY')
    region = os.environ.get('AWS_REGION', 'eu-west-3')
    endpoint_url = _get_s3_endpoint_url()
    audit_url = endpoint_url or f"https://s3.{region}.amazonaws.com/{bucket_name}/{s3_key}"
    audit = get_audit_emitter()
    audit_event_id = audit.start_request(
        name="artifact.upload",
        url=audit_url,
        method="PUT",
        binary=True,
        metadata={"bucket": bucket_name, "key": s3_key},
    )

    if not access_key or not secret_key:
        audit.finish_request(audit_event_id, status="failed", error="S3 credentials are not configured", binary=True)
        return False

    s3_client = _make_s3_client(access_key, secret_key, region, endpoint_url)
    try:
        import mimetypes
        content_type, _ = mimetypes.guess_type(file_path)
        if not content_type and file_path.lower().endswith('.mp4'):
            content_type = 'video/mp4'
        elif not content_type:
            content_type = 'application/octet-stream'
            
        extra_args = {'ContentType': content_type}
        if content_type.startswith('video/'):
            extra_args['CacheControl'] = os.environ.get(
                'MINIO_VIDEO_CACHE_CONTROL',
                'public, max-age=31536000, immutable',
            )

        s3_client.upload_file(
            file_path, 
            bucket_name, 
            s3_key,
            ExtraArgs=extra_args,
        )
        audit.finish_request(
            audit_event_id,
            status_code=200,
            response_bytes=os.path.getsize(file_path) if os.path.exists(file_path) else 0,
            binary=True,
        )
        return True
    except ClientError as error:
        audit.finish_request(audit_event_id, status="failed", error=str(error), binary=True)
        return False
    except Exception as error:
        audit.finish_request(audit_event_id, status="failed", error=str(error), binary=True)
        return False


import json
import time as time_module

# Simple in-memory cache for gallery clips
_clips_cache = {
    "data": None,
    "timestamp": 0
}
def _make_s3_client(access_key, secret_key, region, endpoint_url=None):
    client_kwargs = {
        "aws_access_key_id": access_key,
        "aws_secret_access_key": secret_key,
        "region_name": region,
    }
    if endpoint_url:
        client_kwargs["endpoint_url"] = endpoint_url
    client_kwargs["config"] = Config(
        signature_version="s3v4",
        s3={
            "addressing_style": "path" if endpoint_url or _force_path_style() else "auto",
        },
    )
    return boto3.client("s3", **client_kwargs)

CACHE_TTL_SECONDS = 300  # 5 minutes

def get_s3_client():
    """Returns an authenticated S3 client."""
    access_key = os.environ.get('AWS_ACCESS_KEY_ID')
    secret_key = os.environ.get('AWS_SECRET_ACCESS_KEY')
    region = os.environ.get('AWS_REGION', 'eu-west-3')
    endpoint_url = _get_s3_endpoint_url()

    if not access_key or not secret_key:
        return None

    return _make_s3_client(access_key, secret_key, region, endpoint_url)


def _positive_env_int(name, default):
    try:
        value = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default
    return max(1, value)


def get_s3_download_config():
    """Return bounded multipart settings for large MinIO/S3 downloads."""
    megabyte = 1024 * 1024
    return TransferConfig(
        multipart_threshold=(
            _positive_env_int("MINIO_DOWNLOAD_MULTIPART_THRESHOLD_MB", 32) * megabyte
        ),
        multipart_chunksize=(
            _positive_env_int("MINIO_DOWNLOAD_MULTIPART_CHUNKSIZE_MB", 64) * megabyte
        ),
        max_concurrency=_positive_env_int("MINIO_DOWNLOAD_MAX_CONCURRENCY", 16),
        use_threads=True,
    )


def generate_presigned_url(bucket_name, object_key, expiration=3600):
    """Generate a presigned URL to share an S3 object."""
    access_key = os.environ.get('AWS_ACCESS_KEY_ID')
    secret_key = os.environ.get('AWS_SECRET_ACCESS_KEY')
    region = os.environ.get('AWS_REGION', 'eu-west-3')
    endpoint_url = _get_public_s3_endpoint_url()

    if not access_key or not secret_key:
        return None
    try:
        s3_client = _make_s3_client(access_key, secret_key, region, endpoint_url)
        response = s3_client.generate_presigned_url('get_object',
                                                    Params={'Bucket': bucket_name,
                                                            'Key': object_key},
                                                    ExpiresIn=expiration)
        return response
    except ClientError as e:
        logger.error(e)
        return None


def resolve_clip_video_url(bucket_name, job_id, base_name, clip, clip_index):
    """Generate a fresh URL instead of reusing an expired metadata signature."""
    stored_url = str(clip.get("video_url") or clip.get("url") or "").strip()
    if stored_url.startswith(("http://", "https://")):
        clip_filename = os.path.basename(urlparse(stored_url).path)
    else:
        clip_filename = os.path.basename(stored_url.split("?")[0].split("#")[0])
    if not clip_filename:
        clip_filename = f"{base_name}_clip_{clip_index + 1}.mp4"

    clip_id = str(clip.get("render_job_id") or job_id)
    clip_key = artifact_object_key(job_id, clip_filename, clip_id=clip_id)
    return generate_presigned_url(bucket_name, clip_key, expiration=7200) or stored_url

def list_all_clips(bucket_name=None, limit=50, force_refresh=False):
    """
    List recent clips from the S3 bucket by finding metadata files.
    Returns a list of dicts containing clip info and signed URLs.
    
    Args:
        bucket_name: S3 bucket name (defaults to AWS_S3_BUCKET env var)
        limit: Maximum number of clips to return (default 50 for speed)
        force_refresh: If True, bypass cache
    """
    global _clips_cache
    
    # Check cache first
    now = time_module.time()
    if not force_refresh and _clips_cache["data"] is not None:
        if now - _clips_cache["timestamp"] < CACHE_TTL_SECONDS:
            cached = _clips_cache["data"]
            return cached[:limit] if limit else cached
    
    if not bucket_name:
        bucket_name = os.environ.get('AWS_S3_BUCKET', 'my-clips-bucket')

    s3_client = get_s3_client()
    if not s3_client:
        return []

    all_clips = []
    
    try:
        # List all objects in bucket
        # Note: For very large buckets, pagination is needed. 
        # Assuming reasonable size for now, but adding continuation token support is best practice.
        paginator = s3_client.get_paginator('list_objects_v2')
        pages = paginator.paginate(Bucket=bucket_name)

        metadata_files = []
        for page in pages:
            if 'Contents' in page:
                for obj in page['Contents']:
                    if obj['Key'].endswith('_metadata.json'):
                         metadata_files.append(obj)
        
        # Sort metadata by LastModified (newest first)
        metadata_files.sort(key=lambda x: x['LastModified'], reverse=True)

        for meta_obj in metadata_files:
            key = meta_obj['Key']
            # key format: {job_id}/..._metadata.json
            
            # Read metadata content
            try:
                obj_resp = s3_client.get_object(Bucket=bucket_name, Key=key)
                content = obj_resp['Body'].read().decode('utf-8')
                data = json.loads(content)
                
                parts = key.split('/')
                job_id = parts[0] if len(parts) > 1 else "unknown"
                # Filename base for clips in same folder
                # Meta key: "job_id/filename_metadata.json"
                # Base name in metadata usually matches filename without ext
                meta_filename = os.path.basename(key) 
                base_name = meta_filename.replace('_metadata.json', '')
                
                clips_data = data.get('shorts', [])
                
                for i, clip in enumerate(clips_data):
                    resolved_url = resolve_clip_video_url(
                        bucket_name,
                        job_id,
                        base_name,
                        clip,
                        i,
                    )
                    
                    if resolved_url:
                        clip_entry = {
                            "job_id": job_id,
                            "index": i,
                            "url": resolved_url,
                            "video_url": resolved_url,
                            "title": clip.get('video_title_for_youtube_short', 'Untitled Clip'),
                            "tiktok_desc": clip.get('video_description_for_tiktok', ''),
                            "insta_desc": clip.get('video_description_for_instagram', ''),
                            "created_at": meta_obj['LastModified'].isoformat(),
                            "duration": clip.get('end', 0) - clip.get('start', 0)
                        }

                        for key in (
                            "thumbnail_url",
                            "poster_url",
                            "preview_image_url",
                            "image_url",
                            "actor_url",
                        ):
                            value = clip.get(key)
                            if value:
                                clip_entry[key] = value

                        all_clips.append({
                            **clip_entry,
                        })
                        
                        # Early exit if we have enough clips
                        if limit and len(all_clips) >= limit:
                            break
                
                # Early exit if we have enough clips
                if limit and len(all_clips) >= limit:
                    break

            except Exception as e:
                logger.error(f"Error processing metadata {key}: {e}")
                continue

    except Exception as e:
        logger.error(f"Error listing bucket: {e}")
        return []
    
    # Update cache with full results (keep for pagination later)
    _clips_cache["data"] = all_clips
    _clips_cache["timestamp"] = now

    return all_clips[:limit] if limit else all_clips

def _load_clip_output_policies(directory):
    policies = {}
    for filename in os.listdir(directory):
        if not filename.endswith("_metadata.json"):
            continue
        try:
            with open(os.path.join(directory, filename), "r", encoding="utf-8") as handle:
                metadata = json.load(handle)
        except (OSError, TypeError, ValueError):
            continue

        base_name = filename[:-len("_metadata.json")]
        for index, clip in enumerate(metadata.get("shorts", [])):
            if not isinstance(clip, dict):
                continue
            video_filename = clip.get("video_filename") or f"{base_name}_clip_{index + 1}.mp4"
            expected = (
                clip.get("output_width"),
                clip.get("output_height"),
                clip.get("output_fps"),
            )
            if all(value is not None for value in expected):
                policies[video_filename] = {
                    "width": int(expected[0]),
                    "height": int(expected[1]),
                    "fps": float(expected[2]),
                    "source_has_audio": bool(clip.get("source_has_audio", False)),
                }
    return policies


def artifact_object_key(job_id, relative_name, clip_id=None):
    """Return the canonical object key for a job artifact."""
    relative_name = str(relative_name).replace("\\", "/").lstrip("/")
    job_id = str(job_id).strip()
    normalized_name = relative_name.lower()
    if (
        normalized_name == "source.mp4"
        or normalized_name.startswith("source.")
        or normalized_name.startswith("master_")
        or normalized_name.endswith("_metadata.json")
    ):
        return f"{job_id}/master/{relative_name}"
    clip_id = str(clip_id or job_id).strip()
    return f"{job_id}/clips/{clip_id}/{relative_name}"


def upload_job_artifacts(directory, job_id, excluded_paths=None, include_paths=None, clip_id=None):
    """
    Upload all generated clips and metadata for a job to S3.
    """
    bucket_name = os.environ.get('AWS_S3_BUCKET', 'my-clips-bucket')
    
    if not os.path.exists(directory):
        return False

    excluded_paths = {
        str(path).replace("\\", "/").lstrip("/")
        for path in (excluded_paths or ())
    }
    include_paths = {
        str(path).replace("\\", "/").lstrip("/")
        for path in (include_paths or ())
    }
    output_policies = _load_clip_output_policies(directory)
    eligible_count = 0
    all_uploaded = True
    for current_root, _, filenames in os.walk(directory):
        for filename in filenames:
            relative_name = os.path.relpath(os.path.join(current_root, filename), directory).replace(os.sep, "/")
            if relative_name in excluded_paths:
                continue
            if include_paths and relative_name not in include_paths:
                continue
            # Upload media, metadata, manifests, and sidecars while skipping scratch files.
            normalized_filename = filename.lower()
            if (
                not normalized_filename.endswith((".mp4", ".json", ".srt"))
                or normalized_filename.startswith("temp_")
                or "_temp_video" in normalized_filename
                or normalized_filename == "_source_analysis.json"
                or normalized_filename == "clip_statuses.json"
            ):
                continue
            file_path = os.path.join(current_root, filename)
            policy = output_policies.get(filename)
            if normalized_filename.endswith(".mp4") and policy:
                try:
                    validate_clip_output(
                        file_path,
                        expected_width=policy["width"],
                        expected_height=policy["height"],
                        expected_fps=policy["fps"],
                        source_has_audio=policy["source_has_audio"],
                    )
                except (OSError, TypeError, ValueError) as error:
                    logger.warning("Skipping invalid clip artifact %s: %s", relative_name, error)
                    all_uploaded = False
                    continue
            s3_key = artifact_object_key(job_id, relative_name, clip_id=clip_id)
            eligible_count += 1
            if not upload_file_to_s3(file_path, bucket_name, s3_key):
                all_uploaded = False

    return eligible_count > 0 and all_uploaded


def hydrate_job_artifacts(directory, job_id):
    """Restore a job's media/metadata into its temporary worker directory."""
    bucket_name = os.environ.get("AWS_S3_BUCKET", "").strip()
    job_id = str(job_id or "").strip()
    client = get_s3_client()
    if not bucket_name or not job_id or not client:
        return 0

    output_path = os.path.abspath(directory)
    os.makedirs(output_path, exist_ok=True)
    hydrated = 0
    paginator = client.get_paginator("list_objects_v2")
    seen_keys = set()
    for prefix in (f"{job_id}/master/",):
        for page in paginator.paginate(Bucket=bucket_name, Prefix=prefix):
            for item in page.get("Contents", []):
                key = str(item.get("Key") or "")
                if key in seen_keys:
                    continue
                seen_keys.add(key)
                filename = key[len(prefix):] if key.startswith(prefix) else ""
                if not filename or not filename.endswith((".mp4", ".json", ".srt")):
                    continue
                destination = os.path.join(output_path, filename)
                if not os.path.abspath(destination).startswith(output_path + os.sep):
                    continue
                if os.path.isfile(destination) and os.path.getsize(destination) > 0:
                    continue
                os.makedirs(os.path.dirname(destination), exist_ok=True)
                client.download_file(
                    bucket_name,
                    key,
                    destination,
                    Config=get_s3_download_config(),
                )
                hydrated += 1
    return hydrated


def delete_job_artifacts(job_id):
    """
    Delete all generated clips and metadata for a job from S3.
    """
    bucket_name = os.environ.get('AWS_S3_BUCKET', 'my-clips-bucket')
    s3_client = get_s3_client()
    if not s3_client:
        return 0

    prefix = f"{job_id}/"
    try:
        deleted = _delete_objects_with_prefix(s3_client, bucket_name, prefix)
        # Invalidate clips cache
        global _clips_cache
        _clips_cache["data"] = None
        return deleted
    except Exception as e:
        logger.error(f"Failed to delete job artifacts for {job_id}: {e}")
        return 0
