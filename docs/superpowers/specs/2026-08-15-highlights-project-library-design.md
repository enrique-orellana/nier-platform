# Highlights Project Library Design

## Status

Approved design awaiting user review before implementation planning.

## Goal

Make Highlights a persistent, Highlights-only project workflow. A project represents one source video selected from MinIO and owns its highlight-generation configuration, run history, progress, logs, and generated artifacts. Projects must survive backend restarts and be stored in PostgreSQL.

## Scope

### Included

- A PostgreSQL-backed `highlight_projects` entity.
- Association between a project and the existing Highlights job engine.
- CRUD operations for Highlights projects.
- Project list/detail controls in the existing Highlights dashboard tab.
- Retry and cancellation through the existing job lifecycle.
- PostgreSQL deployment configuration for the local Kubernetes cluster.
- Migration, API, UI, and end-to-end tests.

### Excluded

- Merging with the existing clip-generation/editor Projects library.
- Copying or moving source videos in MinIO.
- A second job queue or a second analysis/rendering implementation.
- Persisting raw AI credentials in project rows, job payloads, or logs.
- Running more than one highlight-generation video at a time.

## User experience

The Highlights tab gains a Projects view containing the user’s Highlights projects. Each project shows:

- name and source object;
- configured minimum and ideal duration;
- current state: draft, queued, processing, completed, failed, or cancelled;
- progress, current stage, and recent logs when a run exists;
- generated highlight download and manifest links when completed.

Project actions:

- Create: choose a MinIO source video, name the project, and set duration preferences. Creation persists the project and starts its first run.
- Edit: change the project name and duration preferences. Source replacement is not part of the first version; a new source creates a new project.
- Retry: start a new run for a failed or cancelled project, subject to the existing one-active-highlight-job rule.
- Cancel: cancel the active run and preserve the project and its previous completed result, if any.
- Delete: cancel an active run first, then remove the project, its associated job data, and generated output files. The original MinIO source is never deleted.

The existing single-run detail, polling, logs, cancellation, and download behavior remains available from the selected project rather than being duplicated.

## Data model

Add a migration for `highlight_projects` with:

- `id UUID PRIMARY KEY`;
- `name TEXT NOT NULL`;
- `source_bucket TEXT NOT NULL`;
- `source_key TEXT NOT NULL`;
- `min_duration_seconds INTEGER NOT NULL`;
- `ideal_duration_seconds INTEGER NOT NULL`;
- `status TEXT NOT NULL`;
- `latest_job_id UUID NULL` referencing `jobs(id)`;
- `created_at TIMESTAMPTZ NOT NULL`;
- `updated_at TIMESTAMPTZ NOT NULL`.

Add a nullable project association to the existing job model/table, constrained to `highlight-generation` jobs. Existing jobs remain valid and continue to work. The project row is the source of truth for project identity and configuration; the linked job remains the source of truth for execution state, logs, result manifest, and errors.

Indexes will support project listing by `updated_at` and lookup by `latest_job_id`. Deleting a project will cascade only its owned highlight job records and not any source object.

## API

Add Highlights project endpoints under `/api/highlights/projects`:

- `POST /api/highlights/projects` — create a project and enqueue its first run.
- `GET /api/highlights/projects` — list projects, newest activity first.
- `GET /api/highlights/projects/{id}` — return project details, linked job state, logs, and result metadata.
- `PATCH /api/highlights/projects/{id}` — update name and duration settings when no run is actively processing.
- `POST /api/highlights/projects/{id}/retry` — enqueue a new run for a failed/cancelled project.
- `POST /api/highlights/projects/{id}/cancel` — cancel its active run.
- `DELETE /api/highlights/projects/{id}` — remove project-owned data and generated outputs without touching MinIO source data.

The existing job status endpoint remains supported for compatibility. New project responses will include the job ID so the current polling/logging mechanisms can be reused during migration of the dashboard.

Validation:

- source bucket and key are required and must identify a MinIO object;
- name is required and bounded to a reasonable UI-safe length;
- minimum duration is at least 12 minutes by default and cannot exceed ideal duration;
- ideal duration defaults to 20 minutes but may be lower for shorter sources;
- AI headers are accepted only for the enqueue request and are never persisted.

## Execution and consistency

Project creation and initial job creation must be transactional in PostgreSQL. If enqueueing cannot complete, the project must not be left as an apparently runnable orphan. Retry uses a new job linked to the same project and updates `latest_job_id` atomically.

The existing atomic active-job guard remains the concurrency boundary: only one Highlights video may be processing at a time. A project can exist while another project is active, but its run remains queued or is rejected with a clear conflict response according to the existing job semantics.

Project status is derived from the linked job and persisted project metadata is updated on lifecycle transitions. The backend continues to emit structured logs for staging, probing, transcription, AI analysis, selection, rendering, and completion/failure.

## PostgreSQL deployment

Add a local-cluster PostgreSQL deployment using:

- a Kubernetes Secret for database name, user, and password;
- a persistent volume claim for PostgreSQL data;
- an internal ClusterIP Service;
- backend `DATABASE_URL` configuration referencing the service and Secret.

The backend’s existing migration-on-start behavior will apply the new migrations. The deployment must not depend on Docker Compose or the stale Windows Kubernetes context; it targets the existing MicroK8s `openshorts` namespace.

## Frontend changes

Extend the existing Highlights tab with a project list/detail state. Reuse the existing AI provider settings and `getAiHeaders` path. Do not create a second settings page or a second polling implementation.

The UI must handle refreshes and backend restarts by reloading the project list from PostgreSQL. Active project details continue polling until a terminal state, with visible stage, recent logs, cancellation, and error information.

## Testing and acceptance

- Migration tests verify fresh database creation and compatibility with existing jobs.
- Store tests cover create, list, update, retry association, cancellation, and deletion semantics.
- API tests cover validation, transactional failure behavior, one-active-job conflicts, and no-source-deletion guarantees.
- Dashboard tests cover project list rendering, create/edit/retry/cancel/delete, polling, and reload persistence.
- End-to-end local-cluster test creates a project from a MinIO object, confirms PostgreSQL persistence after backend restart, runs the existing Codex-backed analysis, downloads the generated video, and verifies deletion leaves the MinIO source intact.
- Existing Highlights job and non-Highlights project workflows must remain green.

## Alternatives rejected

1. Keeping projects only in job metadata: not a real CRUD entity and difficult to query or update safely.
2. Creating a separate project/job engine: duplicates lifecycle, cancellation, logging, and concurrency behavior.
3. Reusing the existing editor Projects table: wrong ownership model and would couple unrelated workflows.
