# MinIO Source Object Picker

## Goal

Replace the Clip Generator's manually pasted video URL with a searchable picker backed by the `youtube-downloads` MinIO bucket. The user selects any object from that bucket, while OpenShorts keeps the source reference as a bucket/key pair and uses only a temporary local copy for processing.

## Approved scope

- Remove the manual URL input from the Clip Generator.
- Limit the picker to the `youtube-downloads` bucket.
- List every object in that bucket, regardless of filename extension.
- Search objects by key/name on the backend and/or frontend.
- Submit only the selected bucket and object key to the backend.
- Validate that the selected object is a readable video when processing starts.
- Download the selected object to a temporary working directory.
- Delete the temporary source after success or failure.
- Upload only generated clips and metadata to the output bucket.
- Preserve the original MinIO bucket/key in job metadata and manifests for future rerenders.

## Architecture

The backend owns all MinIO access. The browser never receives S3 credentials, Console URLs, or presigned URLs for this workflow.

The dashboard calls a new read-only endpoint such as `GET /api/minio/objects` with an optional search query. The backend uses the existing S3 client configuration and credentials to list objects from `youtube-downloads`, returning safe metadata: key, basename, size, and last-modified timestamp.

When the user submits a selection, `/api/process` accepts a source object containing `bucket` and `key`. The API verifies that the bucket is the configured allowlisted source bucket, validates the key, and queues the job. The worker downloads the object to a job-scoped temporary directory, then invokes the existing processing pipeline with that local path.

The downloaded source must not be placed in `output/<job-id>` and must not be included by `upload_job_artifacts()`. Generated clips, metadata, metrics, and manifests continue to be stored in the job output directory and uploaded to the output bucket.

## API contract

### List source objects

`GET /api/minio/objects?search=<text>&limit=<n>&continuation_token=<token>`

Response:

```json
{
  "bucket": "youtube-downloads",
  "objects": [
    {
      "key": "videos/channel/source.mp4",
      "name": "source.mp4",
      "size": 123456789,
      "last_modified": "2026-08-13T09:25:04Z"
    }
  ],
  "next_continuation_token": null
}
```

The endpoint must never return access keys, secret keys, presigned URLs, or Console URLs. Pagination must be supported so a large bucket does not require loading every object into memory. Search is restricted to the object key/name and must not alter the bucket or prefix outside the allowlisted source bucket.

### Process selected object

The JSON request to `/api/process` becomes:

```json
{
  "source_object": {
    "bucket": "youtube-downloads",
    "key": "videos/channel/source.mp4"
  },
  "acknowledged": true,
  "clip_count": 6
}
```

The existing multipart file-upload path remains available. The old URL payload is removed from the Clip Generator contract; legacy CLI `--url` support remains unchanged.

## Source lifecycle

1. Validate bucket and key against the allowlist.
2. Create a job-scoped temporary directory outside the output artifact directory.
3. Stream the object from MinIO to a temporary file with a size limit.
4. Probe the temporary file with ffprobe and reject non-video or unreadable objects with a user-facing error.
5. Process the temporary file using the existing analysis and clip rendering code.
6. Record `{provider: "minio", bucket, key}` in source metadata and manifests.
7. Upload only validated clips and metadata to the output bucket.
8. Remove the temporary directory in a `finally` block, including failed jobs and cancelled jobs where cleanup is possible.

The source object in `youtube-downloads` is never copied to the output bucket. It remains the canonical original and can be downloaded again for a future rerender.

## UI behavior

The Clip Generator source area contains:

- a “Select from MinIO” control;
- a search field;
- a loading state;
- an empty state;
- an error state for unavailable MinIO;
- a scrollable result list showing object name, key, size, and modified time;
- a selected-object summary;
- the existing rights acknowledgement and clip-count controls;
- the existing “Generate clips” action.

The UI must not show the MinIO Console hostname or presigned URLs. The submit button remains disabled until an object is selected and the acknowledgement is checked.

## Error handling and security

- If MinIO is unavailable, return HTTP 503 with a stable error message and keep the picker usable for retry.
- If the selected key no longer exists, return HTTP 404 and ask the user to refresh the list.
- If the object is not a readable video, return HTTP 422 and identify that the selected object cannot be processed as video.
- Enforce the configured maximum source size while streaming.
- Allow only the configured source bucket; reject arbitrary bucket names from clients.
- Treat object keys as data, not filesystem paths. Use a generated local filename and never concatenate an object key into an unsanitized local path.
- Do not log presigned URLs or credentials. Logs may include a redacted bucket/key reference.

## Compatibility

- Existing local file uploads remain supported.
- Existing legacy CLI `--url`/yt-dlp behavior remains supported.
- Existing output URLs, S3 clip uploads, project history, and rerender APIs continue to work.
- Existing source manifests gain a MinIO source reference but retain local relative paths when a local source is available for the lifetime of a job.

## Testing requirements

- Backend unit tests for listing, search, pagination, bucket allowlisting, and safe response fields.
- Backend tests for `/api/process` accepting a source object and rejecting arbitrary buckets or invalid keys.
- Downloader tests for streaming an S3 object to a temporary file, enforcing size limits, and cleaning up on success/failure.
- Tests proving `upload_job_artifacts()` does not upload the downloaded source.
- Frontend tests for loading, searching, selecting, empty/error states, acknowledgement, and the submitted `{bucket, key}` payload.
- Regression tests proving the old manual URL UI is absent while file upload and legacy CLI URL support remain.
- Full Python and dashboard test suites plus a local Kubernetes smoke test using the existing MinIO service.

## Non-goals

- Browsing arbitrary MinIO buckets.
- Editing, deleting, moving, or uploading source objects from OpenShorts.
- Exposing the MinIO Console inside the dashboard.
- Changing the existing FFmpeg/Remotion output policy.
