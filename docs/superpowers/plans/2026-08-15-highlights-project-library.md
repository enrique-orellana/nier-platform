# Highlights Project Library Implementation Plan

> For agentic workers: use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax.

Goal: Build a PostgreSQL-persisted Highlights-only project library that owns source-video settings, highlight runs, logs, cancellation, retries, and generated outputs.

Architecture: Extend the existing Go job store with a HighlightProject model and project-aware job association. PostgreSQL transactions create projects and first jobs atomically; the in-memory store implements the same contract for unit tests. Reuse the existing runner, scheduler, MinIO downloader, AI provider headers, output directory, polling, and cancellation paths.

Tech stack: Go, database/sql with pgx/PostgreSQL, embedded SQL migrations, net/http, React/Vite/Vitest, MinIO/S3, Kubernetes/MicroK8s, PowerShell, and Bash.

---

## File map

Backend:
- Create backend-go/internal/domain/highlight_project.go.
- Modify backend-go/internal/domain/job.go.
- Modify backend-go/internal/jobs/store.go.
- Modify backend-go/internal/jobs/postgres.go.
- Create backend-go/internal/jobs/migrations/002_highlight_projects.sql.
- Create backend-go/internal/jobs/highlight_projects_test.go.
- Modify backend-go/internal/jobs/postgres_test.go.

API:
- Create backend-go/internal/httpapi/highlight_projects.go.
- Modify backend-go/internal/httpapi/server.go and highlights.go.
- Create backend-go/internal/httpapi/highlight_projects_test.go.
- Modify backend-go/internal/httpapi/server_test.go.

Dashboard:
- Create dashboard/src/components/HighlightProjectList.jsx and its test.
- Modify dashboard/src/components/HighlightsTab.jsx and its test.

Deployment:
- Create k8s/openshorts-postgres.yaml.
- Modify scripts/deploy-local.ps1, scripts/deploy-local.sh, k8s/README.md, .env.example, and backend-go/README.md.
- Create tests/test_highlights_postgres_deployment.py.

## Task 1: Define the project domain and store contract

Files:
- Create backend-go/internal/domain/highlight_project.go.
- Modify backend-go/internal/domain/job.go and backend-go/internal/jobs/store.go.
- Test backend-go/internal/jobs/highlight_projects_test.go.

- [ ] Step 1: Add failing in-memory tests.

Test CreateHighlightProject, ListHighlightProjects, RetryHighlightProject, update rejection while active, and DeleteHighlightProject. The creation assertion must verify that project.LatestJobID equals the returned job ID and job.ProjectID equals the project ID. The retry assertion must verify a new queued job retains the same ProjectID.

Run:
    go test ./backend-go/internal/jobs -run 'TestMemoryStore.*HighlightProject' -count=1
Expected: FAIL because the model and methods do not exist.

- [ ] Step 2: Add these exact domain types.

    type HighlightProject struct {
        ID string
        Name string
        SourceBucket string
        SourceKey string
        MinDurationSeconds int
        IdealDurationSeconds int
        LatestJobID string
        CreatedAt time.Time
        UpdatedAt time.Time
    }

    type CreateHighlightProjectInput struct {
        Name string
        SourceBucket string
        SourceKey string
        MinDurationSeconds int
        IdealDurationSeconds int
    }

    type UpdateHighlightProjectInput struct {
        Name string
        MinDurationSeconds int
        IdealDurationSeconds int
    }

Add ProjectID string to domain.CreateJobInput and domain.Job.

Extend jobs.Store with:
    CreateHighlightProject(context.Context, domain.CreateHighlightProjectInput) (domain.HighlightProject, domain.Job, error)
    ListHighlightProjects(context.Context) ([]domain.HighlightProject, error)
    GetHighlightProject(context.Context, string) (domain.HighlightProject, domain.Job, error)
    UpdateHighlightProject(context.Context, string, domain.UpdateHighlightProjectInput) (domain.HighlightProject, error)
    RetryHighlightProject(context.Context, string) (domain.Job, error)
    DeleteHighlightProject(context.Context, string) error

Add ErrProjectNotFound, ErrProjectActive, and ErrProjectNotEditable. Retry must also use the existing global ErrActiveJob guard.

- [ ] Step 3: Implement MemoryStore atomically.

Add a projects map protected by the existing mutex. CreateHighlightProject creates the project and queued highlight-generation job under one lock, sets ProjectID and LatestJobID, and returns both. RetryHighlightProject creates a new job from the project source and duration values, updates LatestJobID, and rejects active jobs. DeleteHighlightProject deletes the project and all associated jobs. Preserve ProjectID in cloneJob. Keep ListByKind unchanged for legacy API compatibility.

- [ ] Step 4: Run and commit.

    go test ./backend-go/internal/jobs -count=1
    git add backend-go/internal/domain/highlight_project.go backend-go/internal/domain/job.go backend-go/internal/jobs/store.go backend-go/internal/jobs/highlight_projects_test.go
    git commit -m "feat(highlights): add project store contract"

## Task 2: Add PostgreSQL migrations and durable store methods

Files:
- Create backend-go/internal/jobs/migrations/002_highlight_projects.sql.
- Modify backend-go/internal/jobs/postgres.go and postgres_test.go.
- Test backend-go/internal/jobs/highlight_projects_test.go.

- [ ] Step 1: Add a TEST_DATABASE_URL durability test.

Open the store, create a uniquely named project, close it, reopen it, fetch the project and linked job, then delete it. Skip only when TEST_DATABASE_URL is absent. Assert that LatestJobID and ProjectID survive reopening.

- [ ] Step 2: Add this idempotent migration.

    CREATE TABLE IF NOT EXISTS highlight_projects (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL,
        source_bucket TEXT NOT NULL,
        source_key TEXT NOT NULL,
        min_duration_seconds INTEGER NOT NULL CHECK (min_duration_seconds >= 1),
        ideal_duration_seconds INTEGER NOT NULL CHECK (ideal_duration_seconds >= min_duration_seconds),
        latest_job_id UUID NULL REFERENCES jobs(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES highlight_projects(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS highlight_projects_updated_at_idx ON highlight_projects (updated_at DESC, id);
    CREATE INDEX IF NOT EXISTS jobs_project_id_idx ON jobs (project_id, created_at DESC, id);

Embed and execute migration 002 after the existing jobs migration. Add project_id to every job SELECT and RETURNING clause and scan it in scanJob. Legacy jobs insert NULL through NULLIF.

- [ ] Step 3: Implement transactional PostgreSQL operations.

CreateHighlightProject acquires pg_advisory_xact_lock(hashtext('highlight-generation')), checks queued/processing highlight jobs, inserts project and job, sets latest_job_id, and commits together.

ListHighlightProjects orders by updated_at DESC, id. GetHighlightProject returns project and its latest job with logs. UpdateHighlightProject locks the project and latest job and rejects active runs. RetryHighlightProject locks the project, takes the same advisory lock, checks the global active-job guard, inserts a new queued job, and updates latest_job_id in one transaction. DeleteHighlightProject deletes the project; the project_id cascade removes owned jobs, logs, and results.

Do not persist AI headers in projects, metadata, or logs.

- [ ] Step 4: Run and commit.

    go test ./backend-go/internal/jobs -count=1
    go test ./backend-go/... -count=1
    git add backend-go/internal/jobs/migrations/002_highlight_projects.sql backend-go/internal/jobs/postgres.go backend-go/internal/jobs/postgres_test.go backend-go/internal/jobs/highlight_projects_test.go
    git commit -m "feat(highlights): persist projects in postgres"

## Task 3: Add project HTTP APIs without breaking legacy endpoints

Files:
- Create backend-go/internal/httpapi/highlight_projects.go and its tests.
- Modify backend-go/internal/httpapi/server.go, highlights.go, and server_test.go.

- [ ] Step 1: Write failing API tests.

Use the existing server constructor and in-memory store. Test:
- POST /api/highlights/projects returns 202 with project_id and job.
- GET list/detail returns source, duration, status, logs, result, and error.
- PATCH updates name/durations only when no active run exists.
- POST retry creates a new linked job after failure.
- POST cancel uses scheduler cancellation.
- DELETE returns 204 and never deletes the MinIO source.
- Invalid acknowledgement/durations return 400.
- An active global highlight job returns 409.
- Existing /api/highlights and /api/status job endpoints retain their current response shape.

Run:
    go test ./backend-go/internal/httpapi -run 'TestHighlightProject|TestHighlights' -count=1
Expected: FAIL.

- [ ] Step 2: Route project paths.

Keep the existing /api/highlights/ handler registration. Branch highlightRoute when the first segment is projects; leave the current job-ID DELETE branch unchanged. Add request decoding with name, source_object, acknowledged, min_minutes, and ideal_minutes. Reuse existing duration validation and translationHeaders. Convert minutes to integer seconds, require an acknowledged source, derive a name from the source key only when blank, and reject missing bucket/key.

- [ ] Step 3: Implement lifecycle behavior.

Implement:
    POST   /api/highlights/projects
    GET    /api/highlights/projects
    GET    /api/highlights/projects/{id}
    PATCH  /api/highlights/projects/{id}
    POST   /api/highlights/projects/{id}/retry
    POST   /api/highlights/projects/{id}/cancel
    DELETE /api/highlights/projects/{id}

Create and retry must set runtime AI headers only in highlightRuntime, set output_dir under the configured output root, append the queued log, and submit through the existing scheduler. Scheduler failure transitions the job to failed and releases runtime metadata. Cancel reuses scheduler.Cancel and releases runtime metadata.

Return project JSON with id, name, source_object, min_minutes, ideal_minutes, latest_job_id, status, job, created_at, and updated_at. Use 400 for validation, 404 for unknown projects, 409 for active/conflicting operations, 202 for create/retry/cancel, and 204 for delete.

- [ ] Step 4: Make deletion safe.

Resolve only the generated output directory. Refuse removal when its cleaned absolute path is the output root or is outside the output root. Delete generated files after the store deletion; never pass a bucket or MinIO key to filesystem removal. Preserve legacy job APIs.

- [ ] Step 5: Run and commit.

    go test ./backend-go/internal/httpapi -run 'TestHighlightProject|TestHighlights' -count=1
    go test ./backend-go/... -count=1
    git add backend-go/internal/httpapi/highlight_projects.go backend-go/internal/httpapi/server.go backend-go/internal/httpapi/highlights.go backend-go/internal/httpapi/highlight_projects_test.go backend-go/internal/httpapi/server_test.go
    git commit -m "feat(highlights): expose project lifecycle api"

## Task 4: Build the Highlights project dashboard

Files:
- Create dashboard/src/components/HighlightProjectList.jsx and HighlightProjectList.test.jsx.
- Modify dashboard/src/components/HighlightsTab.jsx and HighlightsTab.test.jsx.

- [ ] Step 1: Write failing Vitest tests.

Mock MinioObjectPicker as in the existing test. Assert mount calls GET /api/highlights/projects, creation calls POST with name/source/durations/acknowledged and getAiHeaders('json'), active detail polls, retry calls /retry, stop calls /cancel, delete calls DELETE, and successful actions reload the list. Assert the request body has no api_key or raw AI credential.

- [ ] Step 2: Implement HighlightProjectList.

Use state for projects, selectedProject, loading, saving, and error. Add project name beside the existing source picker and duration controls. Render project rows/cards with source key, duration, status, latest log, and actions:
    Open  GET /api/highlights/projects/{id}
    Retry POST /api/highlights/projects/{id}/retry
    Stop  POST /api/highlights/projects/{id}/cancel
    Delete DELETE /api/highlights/projects/{id}

Poll selected project detail while queued or processing. Display logs, error, video, download link, and manifest link. Disable edits during active runs and confirm delete before sending it.

- [ ] Step 3: Integrate into HighlightsTab.

Replace the direct legacy list/create flow with HighlightProjectList while preserving the provider indicator, MinIO picker, 12-minute minimum, 20-minute ideal, live logs, stop control, and result links. Reuse getAiHeaders and getApiUrl; do not add another API client. Keep the legacy endpoint tests in Go.

- [ ] Step 4: Run and commit.

    cd dashboard
    npm test -- --run
    npm run build
    git add src/components/HighlightProjectList.jsx src/components/HighlightProjectList.test.jsx src/components/HighlightsTab.jsx src/components/HighlightsTab.test.jsx
    git commit -m "feat(highlights): add persisted project dashboard"

## Task 5: Add PostgreSQL to the local MicroK8s deployment

Files:
- Create k8s/openshorts-postgres.yaml and tests/test_highlights_postgres_deployment.py.
- Modify scripts/deploy-local.ps1, scripts/deploy-local.sh, k8s/README.md, .env.example, backend-go/README.md.

- [ ] Step 1: Add failing manifest tests.

Parse YAML and assert the PostgreSQL bundle contains PVC openshorts-postgres-data, Deployment openshorts-postgres, and ClusterIP Service openshorts-postgres. Assert the existing backend Deployment reads DATABASE_URL from Secret openshorts-postgres key DATABASE_URL.

- [ ] Step 2: Add the PostgreSQL bundle.

Create a 10Gi ReadWriteOnce PVC, postgres:16-alpine Deployment, and ClusterIP Service on port 5432. The Deployment reads POSTGRES_DB, POSTGRES_USER, and POSTGRES_PASSWORD from Secret openshorts-postgres, mounts the PVC at /var/lib/postgresql/data, and uses pg_isready for readiness. Do not commit credentials.

- [ ] Step 3: Update deployment helpers.

Support OPENSHORTS_POSTGRES_DB, OPENSHORTS_POSTGRES_USER, and OPENSHORTS_POSTGRES_PASSWORD, with local defaults openshorts, openshorts, and openshorts-local. Before applying the application bundle, apply the PostgreSQL manifest, create/update the Secret with the three PostgreSQL values plus DATABASE_URL pointing at service openshorts-postgres, and wait for its rollout. Preserve OPENSHORTS_KUBE_CONTEXT and do not print passwords or full connection URLs.

- [ ] Step 4: Document and verify.

Document the PVC, Secret, DATABASE_URL behavior, MinIO source preservation, and:
    kubectl -n openshorts get pod,svc,pvc openshorts-postgres
    kubectl -n openshorts logs deployment/openshorts-backend --tail=100
    kubectl -n openshorts get secret openshorts-postgres

State that DATABASE_URL enables durable Highlights projects and absent configuration intentionally uses in-memory development storage.

- [ ] Step 5: Run and commit.

    python -m pytest tests/test_highlights_postgres_deployment.py tests/test_codex_auth_deployment.py -q
    git add k8s/openshorts-postgres.yaml scripts/deploy-local.ps1 scripts/deploy-local.sh k8s/README.md .env.example backend-go/README.md tests/test_highlights_postgres_deployment.py
    git commit -m "deploy: add postgres for highlights projects"

## Task 6: Verify the full feature and cluster behavior

- [ ] Step 1: Run:
    go test ./backend-go/... -count=1
    cd dashboard; npm test -- --run; npm run build; cd ..
    python -m pytest -q

Record the known unrelated translation image expectation separately if it remains; do not change unrelated translation behavior.

- [ ] Step 2: Deploy to the existing MicroK8s cluster:
    .\scripts\deploy-local.ps1
    kubectl -n openshorts rollout status deployment/openshorts-postgres --timeout=180s
    kubectl -n openshorts rollout status deployment/openshorts-backend --timeout=180s
    kubectl -n openshorts rollout status deployment/openshorts-frontend --timeout=180s

Verify backend logs no longer report DATABASE_URL is not configured.

- [ ] Step 3: Use Codex headers and a known MinIO source to create a project. Poll detail until completion, restart only the backend, fetch the same project again, and verify status/logs/latest job ID persisted. While one run is active, verify another retry returns 409. Cancel an active run and verify 202.

- [ ] Step 4: Verify completed MP4 and manifest downloads return 200, delete the project, confirm generated output and project/job rows are removed, and confirm the original MinIO object remains.

- [ ] Step 5: Run git status --short and git diff --check. Confirm no credentials are tracked and the worktree is clean.

## Self-review

Tasks 1–2 cover model, migrations, project/job links, logs, results, retries, and PostgreSQL durability. Task 3 covers CRUD, validation, cancellation, safe output cleanup, and legacy compatibility. Task 4 covers the Highlights-only UI and reload persistence. Task 5 covers local MicroK8s PostgreSQL and Secret handling. Task 6 covers tests, restart persistence, Codex completion, and source preservation.
