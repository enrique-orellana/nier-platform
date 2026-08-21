# Processing Timeline Auditor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Persist a structured, redacted audit timeline for future video-processing runs and expose it through a clock-icon drawer in project detail.

**Architecture:** Extend the Go job store with a dedicated \`job_audit_events\` table and ordered lifecycle methods. Add structured audit messages to the Go↔Python worker protocol; Go persists them while Python emits stage/request events after applying the host allowlist and redaction policy. Add one project audit endpoint and render its event stream in \`ProjectLibrary\`.

**Tech Stack:** Go, PostgreSQL, Python/httpx, React, Vitest, Testing Library, Vite, Docker Compose.

---

## File map

- Create \`backend-go/internal/jobs/migrations/005_job_audit_events.sql\`.
- Create \`backend-go/internal/audit/policy.go\` and \`policy_test.go\`.
- Create \`audit_capture.py\` and \`tests/test_audit_capture.py\`.
- Modify \`backend-go/internal/domain/job.go\`, \`jobs/store.go\`, \`jobs/postgres.go\`, and \`jobs/runner.go\`.
- Modify \`backend-go/internal/workers/protocol.go\`, \`config/config.go\`, and \`cmd/api/main.go\`.
- Modify \`backend-go/internal/httpapi/server.go\`, \`project_handlers.go\`, and their tests.
- Modify \`python_worker.py\`, \`main.py\`, \`ai_client.py\`, \`s3_uploader.py\`, and \`minio_sources.py\`.
- Modify \`dashboard/src/components/ProjectLibrary.jsx\` and \`ProjectLibrary.test.jsx\`.

### Task 1: Add durable audit-event storage

**Files:** create \`backend-go/internal/jobs/migrations/005_job_audit_events.sql\`; modify \`backend-go/internal/domain/job.go\`, \`backend-go/internal/jobs/store.go\`, \`backend-go/internal/jobs/postgres.go\`; test \`backend-go/internal/jobs/store_test.go\` and \`postgres_test.go\`.

- [ ] **Step 1: Write the failing memory-store test.** Create a job, start an \`external_request/ai.analysis\` event with a redacted request body, finish it with status \`completed\`, response body, HTTP 200, and duration, then assert \`ListAuditEvents\` returns sequence 1 and both bodies.
- [ ] **Step 2: Run RED.**

~~~powershell
cd backend-go
go test ./internal/jobs -run 'TestMemoryStore.*AuditEvent' -count=1
~~~

Expected: compile failure because the audit types/methods do not exist.
- [ ] **Step 3: Add domain types and store methods.** Add \`AuditEventStatus\` constants (\`started\`, \`completed\`, \`failed\`, \`unknown\`), \`JobAuditEvent\`, \`StartAuditEventInput\`, and \`FinishAuditEventInput\`. Include ID, job ID, sequence, category, name, status, provider/host/path, method/HTTP status, byte counts, start/end/duration, safe detail/error, request/response bodies/content types, capture mode, and JSON metadata. Add \`StartAuditEvent\`, \`FinishAuditEvent\`, and \`ListAuditEvents\` to \`jobs.Store\`.
- [ ] **Step 4: Implement the memory store.** Maintain ordered per-job events and an ID index under the existing mutex, copy maps on reads/writes, and return \`ErrJobNotFound\` for unknown jobs.
- [ ] **Step 5: Run GREEN.** Run the Step 2 command; expected PASS.
- [ ] **Step 6: Add PostgreSQL support.** Create \`job_audit_events\` with UUID ID, \`job_id UUID REFERENCES jobs(id) ON DELETE CASCADE\`, per-job sequence, the domain fields, TEXT bodies, JSONB metadata, and indexes on \`(job_id, sequence)\` and \`(job_id, started_at)\`. Embed/run it from \`PostgresStore.Migrate\`; allocate sequences in a transaction while locking the job row.
- [ ] **Step 7: Test reopen persistence.** Extend \`postgres_test.go\` to start/finish, close/reopen, and assert body, sequence, status, and duration survive. Run \`cd backend-go; go test ./internal/jobs -count=1\`.
- [ ] **Step 8: Commit only this slice.**

~~~powershell
git add backend-go/internal/domain/job.go backend-go/internal/jobs/store.go backend-go/internal/jobs/postgres.go backend-go/internal/jobs/migrations/005_job_audit_events.sql backend-go/internal/jobs/store_test.go backend-go/internal/jobs/postgres_test.go
git commit -m "feat: persist job audit events"
~~~

### Task 2: Implement the allowlist and redaction policy

**Files:** modify \`backend-go/internal/config/config.go\`; create \`backend-go/internal/audit/policy.go\`, \`policy_test.go\`, \`audit_capture.py\`, and \`tests/test_audit_capture.py\`.

- [ ] **Step 1: Write failing tests.** Test \`AUDIT_BODY_HOST_ALLOWLIST=chatgpt.com,OPENROUTER.AI\` normalizes to lowercase, matches ChatGPT but not \`evilchatgpt.com\`, and adds the configured S3 endpoint host. Test Python redaction replaces \`token\`, \`secret\`, \`password\`, \`api_key\`, \`authorization\`, \`cookie\`, and signed-URL fields while preserving the complete non-secret body; non-allowlisted hosts must be metadata-only.
- [ ] **Step 2: Run RED.**

~~~powershell
cd backend-go
go test ./internal/audit -count=1
python -m pytest tests/test_audit_capture.py -q
~~~

Expected: missing package/module or assertion failures.
- [ ] **Step 3: Implement policy.** Parse the comma-separated variable in \`config.Load\`, normalize with URL parsing, append the configured S3 host, and match exact hostnames only. Implement JSON-key redaction plus bearer/API-key and sensitive-query redaction for text. Return complete redacted bodies for allowlisted hosts and metadata-only capture otherwise.
- [ ] **Step 4: Run GREEN.** Repeat Step 2; expected PASS.
- [ ] **Step 5: Commit only this slice.**

~~~powershell
git add backend-go/internal/config/config.go backend-go/internal/audit/policy.go backend-go/internal/audit/policy_test.go audit_capture.py tests/test_audit_capture.py
git commit -m "feat: add audit body allowlist and redaction"
~~~

### Task 3: Connect Go lifecycle and worker protocol events

**Files:** modify \`backend-go/internal/jobs/runner.go\`, \`backend-go/internal/workers/protocol.go\`, \`backend-go/internal/workers/protocol_test.go\`, \`backend-go/internal/jobs/runner_test.go\`, and \`backend-go/cmd/api/main.go\`.

- [ ] **Step 1: Write failing lifecycle tests.** Assert \`Runner.RunOnce\` creates \`job.queued\`, \`worker.started\`, and \`worker.completed\`; worker errors create a failed event; cancellation leaves an unresolved/unknown event and still marks the job cancelled.
- [ ] **Step 2: Write the failing protocol test.** Have a fake runner emit:

~~~json
{"id":"job-1","type":"audit","audit":{"phase":"start","event_id":"event-1","category":"external_request","name":"ai.analysis","host":"openrouter.ai","method":"POST"}}
{"id":"job-1","type":"audit","audit":{"phase":"finish","event_id":"event-1","status":"completed","http_status":200,"response_body":"{\"ok\":true}"}}
~~~

Assert \`PythonWorkerAdapter\` forwards both messages to an injected audit sink and still returns the result.
- [ ] **Step 3: Run RED.**

~~~powershell
cd backend-go
go test ./internal/jobs ./internal/workers -run 'Audit|Worker' -count=1
~~~

Expected: missing protocol fields/callback/lifecycle assertions.
- [ ] **Step 4: Implement.** Extend \`ProtocolEvent\` with \`Audit json.RawMessage\`; decode start/finish payloads into domain inputs and call the sink with job ID. Make \`Runner\` create lifecycle events. Treat persistence failure as loggable/non-fatal, but report malformed audit data.
- [ ] **Step 5: Wire startup.** At the \`PythonWorkerAdapter\` construction in \`cmd/api/main.go\`, inject a callback calling \`StartAuditEvent\`/\`FinishAuditEvent\`, and pass only the normalized policy to the worker environment.
- [ ] **Step 6: Run GREEN.** Run \`cd backend-go; go test ./internal/jobs ./internal/workers -count=1\`; expected PASS.
- [ ] **Step 7: Commit only this slice.**

~~~powershell
git add backend-go/internal/jobs/runner.go backend-go/internal/jobs/runner_test.go backend-go/internal/workers/protocol.go backend-go/internal/workers/protocol_test.go backend-go/cmd/api/main.go
git commit -m "feat: persist worker audit events"
~~~

### Task 4: Emit video stages and external-request events

**Files:** modify \`python_worker.py\`, \`main.py\`, \`ai_client.py\`, \`s3_uploader.py\`, \`minio_sources.py\`; test \`tests/test_python_worker_audit.py\`, \`tests/test_ai_client_codex.py\`, \`tests/test_main_generation_pipeline.py\`, and \`tests/test_video_download.py\`.

- [ ] **Step 1: Write failing integration tests.** A fake allowlisted HTTP response must produce start/finish events with normalized host, method, HTTP status, duration, full redacted request/response bodies. A non-allowlisted request must retain status/bytes but no bodies. A pipeline test must see ordered \`source.download\`, \`transcription.request\`, \`ai.analysis\`, \`clip.render\`, \`artifact.upload\`, and \`scratch.cleanup\`.
- [ ] **Step 2: Run RED.**

~~~powershell
python -m pytest tests/test_python_worker_audit.py tests/test_ai_client_codex.py tests/test_main_generation_pipeline.py -q
~~~

Expected: missing emitter/capture behavior or failed assertions.
- [ ] **Step 3: Add the emitter.** \`audit_capture.py\` writes one JSON line with \`type: audit\`, event ID, and start/finish phase. \`python_worker.py\` recognizes child audit lines and forwards them as protocol audit events instead of normal logs.
- [ ] **Step 4: Instrument boundaries.** Wrap source acquisition, remote transcription, AI completion/streaming, clip planning, render subprocess, artifact upload, and cleanup. Capture URL/status/duration and bodies only for allowlisted hosts; never capture binary video/audio bodies.
- [ ] **Step 5: Run GREEN.** Repeat Step 2; expected PASS.
- [ ] **Step 6: Commit only this slice.**

~~~powershell
git add python_worker.py main.py ai_client.py s3_uploader.py minio_sources.py tests/test_python_worker_audit.py tests/test_ai_client_codex.py tests/test_main_generation_pipeline.py tests/test_video_download.py
git commit -m "feat: emit video processing audit events"
~~~

### Task 5: Add the project audit API

**Files:** modify \`backend-go/internal/httpapi/server.go\`, \`project_handlers.go\`; test \`backend-go/internal/httpapi/server_test.go\`.

- [ ] **Step 1: Write failing endpoint tests.** Assert \`GET /api/projects/job-audit/audit\` returns ordered events, complete bodies for \`full_redacted\`, metadata-only fields for \`metadata_only\`, an empty list for a valid job without events, 404 for a missing job, and 405 for non-GET.
- [ ] **Step 2: Run RED.**

~~~powershell
cd backend-go
go test ./internal/httpapi -run 'Audit' -count=1
~~~

Expected: missing-route failure.
- [ ] **Step 3: Implement and register.** Add the \`GET /api/projects/{job_id}/audit\` branch in \`projectRoutes\`, call \`ListAuditEvents\`, and return \`job_id\`, effective allowlist policy, and sequence-ordered \`events\`. Do not redact in the handler.
- [ ] **Step 4: Run GREEN.** Repeat Step 2; expected PASS.
- [ ] **Step 5: Commit only this slice.**

~~~powershell
git add backend-go/internal/httpapi/server.go backend-go/internal/httpapi/project_handlers.go backend-go/internal/httpapi/server_test.go
git commit -m "feat: expose project audit timeline"
~~~

### Task 6: Add the project-detail clock icon and drawer

**Files:** modify \`dashboard/src/components/ProjectLibrary.jsx\` and \`dashboard/src/components/ProjectLibrary.test.jsx\`.

- [ ] **Step 1: Write failing component tests.** Mock \`GET /api/projects/job-audit/audit\`; assert an accessible \`Processing audit\` clock button and count, drawer open/close, timeline names/statuses, expandable full bodies, metadata-only explanation, empty next-run state, polling while processing, and polling stop after completion.
- [ ] **Step 2: Run RED.**

~~~powershell
cd dashboard
npm test -- --run src/components/ProjectLibrary.test.jsx
~~~

Expected: missing button/drawer or fetch assertions.
- [ ] **Step 3: Add state and polling.** Add \`auditOpen\`, \`auditEvents\`, \`auditPolicy\`, \`auditError\`, and loading state. Fetch \`/api/projects/\${jobId}/audit\` on selection/open. Poll every 2 seconds only while queued/processing; clear on terminal state, project change, close, unmount.
- [ ] **Step 4: Render the UI.** Use the existing \`Clock\` icon in the header; render count/status, fixed right drawer/backdrop/close control, vertical status timeline, metadata, and scrollable monospace body panels.
- [ ] **Step 5: Run GREEN.** Repeat Step 2; expected PASS.
- [ ] **Step 6: Run required dashboard checks.**

~~~powershell
cd dashboard
npm run format
npm run format:check
npm run lint
npm test -- --run
~~~

Expected: formatting is clean, lint has zero errors/warnings, and all Vitest tests pass.
- [ ] **Step 7: Commit only this slice.**

~~~powershell
git add dashboard/src/components/ProjectLibrary.jsx dashboard/src/components/ProjectLibrary.test.jsx
git commit -m "feat: add project processing audit drawer"
~~~

### Task 7: End-to-end verification and local deployment

**Files:** verify only; no new source files.

- [ ] **Step 1: Run \`cd backend-go; go test ./... -count=1\`.**
- [ ] **Step 2: Run \`python -m pytest -q\`.**
- [ ] **Step 3: Run dashboard \`npm run format:check\`, \`npm run lint\`, and \`npm test -- --run\`.**
- [ ] **Step 4: Run \`node .gitnexus/run.cjs analyze\`, then \`detect_changes({scope: "all", repo: "openshorts"})\`; review any HIGH/CRITICAL result before deployment.**
- [ ] **Step 5: Rebuild/restart with \`docker compose up -d --build backend frontend\` and verify \`http://localhost:18000/health\` returns HTTP 200.**
- [ ] **Step 6: Smoke-test project \`99f832c6-595c-3bbc-3c4b-82c7dfcaa163\`: empty next-run state, new run events, ordered drawer, complete redacted allowlisted bodies, metadata-only binary/non-allowlisted events, and persistence after refresh.**
- [ ] **Step 7: Run \`git diff --check\` and \`git status --short\`; preserve unrelated user changes.**
