# Local MinIO Video URL Ingestion

## Goal

Replace the Clip Generator's YouTube URL ingestion with direct HTTP(S) video URL ingestion for local MinIO objects, while retaining local file upload support.

## User experience

- The URL mode is labeled `Local MinIO URL`, not `YouTube URL`.
- The input accepts a direct MinIO object URL, including presigned URLs.
- The placeholder and helper text explain that the URL must be reachable by the OpenShorts backend.
- The file-upload mode, rights acknowledgment, target clip count, and processing states remain unchanged.

## Backend behavior

- `/api/process` continues to accept a URL or uploaded file, but URL ingestion now means a direct `http://` or `https://` media URL.
- The queued worker downloads the URL to the job output directory before running the existing clip-generation pipeline.
- The download is streamed in chunks, follows redirects, times out, and enforces the existing 500 MB upload/download limit without buffering the complete object in memory.
- The destination filename comes from the URL path when safe, with an `.mp4` fallback when the URL is presigned or has no useful filename.
- `localhost` and loopback hostnames in the submitted URL are rewritten to the configured `AWS_S3_ENDPOINT_URL` host when that setting is present, preserving the object path and query string. This allows browser-facing local URLs to work when the backend runs in Docker or Kubernetes.
- Invalid schemes, unreachable objects, HTTP errors, and oversized downloads produce clear job errors.
- `yt-dlp`, its URL-specific helper, cookie handling, and YouTube-only error messaging are removed from the implementation and no longer used by the application.

## Testing

- Backend unit tests cover URL normalization, localhost endpoint replacement, direct streaming download, HTTP failures, and the size limit.
- API tests cover accepting a MinIO URL and rejecting a non-HTTP(S) URL.
- Frontend tests cover the new label, placeholder, and submission payload.
- Existing Python and dashboard test suites must continue to pass.

## Scope boundaries

- No S3 authentication/signing is added; private objects must be supplied as reachable presigned URLs or otherwise publicly readable URLs.
- No YouTube replacement or video-platform extraction is supported in this iteration.
- No changes are made to the clip analysis, rendering, or result-storage pipeline beyond receiving a downloaded local source file.
