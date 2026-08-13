# Go Control Plane Migration Design

## Goal

Introduce a Go control plane for OpenShorts without rewriting the Python media and machine-learning pipeline or the TypeScript Remotion renderer. Preserve the existing dashboard API and artifact URL contracts while making job state durable and service boundaries explicit.

## Scope

This migration covers the backend control plane currently concentrated in `app.py`:

- HTTP routing and request validation
- job submission, status, logs, retries, cleanup, and recovery
- project history, clip statuses, manifests, and immutable clip versions
- S3/MinIO storage and artifact metadata
- render and translation service proxies
- social publishing orchestration
- health and configuration endpoints

The following remain in their current languages:

- Python media and ML processing: `main.py`, `video_analysis.py`, `crop_track.py`, `subtitles.py`, `saasshorts.py`, `thumbnail.py`, `ai_client.py`, and related modules
- React dashboard/editor: `dashboard/src/**`
- Remotion renderer: `render-service/**` and `remotion/**`

## Architecture

```text
React dashboard/editor
        |
        v
Go API/control plane  <----> PostgreSQL
        |                         |
        |                         v
        |                    durable job state
        |
        +----> Python media/ML worker
        +----> TypeScript Remotion renderer
        +----> Python translation worker (temporary)
        +----> S3/MinIO
        +----> social/AI provider adapters
```

The Go service is the system of record for job state. Large media artifacts remain in S3/MinIO, while the local filesystem is treated as worker scratch space and a compatibility surface during the transition.

The first implementation keeps the existing frontend routes and response shapes. The Go API delegates media processing to the existing Python entry points instead of translating media algorithms. Later work can replace subprocess delegation with a worker protocol without changing the public API.

## Go component layout

```text
go-control-plane/
  cmd/
    api/main.go                 HTTP server
    worker/main.go              job worker process
  internal/
    config/                     environment and runtime settings
    http/                       route registration, middleware, handlers
      ai/
      clips/
      gallery/
      jobs/
      projects/
      publishing/
      thumbnails/
    jobs/                       lifecycle service, queue, retry, recovery
    domain/                     job, clip, project, manifest, version types
    manifests/                  canonicalization, revisions, asset checks
    versions/                   immutable version storage and promotion
    storage/                    filesystem and S3/MinIO implementations
    workers/                    Python and renderer adapters
    publishing/                 Upload-Post and provider interfaces
    renderproxy/                Remotion HTTP client
    translationproxy/           translation HTTP client
  migrations/                   PostgreSQL schema migrations
  go.mod
```

Each package should expose interfaces at the boundary and keep provider-specific code behind adapters. HTTP handlers should translate requests into domain commands and should not directly shell out, manipulate S3, or edit JSON sidecars.

## Responsibility mapping

| Existing area | Target owner | Migration behavior |
|---|---|---|
| FastAPI route definitions in `app.py` | `internal/http/**` | Preserve paths, methods, headers, and JSON shapes |
| `jobs`, `publish_jobs`, `saas_jobs` maps | `internal/jobs` + PostgreSQL | Replace process memory with durable records |
| `asyncio.Queue` and semaphore | `internal/jobs` worker scheduler | Bounded concurrency with retryable states |
| `s3_uploader.py` | `internal/storage/s3` | Preserve existing bucket/key conventions |
| `version_store.py` | `internal/versions` | Preserve UUIDs, parent links, revisions, and statuses |
| `render_manifest.py` | `internal/manifests` | Preserve canonical SHA-256 revision behavior |
| `main.py` subprocess | `internal/workers/python` | Delegate initially; capture logs and exit status |
| `render-service` | `internal/renderproxy` | Continue calling HTTP endpoint on port 3100 |
| `translation_service.py` | `internal/translationproxy` | Continue calling HTTP endpoint on port 3200 |
| `dashboard/src/**` | React/JSX | No initial frontend rewrite |
| `render-service/**`, `remotion/**` | TypeScript/TSX | No initial renderer rewrite |
| Kubernetes manifests | Kubernetes/YAML | Add Go API/worker deployments incrementally |

## Data model

The first database schema should include:

- `jobs`: id, kind, status, source metadata, output directory, timestamps, retry count, error
- `job_logs`: job id, sequence, timestamp, level, message
- `job_results`: job id, result JSON, artifact prefix
- `projects`: project/job identity and summary metadata
- `clip_statuses`: project id, clip index, workflow status
- `clip_versions`: project id, clip index, version id, parent id, manifest revision, status, output URL
- `publish_jobs`: provider request status and provider response JSON
- `translation_jobs`: request, status, result, and error

JSON fields are intentional for compatibility with the current flexible metadata. Stable fields needed for filtering, recovery, and ownership remain typed columns.

## Job flow

1. The Go API validates the request and records the legal attestation.
2. The API creates a queued job in PostgreSQL and returns the existing `job_id` response.
3. A Go worker claims the job with a lease.
4. The Python adapter starts the existing media command with a job-scoped output directory.
5. Worker stdout/stderr is appended to `job_logs`; partial metadata is read only through a compatibility reader.
6. On completion, artifacts are uploaded or verified in S3/MinIO and the result is persisted.
7. `/api/status/{job_id}` reads from PostgreSQL and returns the existing response shape.
8. Leases allow another worker to recover jobs after process or pod failure.

## Compatibility requirements

- Keep all existing `/api/**` paths during the migration.
- Keep `/videos/{job_id}/{filename}` and related static URL behavior.
- Keep manifest revision calculation compatible with existing JSON files.
- Keep S3/MinIO key layouts compatible with existing data.
- Keep frontend AI headers such as `X-AI-Provider` and `X-AI-Model`.
- Do not require a dashboard rewrite for the first Go milestone.
- Run the existing Python, dashboard, and renderer tests before and after each migration slice.

## Error handling

- Validation failures return the existing 4xx status and error shape.
- Provider failures are recorded with a safe user-facing message and detailed worker logs.
- Worker processes have timeouts, cancellation, exit-code handling, and retry limits.
- Job transitions are explicit: `queued -> processing -> completed|failed`, with `cancelled` and `retrying` reserved for the durable scheduler.
- Artifact publication happens before marking a job completed.
- A job is never reported completed only because the subprocess exited successfully; validated metadata and media artifacts are required.

## Testing strategy

- Contract tests compare Go responses against existing FastAPI fixtures.
- Unit tests cover job state transitions, leases, retries, manifest revisions, version branching, path safety, and S3 key generation.
- Worker adapter tests use a fake process runner and verify command, environment, logs, timeout, and failure behavior.
- Integration tests run Go API plus a fake Python worker and fake storage.
- Existing Python/dashboard/renderer suites remain required regression gates.
- Shadow mode may mirror read-only requests to Go before traffic is switched.

## Migration sequence

1. Add Go module, shared API contracts, health endpoint, and build/test tooling.
2. Add PostgreSQL schema and job repository.
3. Add Python worker adapter and implement `/api/process` plus `/api/status` behind a feature flag.
4. Add artifact and project read paths while preserving current S3 layouts.
5. Add manifests, versions, and clip-status endpoints.
6. Add render/translation proxies and publishing adapters.
7. Switch Kubernetes traffic to Go API and worker deployments.
8. Retire the corresponding FastAPI route code only after contract and production soak validation.

## Non-goals

- Rewriting Whisper, YOLO, MediaPipe, OpenCV, or FFmpeg algorithms in Go
- Rewriting the React dashboard
- Replacing Remotion with a Go renderer
- Changing public API contracts during the initial migration
- Introducing microservices for every existing Python module

