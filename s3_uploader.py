import os
import re
import tempfile
import zipfile
from dotenv import load_dotenv
load_dotenv()
import boto3
from botocore.exceptions import ClientError
from botocore.config import Config
import logging

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

def _build_public_object_url(bucket_name, object_key):
    """
    Build a browser-facing object URL.
    Falls back to the current AWS-style URL if no custom public base is set.
    """
    public_base = os.environ.get("AWS_S3_PUBLIC_URL_BASE", "").strip()
    region = os.environ.get("AWS_REGION", "eu-west-3")

    if public_base:
        return f"{public_base.rstrip('/')}/{bucket_name}/{object_key.lstrip('/')}"

    return f"https://{bucket_name}.s3.{region}.amazonaws.com/{object_key.lstrip('/')}"

def _build_public_gallery_url(bucket_name, object_key, expiration=86400):
    """
    Build a gallery-facing URL.
    Prefer signed URLs when a public S3 endpoint is configured, so the browser
    can still access objects even if the bucket policy is not fully public.
    """
    if _get_public_s3_endpoint_url():
        signed_url = generate_presigned_url(bucket_name, object_key, expiration=expiration)
        if signed_url:
            return signed_url
    return _build_public_object_url(bucket_name, object_key)

def upload_file_to_s3(file_path, bucket_name, s3_key):
    """
    Upload a file to an S3 bucket silently.
    """
    access_key = os.environ.get('AWS_ACCESS_KEY_ID')
    secret_key = os.environ.get('AWS_SECRET_ACCESS_KEY')
    region = os.environ.get('AWS_REGION', 'eu-west-3')
    endpoint_url = _get_s3_endpoint_url()

    if not access_key or not secret_key:
        return False

    s3_client = _make_s3_client(access_key, secret_key, region, endpoint_url)
    try:
        # Extra arguments for public read if needed, but the user didn't specify.
        # Given the bucket name, it might be for a web app.
        s3_client.upload_file(file_path, bucket_name, s3_key)
        return True
    except ClientError:
        return False
    except Exception:
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
                    stored_video_url = (clip.get("video_url") or clip.get("url") or "").strip()
                    if stored_video_url.startswith(("http://", "https://")):
                        resolved_url = stored_video_url
                    else:
                        clip_filename = os.path.basename(stored_video_url.split("?")[0].split("#")[0]) if stored_video_url else f"{base_name}_clip_{i+1}.mp4"
                        clip_key = f"{job_id}/{clip_filename}"
                        resolved_url = generate_presigned_url(bucket_name, clip_key, expiration=7200)  # 2 hours
                    
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

def upload_actor_to_s3(file_path, description=""):
    """
    Upload an actor image to the public S3 bucket.
    Returns the public URL or None on failure.
    """
    bucket_name = os.environ.get('AWS_S3_PUBLIC_BUCKET', 'my-public-bucket')

    s3_client = get_s3_client()
    if not s3_client:
        return None

    import uuid
    unique_id = str(uuid.uuid4())[:8]
    filename = os.path.basename(file_path)
    name, ext = os.path.splitext(filename)
    s3_key = f"avatars/{name}_{unique_id}{ext}"

    try:
        # Skip broken/tiny files
        if os.path.getsize(file_path) < 1000:
            logger.warning(f"Skipping tiny file ({os.path.getsize(file_path)} bytes): {file_path}")
            return None

        s3_client.upload_file(
            file_path, bucket_name, s3_key,
            ExtraArgs={'ContentType': 'image/png'},
        )
        public_url = _build_public_gallery_url(bucket_name, s3_key)

        # Save metadata JSON alongside the image
        if description:
            import datetime
            meta_key = s3_key.rsplit('.', 1)[0] + '.json'
            meta = json.dumps({
                "description": description,
                "url": public_url,
                "created_at": datetime.datetime.utcnow().isoformat() + "Z",
            }, ensure_ascii=False)
            s3_client.put_object(
                Bucket=bucket_name, Key=meta_key,
                Body=meta.encode('utf-8'),
                ContentType='application/json',
            )

        logger.info(f"Uploaded actor to S3: {public_url}")
        return public_url
    except Exception as e:
        logger.error(f"Failed to upload actor to S3: {e}")
        return None


def list_actor_gallery():
    """
    List all actor images from the public S3 bucket.
    Returns list with URLs and descriptions, newest first.
    """
    bucket_name = os.environ.get('AWS_S3_PUBLIC_BUCKET', 'my-public-bucket')

    s3_client = get_s3_client()
    if not s3_client:
        return []

    try:
        paginator = s3_client.get_paginator('list_objects_v2')
        pages = paginator.paginate(Bucket=bucket_name, Prefix='avatars/')

        all_objects = {}
        for page in pages:
            for obj in page.get('Contents', []):
                key = obj['Key']
                base = key.rsplit('.', 1)[0]
                if base not in all_objects:
                    all_objects[base] = {}
                if key.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
                    all_objects[base]['image'] = obj
                elif key.endswith('.json'):
                    all_objects[base]['meta_key'] = key

        images = []
        for base, data in all_objects.items():
            if 'image' not in data:
                continue
            obj = data['image']
            key = obj['Key']
            public_url = _build_public_gallery_url(bucket_name, key)
            entry = {
                "url": public_url,
                "key": key,
                "created_at": obj['LastModified'].isoformat(),
                "description": "",
            }
            # Try to read metadata JSON
            if 'meta_key' in data:
                try:
                    meta_resp = s3_client.get_object(Bucket=bucket_name, Key=data['meta_key'])
                    meta = json.loads(meta_resp['Body'].read().decode('utf-8'))
                    entry['description'] = meta.get('description', '')
                except Exception:
                    pass
            images.append(entry)

        images.sort(key=lambda x: x['created_at'], reverse=True)
        return images

    except Exception as e:
        logger.error(f"Failed to list actor gallery: {e}")
        return []


# ── SaaS Video Gallery (public S3) ──────────────────────────────────

_video_gallery_cache = {
    "data": None,
    "timestamp": 0,
}

def upload_video_to_gallery(video_path, actor_image_path, metadata, video_id=None):
    """
    Upload a generated UGC video + actor + metadata to the public S3 bucket.
    Returns dict with public URLs or None on failure.
    """
    import uuid
    bucket_name = os.environ.get('AWS_S3_PUBLIC_BUCKET', 'my-public-bucket')

    s3_client = get_s3_client()
    if not s3_client:
        return None

    if not video_id:
        video_id = str(uuid.uuid4())[:8]

    results = {}

    try:
        # Upload video
        if os.path.exists(video_path):
            s3_key = f"videos/{video_id}/video.mp4"
            s3_client.upload_file(video_path, bucket_name, s3_key,
                                 ExtraArgs={'ContentType': 'video/mp4'})
            results["video_url"] = _build_public_gallery_url(bucket_name, s3_key)

        # Upload actor image
        if actor_image_path and os.path.exists(actor_image_path):
            s3_key = f"videos/{video_id}/actor.png"
            s3_client.upload_file(actor_image_path, bucket_name, s3_key,
                                 ExtraArgs={'ContentType': 'image/png'})
            results["actor_url"] = _build_public_gallery_url(bucket_name, s3_key)

        # Build and upload metadata
        import datetime
        metadata["video_id"] = video_id
        metadata["video_url"] = results.get("video_url", "")
        metadata["actor_url"] = results.get("actor_url", "")
        metadata["created_at"] = datetime.datetime.utcnow().isoformat() + "Z"

        meta_json = json.dumps(metadata, ensure_ascii=False, indent=2)
        s3_key = f"videos/{video_id}/metadata.json"
        s3_client.put_object(
            Bucket=bucket_name, Key=s3_key,
            Body=meta_json.encode('utf-8'),
            ContentType='application/json',
        )
        results["metadata_url"] = _build_public_gallery_url(bucket_name, s3_key)
        results["video_id"] = video_id

        logger.info(f"Uploaded video gallery: {video_id}")

        # Invalidate cache
        _video_gallery_cache["data"] = None

        return results

    except Exception as e:
        logger.error(f"Failed to upload video to gallery: {e}")
        return None


def list_video_gallery(limit=50, force_refresh=False):
    """
    List all UGC videos from the public S3 bucket.
    Returns list of metadata dicts, newest first.
    """
    global _video_gallery_cache

    now = time_module.time()
    if not force_refresh and _video_gallery_cache["data"] is not None:
        if now - _video_gallery_cache["timestamp"] < CACHE_TTL_SECONDS:
            cached = _video_gallery_cache["data"]
            return cached[:limit] if limit else cached

    bucket_name = os.environ.get('AWS_S3_PUBLIC_BUCKET', 'my-public-bucket')

    s3_client = get_s3_client()
    if not s3_client:
        return []

    videos = []

    try:
        paginator = s3_client.get_paginator('list_objects_v2')
        pages = paginator.paginate(Bucket=bucket_name, Prefix='videos/')

        meta_files = []
        for page in pages:
            for obj in page.get('Contents', []):
                if obj['Key'].endswith('/metadata.json'):
                    meta_files.append(obj)

        # Newest first
        meta_files.sort(key=lambda x: x['LastModified'], reverse=True)

        for meta_obj in meta_files:
            try:
                obj_resp = s3_client.get_object(Bucket=bucket_name, Key=meta_obj['Key'])
                content = obj_resp['Body'].read().decode('utf-8')
                data = json.loads(content)

                if _get_public_s3_endpoint_url():
                    meta_key = meta_obj['Key']
                    video_id = data.get("video_id")
                    if not video_id:
                        parts = meta_key.split("/")
                        video_id = parts[1] if len(parts) > 1 else os.path.basename(meta_key).replace("metadata.json", "").rstrip("/")
                    data["video_id"] = video_id
                    data["video_url"] = generate_presigned_url(bucket_name, f"videos/{video_id}/video.mp4", expiration=86400) or data.get("video_url", "")
                    data["actor_url"] = generate_presigned_url(bucket_name, f"videos/{video_id}/actor.png", expiration=86400) or data.get("actor_url", "")
                    data["metadata_url"] = generate_presigned_url(bucket_name, meta_key, expiration=86400) or data.get("metadata_url", "")

                videos.append(data)
                if limit and len(videos) >= limit:
                    break
            except Exception as e:
                logger.error(f"Error reading metadata {meta_obj['Key']}: {e}")
                continue

    except Exception as e:
        logger.error(f"Failed to list video gallery: {e}")
        return []

    _video_gallery_cache["data"] = videos
    _video_gallery_cache["timestamp"] = now

    return videos[:limit] if limit else videos


def upload_job_artifacts(directory, job_id):
    """
    Upload all generated clips and metadata for a job to S3.
    """
    bucket_name = os.environ.get('AWS_S3_BUCKET', 'my-clips-bucket')
    
    if not os.path.exists(directory):
        return

    for filename in os.listdir(directory):
        # Upload .mp4 clips and the metadata JSON
        if (filename.endswith(".mp4") or filename.endswith(".json")) and not filename.startswith("temp_"):
            file_path = os.path.join(directory, filename)
            s3_key = f"{job_id}/{filename}"
            upload_file_to_s3(file_path, bucket_name, s3_key)


def _slugify(value, fallback="project"):
    text = re.sub(r"[^a-zA-Z0-9]+", "_", (value or "").strip().lower()).strip("_")
    return text[:80] or fallback


def _project_prefix(session_id, project_slug):
    return f"thumbnail-projects/{session_id}/{project_slug}/"


def _project_manifest_key(session_id, project_slug):
    return f"{_project_prefix(session_id, project_slug)}manifest.json"


def _read_s3_text_object(s3_client, bucket_name, object_key):
    obj = s3_client.get_object(Bucket=bucket_name, Key=object_key)
    return obj["Body"].read().decode("utf-8")


def _write_s3_text_object(s3_client, bucket_name, object_key, content, content_type):
    s3_client.put_object(
        Bucket=bucket_name,
        Key=object_key,
        Body=content.encode("utf-8"),
        ContentType=content_type,
    )


def _s3_object_exists(s3_client, bucket_name, object_key):
    try:
        s3_client.head_object(Bucket=bucket_name, Key=object_key)
        return True
    except ClientError as e:
        error_code = str(e.response.get("Error", {}).get("Code", ""))
        if error_code in {"404", "NoSuchKey", "NotFound", "NoSuchBucket"}:
            return False
        raise


def _copy_s3_object(s3_client, bucket_name, source_key, destination_key):
    s3_client.copy_object(
        Bucket=bucket_name,
        CopySource={"Bucket": bucket_name, "Key": source_key},
        Key=destination_key,
    )


def _delete_objects_with_prefix(s3_client, bucket_name, prefix):
    paginator = s3_client.get_paginator("list_objects_v2")
    pages = paginator.paginate(Bucket=bucket_name, Prefix=prefix)
    deleted = 0
    for page in pages:
        keys = [obj["Key"] for obj in page.get("Contents", [])]
        if not keys:
            continue
        for key in keys:
            s3_client.delete_object(Bucket=bucket_name, Key=key)
            deleted += 1
    return deleted


def _project_file_kind(name):
    ext = os.path.splitext(name.lower())[1]
    if ext in (".txt", ".json", ".md", ".csv", ".yaml", ".yml"):
        return "text"
    if ext in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
        return "image"
    return "file"


def _write_project_manifest_and_metadata_files(s3_client, bucket_name, session_id, project_slug, manifest):
    prefix = _project_prefix(session_id, project_slug)
    _write_s3_text_object(s3_client, bucket_name, _project_manifest_key(session_id, project_slug), json.dumps(manifest, ensure_ascii=False, indent=2), "application/json")

    title = manifest.get("project_title") or manifest.get("title") or ""
    description = manifest.get("description", "") or ""
    _write_s3_text_object(s3_client, bucket_name, f"{prefix}selected_title.txt", title, "text/plain; charset=utf-8")
    _write_s3_text_object(s3_client, bucket_name, f"{prefix}description.txt", description, "text/plain; charset=utf-8")


def _write_project_manifest_only(s3_client, bucket_name, session_id, project_slug, manifest):
    _write_s3_text_object(
        s3_client,
        bucket_name,
        _project_manifest_key(session_id, project_slug),
        json.dumps(manifest, ensure_ascii=False, indent=2),
        "application/json",
    )


def _sync_manifest_from_file_change(manifest, rel_name, content=None):
    normalized = rel_name.replace("\\", "/").lstrip("/")
    base = os.path.basename(normalized)

    if base == "selected_title.txt":
        title = (content or "").strip()
        manifest["project_title"] = title
        manifest["title"] = title
    elif base == "description.txt":
        manifest["description"] = content or ""
    elif base == "manifest.json" and content is not None:
        try:
            updated = json.loads(content)
        except Exception:
            return None
        manifest.update(updated)
    return manifest


def upload_thumbnail_project(session_id, session_data, title=None, description=None, thumbnail_urls=None, selected_thumbnail=None):
    """
    Upload a thumbnail studio session into a browsable S3/MinIO project prefix.
    Each project is stored as a folder-like prefix with manifest and file objects.
    """
    bucket_name = os.environ.get("AWS_S3_BUCKET", "").strip() or os.environ.get("AWS_S3_PUBLIC_BUCKET", "").strip()
    s3_client = get_s3_client()
    if not s3_client or not bucket_name:
        return None

    safe_title = _slugify(title or (session_data.get("titles") or ["thumbnail_project"])[0])
    thumbnail_urls = thumbnail_urls or session_data.get("generated_thumbnails", []) or []
    description = description if description is not None else session_data.get("description", "")
    selected_thumbnail = selected_thumbnail or session_data.get("selected_thumbnail")
    transcript = session_data.get("transcript") or {}
    transcript_text = transcript.get("text", "")
    transcript_segments = session_data.get("transcript_segments", [])
    timestamp = time_module.strftime("%Y%m%dT%H%M%SZ", time_module.gmtime())
    project_slug = f"{timestamp}_{safe_title}"
    prefix = _project_prefix(session_id, project_slug)

    manifest = {
        "session_id": session_id,
        "project_slug": project_slug,
        "project_title": title or "",
        "description": description or "",
        "selected_thumbnail": selected_thumbnail or "",
        "titles": session_data.get("titles", []),
        "generated_thumbnails": thumbnail_urls,
        "language": session_data.get("language", "en"),
        "context": session_data.get("context", ""),
        "video_duration": session_data.get("video_duration", 0),
        "video_path": os.path.basename(session_data.get("video_path", "")) if session_data.get("video_path") else "",
        "transcript_text": transcript_text,
        "transcript_segments": transcript_segments,
        "transcript": transcript,
        "created_at": timestamp,
    }

    with tempfile.TemporaryDirectory() as tmpdir:
        manifest_path = os.path.join(tmpdir, "manifest.json")
        selected_title_path = os.path.join(tmpdir, "selected_title.txt")
        description_path = os.path.join(tmpdir, "description.txt")
        titles_path = os.path.join(tmpdir, "titles.txt")
        transcript_text_path = os.path.join(tmpdir, "transcript.txt")
        transcript_json_path = os.path.join(tmpdir, "transcript.json")

        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)
        with open(selected_title_path, "w", encoding="utf-8") as f:
            f.write(title or "")
        with open(description_path, "w", encoding="utf-8") as f:
            f.write(description or "")
        with open(titles_path, "w", encoding="utf-8") as f:
            f.write("\n".join(f"{i+1}. {t}" for i, t in enumerate(session_data.get("titles", []))))
        with open(transcript_text_path, "w", encoding="utf-8") as f:
            f.write(transcript_text or "")
        with open(transcript_json_path, "w", encoding="utf-8") as f:
            json.dump(transcript, f, ensure_ascii=False, indent=2)

        def _put_text(local_path, key, content_type):
            s3_client.upload_file(
                local_path,
                bucket_name,
                key,
                ExtraArgs={"ContentType": content_type},
            )

        _put_text(manifest_path, f"{prefix}manifest.json", "application/json")
        _put_text(selected_title_path, f"{prefix}selected_title.txt", "text/plain; charset=utf-8")
        _put_text(description_path, f"{prefix}description.txt", "text/plain; charset=utf-8")
        _put_text(titles_path, f"{prefix}titles.txt", "text/plain; charset=utf-8")
        _put_text(transcript_text_path, f"{prefix}transcript.txt", "text/plain; charset=utf-8")
        _put_text(transcript_json_path, f"{prefix}transcript.json", "application/json")

        uploaded_thumbnails = []
        for i, url in enumerate(thumbnail_urls, start=1):
            rel_path = (url or "").split("?", 1)[0].lstrip("/")
            local_path = os.path.join("output", rel_path)
            if not os.path.exists(local_path):
                continue
            ext = os.path.splitext(local_path)[1].lower() or ".jpg"
            thumb_name = os.path.basename(local_path)
            thumb_key = f"{prefix}thumbnails/{thumb_name}"
            content_type = "image/png" if ext == ".png" else "image/jpeg"
            s3_client.upload_file(
                local_path,
                bucket_name,
                thumb_key,
                ExtraArgs={"ContentType": content_type},
            )
            uploaded_thumbnails.append({
                "name": os.path.basename(local_path),
                "key": thumb_key,
                "url": _build_public_gallery_url(bucket_name, thumb_key, expiration=604800),
            })

    return {
        "bucket": bucket_name,
        "prefix": prefix,
        "key": f"{prefix}manifest.json",
        "url": generate_presigned_url(bucket_name, f"{prefix}manifest.json", expiration=604800),
        "project_title": title or "",
        "project_slug": project_slug,
        "thumbnail_count": len(thumbnail_urls),
        "files": [
            {"name": "manifest.json", "key": f"{prefix}manifest.json"},
            {"name": "selected_title.txt", "key": f"{prefix}selected_title.txt"},
            {"name": "description.txt", "key": f"{prefix}description.txt"},
            {"name": "titles.txt", "key": f"{prefix}titles.txt"},
            {"name": "transcript.txt", "key": f"{prefix}transcript.txt"},
            {"name": "transcript.json", "key": f"{prefix}transcript.json"},
        ] + uploaded_thumbnails,
    }


def get_thumbnail_project(session_id, project_slug):
    bucket_name = os.environ.get("AWS_S3_BUCKET", "").strip() or os.environ.get("AWS_S3_PUBLIC_BUCKET", "").strip()
    if not bucket_name:
        return None

    s3_client = get_s3_client()
    if not s3_client:
        return None

    prefix = _project_prefix(session_id, project_slug)
    manifest_key = _project_manifest_key(session_id, project_slug)
    try:
        manifest_text = _read_s3_text_object(s3_client, bucket_name, manifest_key)
        manifest = json.loads(manifest_text)

        paginator = s3_client.get_paginator("list_objects_v2")
        pages = paginator.paginate(Bucket=bucket_name, Prefix=prefix)
        files = []
        for page in pages:
            for obj in page.get("Contents", []):
                key = obj["Key"]
                if key == prefix:
                    continue
                if key.endswith("/"):
                    continue
                rel_name = key[len(prefix):] if key.startswith(prefix) else key
                files.append({
                    "name": rel_name,
                    "key": key,
                    "size": obj.get("Size", 0),
                    "created_at": obj["LastModified"].isoformat(),
                    "url": generate_presigned_url(bucket_name, key, expiration=604800),
                    "kind": _project_file_kind(rel_name),
                    "editable": _project_file_kind(rel_name) == "text",
                    "deletable": rel_name != "manifest.json",
                })

        files.sort(key=lambda item: item["name"])
        manifest["files"] = files
        manifest["bucket"] = bucket_name
        manifest["prefix"] = prefix
        manifest["key"] = manifest_key
        manifest["url"] = generate_presigned_url(bucket_name, manifest_key, expiration=604800)
        manifest["project_slug"] = project_slug
        manifest["session_id"] = session_id
        manifest["file_count"] = len(files)
        manifest["thumbnail_count"] = len([f for f in files if f["name"].startswith("thumbnails/")])
        return manifest
    except Exception as e:
        logger.error(f"Failed to read thumbnail project {prefix}: {e}")
        return None


def update_thumbnail_project(session_id, project_slug, title=None, description=None, selected_thumbnail=None):
    bucket_name = os.environ.get("AWS_S3_BUCKET", "").strip() or os.environ.get("AWS_S3_PUBLIC_BUCKET", "").strip()
    if not bucket_name:
        return None

    s3_client = get_s3_client()
    if not s3_client:
        return None

    manifest_key = _project_manifest_key(session_id, project_slug)
    try:
        manifest = json.loads(_read_s3_text_object(s3_client, bucket_name, manifest_key))
    except Exception:
        return None

    if title is not None:
        manifest["project_title"] = title
        manifest["title"] = title
        _write_s3_text_object(s3_client, bucket_name, f"{_project_prefix(session_id, project_slug)}selected_title.txt", title, "text/plain; charset=utf-8")
    if description is not None:
        manifest["description"] = description
        _write_s3_text_object(s3_client, bucket_name, f"{_project_prefix(session_id, project_slug)}description.txt", description, "text/plain; charset=utf-8")
    if selected_thumbnail is not None:
        manifest["selected_thumbnail"] = selected_thumbnail

    _write_s3_text_object(s3_client, bucket_name, manifest_key, json.dumps(manifest, ensure_ascii=False, indent=2), "application/json")
    return get_thumbnail_project(session_id, project_slug)


def update_thumbnail_project_file(session_id, project_slug, file_path, content):
    bucket_name = os.environ.get("AWS_S3_BUCKET", "").strip() or os.environ.get("AWS_S3_PUBLIC_BUCKET", "").strip()
    if not bucket_name:
        return None

    s3_client = get_s3_client()
    if not s3_client:
        return None

    prefix = _project_prefix(session_id, project_slug)
    normalized = file_path.lstrip("/")
    if normalized.startswith(prefix):
        object_key = normalized
        rel_name = normalized[len(prefix):]
    else:
        object_key = f"{prefix}{normalized}"
        rel_name = normalized

    if object_key.endswith("manifest.json"):
        try:
            manifest = json.loads(content)
        except Exception:
            return None
        _write_project_manifest_and_metadata_files(s3_client, bucket_name, session_id, project_slug, manifest)
        return get_thumbnail_project(session_id, project_slug)

    kind = _project_file_kind(rel_name)
    if kind != "text":
        return None

    content_type = "application/json" if rel_name.endswith(".json") else "text/plain; charset=utf-8"
    _write_s3_text_object(s3_client, bucket_name, object_key, content, content_type)
    if os.path.basename(rel_name) in ("selected_title.txt", "description.txt"):
        manifest_key = _project_manifest_key(session_id, project_slug)
        try:
            manifest = json.loads(_read_s3_text_object(s3_client, bucket_name, manifest_key))
        except Exception:
            return None
        updated_manifest = _sync_manifest_from_file_change(manifest, rel_name, content)
        if updated_manifest is None:
            return None
        _write_project_manifest_and_metadata_files(s3_client, bucket_name, session_id, project_slug, updated_manifest)
    return get_thumbnail_project(session_id, project_slug)


def delete_thumbnail_project_file(session_id, project_slug, file_path):
    bucket_name = os.environ.get("AWS_S3_BUCKET", "").strip() or os.environ.get("AWS_S3_PUBLIC_BUCKET", "").strip()
    if not bucket_name:
        return None

    s3_client = get_s3_client()
    if not s3_client:
        return None

    prefix = _project_prefix(session_id, project_slug)
    normalized = file_path.lstrip("/")
    if normalized.startswith(prefix):
        object_key = normalized
        rel_name = normalized[len(prefix):]
    else:
        object_key = f"{prefix}{normalized}"
        rel_name = normalized

    if object_key.endswith("manifest.json"):
        return None

    try:
        s3_client.delete_object(Bucket=bucket_name, Key=object_key)
    except Exception:
        return None

    if rel_name.startswith("thumbnails/"):
        try:
            manifest_key = _project_manifest_key(session_id, project_slug)
            manifest = json.loads(_read_s3_text_object(s3_client, bucket_name, manifest_key))
            thumb_name = os.path.basename(rel_name)
            thumb_candidates = {thumb_name}
            match = re.match(r"^(\d+)\.(jpg|jpeg|png|webp|gif)$", thumb_name, re.IGNORECASE)
            if match:
                thumb_candidates.add(f"thumb_{int(match.group(1))}.{match.group(2).lower()}")
            urls = []
            for url in manifest.get("generated_thumbnails", []):
                url_rel = (url or "").split("?", 1)[0].lstrip("/")
                if os.path.basename(url_rel) not in thumb_candidates:
                    urls.append(url)
            manifest["generated_thumbnails"] = urls
            selected = manifest.get("selected_thumbnail", "")
            if selected and os.path.basename((selected or "").split("?", 1)[0].lstrip("/")) in thumb_candidates:
                manifest["selected_thumbnail"] = ""
            _write_project_manifest_only(s3_client, bucket_name, session_id, project_slug, manifest)
        except Exception:
            pass
    elif os.path.basename(rel_name) in ("selected_title.txt", "description.txt"):
        try:
            manifest_key = _project_manifest_key(session_id, project_slug)
            manifest = json.loads(_read_s3_text_object(s3_client, bucket_name, manifest_key))
            updated_manifest = _sync_manifest_from_file_change(manifest, rel_name, "")
            if updated_manifest is not None:
                _write_project_manifest_only(s3_client, bucket_name, session_id, project_slug, updated_manifest)
        except Exception:
            pass

    return get_thumbnail_project(session_id, project_slug)


def delete_thumbnail_project(session_id, project_slug):
    bucket_name = os.environ.get("AWS_S3_BUCKET", "").strip() or os.environ.get("AWS_S3_PUBLIC_BUCKET", "").strip()
    if not bucket_name:
        return None

    s3_client = get_s3_client()
    if not s3_client:
        return None

    prefix = _project_prefix(session_id, project_slug)
    try:
        deleted = _delete_objects_with_prefix(s3_client, bucket_name, prefix)
        return {"deleted": deleted, "prefix": prefix}
    except Exception:
        return None


def _legacy_project_slug(root_prefix, metadata_key):
    base_name = os.path.basename(metadata_key).replace("_metadata.json", "")
    source_suffix = base_name
    if base_name.startswith(f"{root_prefix}_"):
        source_suffix = base_name[len(root_prefix) + 1 :]
    elif base_name.startswith(root_prefix):
        source_suffix = base_name[len(root_prefix):].lstrip("_")
    slug = _slugify(source_suffix, fallback="imported")
    return f"legacy_{slug}"


def _build_legacy_project_manifest(root_prefix, metadata_key, metadata, copied_files, created_at):
    shorts = metadata.get("shorts", []) if isinstance(metadata, dict) else []
    titles = []
    descriptions = []
    for short in shorts:
        if not isinstance(short, dict):
            continue
        title = short.get("video_title_for_youtube_short") or short.get("title") or short.get("hook_text") or ""
        if title:
            titles.append(title)
        desc = short.get("video_description_for_tiktok") or short.get("video_description_for_instagram") or ""
        if desc:
            descriptions.append(desc)

    project_title = titles[0] if titles else f"Imported {root_prefix}"
    description = descriptions[0] if descriptions else ""
    project_slug = _legacy_project_slug(root_prefix, metadata_key)

    manifest = {
        "session_id": root_prefix,
        "project_slug": project_slug,
        "project_title": project_title,
        "title": project_title,
        "description": description,
        "selected_thumbnail": "",
        "titles": titles,
        "generated_thumbnails": [],
        "language": metadata.get("language", "en") if isinstance(metadata, dict) else "en",
        "context": metadata.get("context", "") if isinstance(metadata, dict) else "",
        "video_duration": metadata.get("video_duration", 0) if isinstance(metadata, dict) else 0,
        "video_path": "",
        "transcript_text": "",
        "transcript_segments": [],
        "transcript": {},
        "created_at": created_at,
        "legacy_import": True,
        "legacy_source_prefix": f"{root_prefix}/",
        "legacy_metadata_key": metadata_key,
        "legacy_files": copied_files,
    }
    return manifest


def _list_legacy_thumbnail_roots(s3_client, bucket_name):
    paginator = s3_client.get_paginator("list_objects_v2")
    roots = {}
    for page in paginator.paginate(Bucket=bucket_name):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if not key or key.startswith("thumbnail-projects/"):
                continue
            parts = key.split("/", 1)
            if len(parts) < 2:
                continue
            root_prefix = parts[0]
            root = roots.setdefault(root_prefix, {"objects": [], "metadata": []})
            root["objects"].append(obj)
            if key.endswith("_metadata.json"):
                root["metadata"].append(obj)
    return roots


def migrate_legacy_thumbnail_projects(dry_run=False, delete_source=True):
    """
    Move legacy bucket-root clip folders into thumbnail-projects/<session>/<slug>/.
    Returns a summary of migrated projects.
    """
    bucket_name = os.environ.get("AWS_S3_BUCKET", "").strip() or os.environ.get("AWS_S3_PUBLIC_BUCKET", "").strip()
    if not bucket_name:
        return {"migrated": [], "skipped": [], "dry_run": dry_run, "delete_source": delete_source}

    s3_client = get_s3_client()
    if not s3_client:
        return {"migrated": [], "skipped": [], "dry_run": dry_run, "delete_source": delete_source}

    roots = _list_legacy_thumbnail_roots(s3_client, bucket_name)
    migrated = []
    skipped = []

    for root_prefix, payload in sorted(roots.items()):
        metadata_objs = payload.get("metadata", [])
        object_objs = payload.get("objects", [])
        if not metadata_objs:
            continue

        metadata_obj = sorted(metadata_objs, key=lambda item: item["LastModified"], reverse=True)[0]
        metadata_key = metadata_obj["Key"]
        project_slug = _legacy_project_slug(root_prefix, metadata_key)
        destination_prefix = _project_prefix(root_prefix, project_slug)
        manifest_key = _project_manifest_key(root_prefix, project_slug)

        if _s3_object_exists(s3_client, bucket_name, manifest_key):
            deleted_source_objects = 0
            if delete_source:
                deleted_source_objects = _delete_objects_with_prefix(s3_client, bucket_name, f"{root_prefix}/")
            skipped.append({
                "root_prefix": root_prefix,
                "project_slug": project_slug,
                "reason": "already_migrated",
                "destination_prefix": destination_prefix,
                "deleted_source_objects": deleted_source_objects,
            })
            continue

        try:
            metadata_text = _read_s3_text_object(s3_client, bucket_name, metadata_key)
            metadata = json.loads(metadata_text)
        except Exception:
            metadata = {}

        copied_files = []
        for obj in object_objs:
            source_key = obj["Key"]
            rel_name = os.path.basename(source_key)
            destination_key = f"{destination_prefix}source/{rel_name}"
            copied_files.append({
                "source_key": source_key,
                "destination_key": destination_key,
                "size": obj.get("Size", 0),
            })

        manifest = _build_legacy_project_manifest(
            root_prefix=root_prefix,
            metadata_key=metadata_key,
            metadata=metadata,
            copied_files=copied_files,
            created_at=metadata_obj["LastModified"].isoformat(),
        )

        migrated_entry = {
            "root_prefix": root_prefix,
            "project_slug": project_slug,
            "destination_prefix": destination_prefix,
            "manifest_key": manifest_key,
            "source_count": len(object_objs),
            "dry_run": dry_run,
        }

        if dry_run:
            migrated.append(migrated_entry)
            continue

        _write_s3_text_object(
            s3_client,
            bucket_name,
            manifest_key,
            json.dumps(manifest, ensure_ascii=False, indent=2),
            "application/json",
        )
        _write_s3_text_object(
            s3_client,
            bucket_name,
            f"{destination_prefix}selected_title.txt",
            manifest["project_title"],
            "text/plain; charset=utf-8",
        )
        _write_s3_text_object(
            s3_client,
            bucket_name,
            f"{destination_prefix}description.txt",
            manifest["description"],
            "text/plain; charset=utf-8",
        )
        _write_s3_text_object(
            s3_client,
            bucket_name,
            f"{destination_prefix}titles.txt",
            "\n".join(f"{i + 1}. {title}" for i, title in enumerate(manifest.get("titles", []))),
            "text/plain; charset=utf-8",
        )
        _write_s3_text_object(
            s3_client,
            bucket_name,
            f"{destination_prefix}transcript.txt",
            "",
            "text/plain; charset=utf-8",
        )
        _write_s3_text_object(
            s3_client,
            bucket_name,
            f"{destination_prefix}transcript.json",
            "{}",
            "application/json",
        )

        for obj in object_objs:
            source_key = obj["Key"]
            rel_name = os.path.basename(source_key)
            destination_key = f"{destination_prefix}source/{rel_name}"
            _copy_s3_object(s3_client, bucket_name, source_key, destination_key)

        if delete_source:
            deleted = _delete_objects_with_prefix(s3_client, bucket_name, f"{root_prefix}/")
            migrated_entry["deleted_source_objects"] = deleted

        migrated.append(migrated_entry)

    return {
        "bucket": bucket_name,
        "dry_run": dry_run,
        "delete_source": delete_source,
        "migrated": migrated,
        "skipped": skipped,
    }


def list_thumbnail_projects(limit=24, force_refresh=False):
    """
    List saved thumbnail studio projects from S3/MinIO.
    Projects are grouped by thumbnail-projects/<session>/<project_slug>/ prefixes.
    """
    bucket_name = os.environ.get("AWS_S3_BUCKET", "").strip() or os.environ.get("AWS_S3_PUBLIC_BUCKET", "").strip()
    if not bucket_name:
        return []

    s3_client = get_s3_client()
    if not s3_client:
        return []

    projects = {}
    try:
        paginator = s3_client.get_paginator("list_objects_v2")
        pages = paginator.paginate(Bucket=bucket_name, Prefix="thumbnail-projects/")

        for page in pages:
            for obj in page.get("Contents", []):
                key = obj["Key"]
                if not key.startswith("thumbnail-projects/"):
                    continue
                parts = key.split("/")
                if len(parts) < 4:
                    continue
                project_prefix = "/".join(parts[:3]) + "/"
                project = projects.setdefault(project_prefix, {
                    "prefix": project_prefix,
                    "bucket": bucket_name,
                    "files": [],
                    "created_at": obj["LastModified"].isoformat(),
                    "title": "",
                    "description": "",
                    "thumbnail_count": 0,
                    "selected_thumbnail": "",
                    "session_id": parts[1],
                    "project_slug": parts[2],
                })
                project["files"].append({
                    "name": "/".join(parts[3:]),
                    "key": key,
                    "size": obj.get("Size", 0),
                    "created_at": obj["LastModified"].isoformat(),
                    "url": generate_presigned_url(bucket_name, key, expiration=604800),
                    "kind": _project_file_kind("/".join(parts[3:])),
                    "editable": _project_file_kind("/".join(parts[3:])) == "text",
                    "deletable": "/".join(parts[3:]) != "manifest.json",
                })

        for project_prefix, project in projects.items():
            manifest_file = next((f for f in project["files"] if f["key"].endswith("/manifest.json")), None)
            if manifest_file:
                try:
                    resp = s3_client.get_object(Bucket=bucket_name, Key=manifest_file["key"])
                    manifest = json.loads(resp["Body"].read().decode("utf-8"))
                    project["title"] = manifest.get("project_title") or manifest.get("title") or project["project_slug"]
                    project["description"] = manifest.get("description", "")
                    project["thumbnail_count"] = len(manifest.get("generated_thumbnails", []))
                    project["selected_thumbnail"] = manifest.get("selected_thumbnail", "")
                    project["created_at"] = manifest.get("created_at", project["created_at"])
                except Exception:
                    project["title"] = project["project_slug"]

            project["files"].sort(key=lambda item: item["name"])
            project["file_count"] = len(project["files"])

        ordered = sorted(projects.values(), key=lambda item: item.get("created_at", ""), reverse=True)
        return ordered[:limit] if limit else ordered
    except Exception as e:
        logger.error(f"Failed to list thumbnail projects: {e}")
        return []


