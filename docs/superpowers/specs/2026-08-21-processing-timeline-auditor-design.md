# Processing Timeline Auditor Design

**Date:** 2026-08-21  
**Status:** Approved for implementation

## Goal

Add a clock-icon auditor to project detail pages that shows the ordered processing stages and external requests for processing runs that start after the feature is deployed, with durable PostgreSQL persistence and complete redacted request/response bodies for allowlisted hosts.

## Product behavior

The project detail header gains a clock/time icon beside the existing project summary cards. The icon shows the current audit state and event count. Clicking it opens a right-side drawer without navigating away from the project.

The drawer renders a vertical, color-coded timeline. Each event shows its name, provider or host, status, duration, timestamp, HTTP status when applicable, byte counts, and safe detail/error text. Events with captured bodies have expandable request and response panels. Events whose hosts are not allowlisted show metadata only and explain that body capture was disabled for that host.

The drawer polls while the job is queued or processing and stops when the job reaches a terminal state. A project with no audit events shows an empty state explaining that auditing begins with the next processing run. Existing projects are not backfilled.

## Architecture

The existing Go job store remains the source of truth. Add a dedicated `job_audit_events` table rather than overloading human-readable `job_logs` or storing a mutable JSON document in job metadata.

The Go↔Python worker protocol gains structured `audit` messages. Go persists events and owns the public API. Python emits stage and external-request events from the video-processing pipeline. Go-side adapters emit events for source acquisition, artifact hydration/upload, worker lifecycle, and other external operations performed outside Python.

Each operation is represented by one event row. A start event creates the row; a completion or failure event finalizes it with end time, duration, status, response metadata, and safe details. If the worker exits unexpectedly, the started event remains visible as unresolved rather than being silently dropped.

## Persistence model

Create a migration for `job_audit_events` with:

- `id` as the event identifier.
- `job_id` referencing `jobs(id)` with cascade deletion.
- Per-job ordered `sequence`.
- `category` (`stage` or `external_request`).
- Stable `name` such as `source.download`, `transcription.request`, `ai.analysis`, `clip.render`, or `artifact.upload`.
- `status` (`started`, `completed`, `failed`, or `unknown`).
- `provider`, normalized `host`, sanitized `path`, HTTP method, HTTP status, and byte counts where available.
- `started_at`, `finished_at`, and `duration_ms`.
- Safe `detail` and `error` text.
- `request_body`, `response_body`, and their content types for allowlisted hosts after redaction.
- `body_capture_mode` (`full_redacted` or `metadata_only`).
- JSONB metadata for structured, non-secret fields.

Index by `(job_id, sequence)` and `(job_id, started_at)`. Add matching domain types and store methods for the memory and PostgreSQL stores: start an event, finish an event, and list events in order.

## Body capture and redaction policy

Body capture is controlled by `AUDIT_BODY_HOST_ALLOWLIST`. Host matching uses normalized hostnames, not substring matching. Defaults include:

- `chatgpt.com`
- `openrouter.ai`
- `generativelanguage.googleapis.com`
- The normalized host of the configured S3 endpoint

Allowlisted hosts store complete redacted textual/JSON request and response bodies without truncation. Non-allowlisted hosts store metadata only: method, host/path, HTTP status, duration, byte counts, and checksum where available. Binary video/audio transfers remain metadata-only unless a future explicit binary-storage policy is added.

Redaction runs before persistence. JSON fields matching `token`, `secret`, `password`, `api_key`, `authorization`, `cookie`, and signed-URL fields are replaced. Text bodies redact bearer/API-key patterns and sensitive URL query values. Authorization headers and credentials are never persisted separately or embedded in event metadata.

Audit persistence errors are non-fatal: they are reported through normal server logging while video processing continues and the job result remains authoritative.

## Protocol and API

Extend the worker protocol event with an `audit` type carrying the event identifier, phase (`start` or `finish`), category, name, provider/host/path, method, status, timestamps, HTTP metadata, safe detail/error, body capture mode, and redacted bodies when allowed.

Add `GET /api/projects/{job_id}/audit`. It returns the job’s ordered audit events and the effective body-capture policy. It returns an empty event list for a valid project before its next processing run. It never performs redaction at read time; capture-time redaction is the safety boundary.

## Processing coverage

The initial implementation covers the video processing path, including:

1. Job queued and worker started.
2. Source URL, S3, or persisted-artifact acquisition.
3. Remote transcription requests.
4. AI analysis and Codex/OpenRouter/Gemini requests.
5. Clip planning, scene/face/layout analysis, and rendering stages.
6. Artifact upload and cleanup.
7. Worker completion, failure, cancellation, and unresolved termination.

## Testing and verification

Add tests for:

- Migration and event persistence/order in PostgreSQL and memory stores.
- Start/finish/failure lifecycle and unresolved worker termination.
- Protocol decoding and Go persistence of audit messages.
- Host allowlist matching, default hosts, redaction, and metadata-only behavior.
- Audit API ordering, empty state, and body capture fields.
- Project detail clock icon, drawer, timeline states, body expansion, polling, terminal stop, and failure/empty states.

Run Go tests, Python tests, dashboard tests, `npm run format`, `npm run format:check`, and `npm run lint` from `dashboard` before implementation handoff.
