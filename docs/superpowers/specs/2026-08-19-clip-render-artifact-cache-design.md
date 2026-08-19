# Clip Render Artifact Cache Design

## Problem

Each deferred `clip-render` currently hydrates every parent artifact from MinIO, including the parent’s large source video. After the render, the worker uploads the whole directory and removes it. Consequently, every subsequent clip render can download and upload the same multi-gigabyte source again.

The job API also emits no progress while hydration is running, making a large transfer look stuck at `Job started by worker.`.

## Goals

- Preserve the parent source video in the local job directory across clip renders.
- Avoid downloading an artifact when the corresponding local file already exists.
- Avoid uploading the unchanged source video during a child clip render.
- Continue uploading changed metadata, manifests, metrics, and rendered clip artifacts.
- Remove generated render scratch/artifacts after successful upload without deleting the source.
- Preserve the existing recovery path: a fresh worker can hydrate missing files from MinIO.
- Keep all UI-facing parent/source and rendered-clip URLs MinIO-backed; the local source copy is worker-only.

## Non-goals

- No database schema or API response changes.
- No change to parent-job generation behavior.
- No new cache service or cache eviction policy.
- No change to S3 object naming.

## Design

### Cache-aware hydration

`hydrate_job_artifacts` will keep the existing parent-prefix listing and path-safety checks. Before calling `download_file`, it will check whether the destination is already a regular, non-empty file. Existing files will be reused; missing files will still be downloaded from MinIO. This makes the local parent directory the short-lived working cache while MinIO remains the recovery source of truth.

### Selective child-render upload

The worker will distinguish parent generation from child rendering when publishing artifacts. For `clip-render`, the source path supplied in the request will be excluded from the upload set. All other eligible persisted artifacts continue through the existing validation and upload logic. Parent generation retains its current behavior and still publishes the source artifact.

### UI/cache boundary

The local source file is an internal rendering cache only. API results, persisted metadata, and dashboard-facing video URLs continue to use the existing MinIO object keys or signed MinIO URLs. The dashboard must never receive a container-local path such as `/app/output/<parent-id>/source.mp4`. A child render is considered publishable only after its changed artifacts and metadata have been uploaded to MinIO, so cleanup cannot remove the UI’s source of truth.

### Selective cleanup

The worker will retain the resolved source path when cleaning a successful clip render. Cleanup will remove other files and directories under the job-scoped output directory, subject to the existing job-root safety check, while preserving the source file. The next render therefore has the source locally and can rehydrate only small metadata or missing artifacts. If upload fails or the worker exits unsuccessfully, cleanup will not run, preserving recovery data for diagnosis/retry.

### Observability

The existing worker protocol and API shape remain unchanged. The implementation will keep the current startup log and render logs. Tests will verify the silent hydration behavior functionally; adding a new status field or protocol event is outside this change.

## Data flow

1. Backend creates a `clip-render` job pointing at the parent output directory and source path.
2. Python worker lists the parent’s MinIO prefix.
3. Existing local files are retained; only missing artifacts are downloaded.
4. `main.py` renders the selected clip using the retained source.
5. Worker uploads changed artifacts, excluding the source file for child renders.
6. API metadata and clip URLs continue to point to MinIO objects.
7. Worker removes generated local artifacts while retaining the worker-only source cache.
8. A later render reuses the source and repeats only small-file hydration as needed.

## Tests

- Hydration skips an existing non-empty destination and downloads missing artifacts.
- Child-render upload excludes the request’s source path while parent generation remains unchanged.
- Selective cleanup preserves the source file and removes generated files/directories.
- Existing safety behavior still rejects cleanup outside a job-scoped directory.
- Existing Python worker and S3 uploader tests remain green.

## Rollback

Reverting the worker and uploader changes restores the current full-directory hydration and cleanup behavior. MinIO objects remain compatible because object names and formats are unchanged.
