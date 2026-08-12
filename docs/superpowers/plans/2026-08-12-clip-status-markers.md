# Clip Workflow Status Markers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist and display a fixed workflow status independently for every generated clip on the project page.

**Architecture:** Store a versioned `clip_statuses.json` sidecar under each project’s existing S3/MinIO prefix. The FastAPI backend validates and updates one clip status at a time; `ProjectLibrary` loads the status map and owns optimistic update/rollback behavior; a focused `ClipWorkflowStatus` component renders the fixed options inside each `ResultCard`.

**Tech Stack:** FastAPI/Pydantic, boto3 S3-compatible storage, React, Vitest, Testing Library, unittest/pytest.

---

## Fixed contract

Use these exact API values and labels everywhere:

```text
not_reviewed -> Not reviewed
reviewing    -> Reviewing
editing      -> Editing
edited       -> Edited
published    -> Published
```

The sidecar key is `<job_id>/clip_statuses.json` and its shape is:

```json
{
  "version": 1,
  "clips": {
    "0": {
      "status": "editing",
      "updated_at": "2026-08-12T18:30:00Z"
    }
  }
}
```

Missing clip entries mean `not_reviewed`.

### Task 1: Add S3/MinIO clip-status storage helpers

**Files:**
- Modify: `s3_uploader.py:1-90,574-690`
- Create: `tests/test_s3_clip_statuses.py`

- [ ] **Step 1: Write failing storage tests**

Add tests using a fake S3 client with `get_object`, `put_object`, and `ClientError` behavior:

```python
def test_read_clip_statuses_returns_empty_document_when_sidecar_is_missing(monkeypatch):
    fake = MissingObjectS3Client()
    monkeypatch.setattr(s3_uploader, "get_s3_client", lambda: fake)

    assert s3_uploader.load_clip_statuses("job-1") == {
        "version": 1,
        "clips": {},
    }


def test_write_clip_statuses_uses_project_sidecar_and_json_content_type(monkeypatch):
    fake = RecordingS3Client()
    monkeypatch.setattr(s3_uploader, "get_s3_client", lambda: fake)

    s3_uploader.save_clip_statuses("job-1", {"0": {"status": "edited"}})

    assert fake.put_calls[0]["Key"] == "job-1/clip_statuses.json"
    assert fake.put_calls[0]["ContentType"] == "application/json"
    assert json.loads(fake.put_calls[0]["Body"]) == {
        "version": 1,
        "clips": {"0": {"status": "edited"}},
    }


def test_read_clip_statuses_rejects_malformed_sidecar(monkeypatch):
    fake = RecordingS3Client(body=b'{"clips": []}')
    monkeypatch.setattr(s3_uploader, "get_s3_client", lambda: fake)

    with pytest.raises(ValueError, match="clip status"):
        s3_uploader.load_clip_statuses("job-1")
```

The fake client should return a body object exposing `read()`, and the missing-object case should raise `ClientError` with one of the existing S3 not-found codes (`404`, `NoSuchKey`, or `NotFound`).

- [ ] **Step 2: Run the focused tests and confirm the expected red failure**

Run:

```powershell
py -m pytest -q tests/test_s3_clip_statuses.py
```

Expected: FAIL because `load_clip_statuses` and `save_clip_statuses` do not exist yet.

- [ ] **Step 3: Implement the storage helpers**

In `s3_uploader.py`, add constants and synchronous helpers next to the existing S3 artifact helpers:

```python
CLIP_STATUS_VERSION = 1
CLIP_STATUS_SIDECAR = "clip_statuses.json"


def _clip_status_key(job_id):
    return f"{job_id}/{CLIP_STATUS_SIDECAR}"


def _empty_clip_status_document():
    return {"version": CLIP_STATUS_VERSION, "clips": {}}


def load_clip_statuses(job_id, bucket_name=None):
    bucket_name = bucket_name or os.environ.get("AWS_S3_BUCKET", "my-clips-bucket")
    client = get_s3_client()
    if not client:
        raise RuntimeError("S3 storage is unavailable")
    try:
        response = client.get_object(Bucket=bucket_name, Key=_clip_status_key(job_id))
    except ClientError as error:
        code = str(error.response.get("Error", {}).get("Code", ""))
        if code in {"404", "NoSuchKey", "NotFound"}:
            return _empty_clip_status_document()
        raise
    document = json.loads(response["Body"].read().decode("utf-8"))
    if not isinstance(document, dict) or document.get("version") != CLIP_STATUS_VERSION or not isinstance(document.get("clips"), dict):
        raise ValueError("Invalid clip status sidecar")
    return {"version": CLIP_STATUS_VERSION, "clips": document["clips"]}


def save_clip_statuses(job_id, clips, bucket_name=None):
    bucket_name = bucket_name or os.environ.get("AWS_S3_BUCKET", "my-clips-bucket")
    client = get_s3_client()
    if not client:
        raise RuntimeError("S3 storage is unavailable")
    document = {"version": CLIP_STATUS_VERSION, "clips": clips}
    client.put_object(
        Bucket=bucket_name,
        Key=_clip_status_key(job_id),
        Body=json.dumps(document, ensure_ascii=False, indent=2).encode("utf-8"),
        ContentType="application/json",
    )
    return document
```

Normalize loaded records only enough to preserve the sidecar contract; status-value and clip-index validation belongs in the API layer because it needs the project’s clip list.

- [ ] **Step 4: Run storage tests and the existing S3 tests**

Run:

```powershell
py -m pytest -q tests/test_s3_clip_statuses.py tests/test_s3_clip_urls.py
```

Expected: all focused tests pass.

- [ ] **Step 5: Commit the storage unit**

```powershell
git add s3_uploader.py tests/test_s3_clip_statuses.py
git commit -m "feat: add clip status sidecar storage"
```

### Task 2: Add validated status API routes

**Files:**
- Modify: `app.py:1-70,1460-1665`
- Create: `tests/test_clip_status_api.py`

- [ ] **Step 1: Write failing API tests**

Use `fastapi.testclient.TestClient`, seed `app_module.jobs` with one job containing two clips, and patch the storage helpers. Cover the missing-sidecar default, valid update, invalid status, invalid clip index, and unknown job:

```python
def test_get_statuses_defaults_existing_project_to_not_reviewed(monkeypatch):
    setup_job(monkeypatch)
    monkeypatch.setattr(app_module, "load_clip_statuses", lambda _job_id: {"version": 1, "clips": {}})

    response = TestClient(app_module.app).get("/api/projects/job-1/statuses")

    assert response.status_code == 200
    assert response.json() == {"version": 1, "clips": {}}


def test_patch_clip_status_persists_a_valid_status(monkeypatch):
    setup_job(monkeypatch)
    document = {"version": 1, "clips": {}}
    saved = []
    monkeypatch.setattr(app_module, "load_clip_statuses", lambda _job_id: document)
    monkeypatch.setattr(app_module, "save_clip_statuses", lambda _job_id, clips: saved.append(clips))

    response = TestClient(app_module.app).patch(
        "/api/projects/job-1/clips/1/status",
        json={"status": "edited"},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "edited"
    assert saved[0]["1"]["status"] == "edited"


def test_patch_clip_status_rejects_unknown_status(monkeypatch):
    setup_job(monkeypatch)

    response = TestClient(app_module.app).patch(
        "/api/projects/job-1/clips/0/status",
        json={"status": "queued"},
    )

    assert response.status_code == 422


def test_patch_clip_status_rejects_unknown_clip(monkeypatch):
    setup_job(monkeypatch)

    response = TestClient(app_module.app).patch(
        "/api/projects/job-1/clips/9/status",
        json={"status": "reviewing"},
    )

    assert response.status_code == 404


def test_get_statuses_rejects_unknown_project(monkeypatch):
    app_module.jobs.clear()

    response = TestClient(app_module.app).get("/api/projects/missing/statuses")

    assert response.status_code == 404
```

`setup_job` should populate `app_module.jobs["job-1"]["result"]["clips"]` with exactly two clip dictionaries and clear the global jobs map before each test.

- [ ] **Step 2: Run the focused API tests and confirm red**

Run:

```powershell
py -m pytest -q tests/test_clip_status_api.py
```

Expected: FAIL because the routes and imported storage helpers do not exist.

- [ ] **Step 3: Implement the API contract**

Import `load_clip_statuses` and `save_clip_statuses` from `s3_uploader.py`. Add the fixed set and request model near the other API models:

```python
CLIP_WORKFLOW_STATUSES = {
    "not_reviewed",
    "reviewing",
    "editing",
    "edited",
    "published",
}


class ClipStatusRequest(BaseModel):
    status: str
```

Add these routes near the existing `/api/projects/history` and project routes:

```python
@app.get("/api/projects/{job_id}/statuses")
async def get_project_clip_statuses(job_id: str):
    job = _get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Project not found")
    try:
        return await asyncio.get_running_loop().run_in_executor(None, load_clip_statuses, job_id)
    except ValueError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@app.patch("/api/projects/{job_id}/clips/{clip_index}/status")
async def update_project_clip_status(job_id: str, clip_index: int, request: ClipStatusRequest):
    job = _get_job(job_id)
    clips = (job or {}).get("result", {}).get("clips", [])
    if not job:
        raise HTTPException(status_code=404, detail="Project not found")
    if clip_index < 0 or clip_index >= len(clips):
        raise HTTPException(status_code=404, detail="Clip not found")
    if request.status not in CLIP_WORKFLOW_STATUSES:
        raise HTTPException(status_code=422, detail="Invalid clip status")
    try:
        document = await asyncio.get_running_loop().run_in_executor(None, load_clip_statuses, job_id)
        updated_at = datetime.now(timezone.utc).isoformat()
        clips_by_index = dict(document["clips"])
        clips_by_index[str(clip_index)] = {"status": request.status, "updated_at": updated_at}
        await asyncio.get_running_loop().run_in_executor(None, save_clip_statuses, job_id, clips_by_index)
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    return {"job_id": job_id, "clip_index": clip_index, "status": request.status, "updated_at": updated_at}
```

Import `datetime` and `timezone` from `datetime`. Preserve last-write-wins semantics. Do not modify generated metadata or version-store data.

- [ ] **Step 4: Run the API tests and the related backend suite**

Run:

```powershell
py -m pytest -q tests/test_clip_status_api.py tests/test_version_api.py tests/test_s3_clip_urls.py
```

Expected: all tests pass.

- [ ] **Step 5: Commit the API unit**

```powershell
git add app.py tests/test_clip_status_api.py
git commit -m "feat: expose clip workflow status API"
```

### Task 3: Add the fixed-status UI control

**Files:**
- Create: `dashboard/src/components/ClipWorkflowStatus.jsx`
- Create: `dashboard/src/components/ClipWorkflowStatus.test.jsx`

- [ ] **Step 1: Write failing component tests**

Test that the selector renders the five labels, exposes the current value, and calls the callback:

```jsx
it('renders the fixed workflow statuses and reports a selection', () => {
  const onChange = vi.fn();
  render(<ClipWorkflowStatus status="reviewing" onChange={onChange} />);

  expect(screen.getByLabelText('Clip status')).toHaveValue('reviewing');
  expect(screen.getByRole('option', { name: 'Not reviewed' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Reviewing' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Editing' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Edited' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Published' })).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Clip status'), { target: { value: 'edited' } });
  expect(onChange).toHaveBeenCalledWith('edited');
});
```

- [ ] **Step 2: Run the component test and confirm red**

Run:

```powershell
cd dashboard
npm test -- --run src/components/ClipWorkflowStatus.test.jsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the focused selector**

Create a component with one exported status definition:

```jsx
export const CLIP_WORKFLOW_STATUSES = [
  { value: 'not_reviewed', label: 'Not reviewed', className: 'bg-zinc-500/15 text-zinc-300 border-zinc-400/20' },
  { value: 'reviewing', label: 'Reviewing', className: 'bg-amber-500/15 text-amber-300 border-amber-400/20' },
  { value: 'editing', label: 'Editing', className: 'bg-blue-500/15 text-blue-300 border-blue-400/20' },
  { value: 'edited', label: 'Edited', className: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/20' },
  { value: 'published', label: 'Published', className: 'bg-violet-500/15 text-violet-300 border-violet-400/20' },
];
```

Render a colored label badge and an accessible `<select aria-label="Clip status">`. Normalize missing or unknown incoming values to `not_reviewed`; disable the select when `saving` is true; call `onChange(event.target.value)` on change.

- [ ] **Step 4: Run the focused component test**

Run:

```powershell
cd dashboard
npm test -- --run src/components/ClipWorkflowStatus.test.jsx
```

Expected: PASS.

- [ ] **Step 5: Commit the UI control**

```powershell
git add dashboard/src/components/ClipWorkflowStatus.jsx dashboard/src/components/ClipWorkflowStatus.test.jsx
git commit -m "feat: add clip workflow status control"
```

### Task 4: Integrate status loading, optimistic updates, and project summary

**Files:**
- Modify: `dashboard/src/components/ProjectLibrary.jsx:1-190,220-340`
- Modify: `dashboard/src/components/ResultCard.jsx:40-60,535-570`
- Modify: `dashboard/src/components/ProjectLibrary.test.jsx`

- [ ] **Step 1: Write failing integration tests**

Extend `ProjectLibrary.test.jsx` with URL-aware fetch responses. Add one test that renders a selected project, loads the status map, and changes clip 0 from `reviewing` to `edited`:

```jsx
it('loads and updates a status independently for a clip', async () => {
  const fetchMock = vi.fn((url, options = {}) => {
    if (String(url).includes('/api/projects/history')) {
      return Promise.resolve({ ok: true, json: async () => ({ projects: [{ job_id: 'job-1', title: 'Test project', clips: [{ video_url: '/videos/job-1/clip.mp4', index: 0 }], clip_count: 1 }] }) });
    }
    if (String(url).includes('/api/projects/job-1/statuses')) {
      return Promise.resolve({ ok: true, json: async () => ({ version: 1, clips: { '0': { status: 'reviewing' } } }) });
    }
    if (String(url).includes('/api/projects/job-1/clips/0/status')) {
      expect(options.method).toBe('PATCH');
      expect(JSON.parse(options.body)).toEqual({ status: 'edited' });
      return Promise.resolve({ ok: true, json: async () => ({ status: 'edited', updated_at: '2026-08-12T18:30:00Z' }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({ clips: [] }) });
  });
  vi.stubGlobal('fetch', fetchMock);

  render(<ProjectLibrary projectId="job-1" />);
  await waitFor(() => expect(screen.getByLabelText('Clip status')).toHaveValue('reviewing'));
  fireEvent.change(screen.getByLabelText('Clip status'), { target: { value: 'edited' } });
  await waitFor(() => expect(screen.getByLabelText('Clip status')).toHaveValue('edited'));
  expect(screen.getByText(/1 edited/)).toBeInTheDocument();
});
```

Add a second test where the PATCH response is not OK and assert that the select returns to `reviewing` and an error message is visible. Update imports to include `fireEvent`, `screen`, and `waitFor`.

- [ ] **Step 2: Run the integration tests and confirm red**

Run:

```powershell
cd dashboard
npm test -- --run src/components/ProjectLibrary.test.jsx
```

Expected: FAIL because the project page does not request statuses or render a status control.

- [ ] **Step 3: Integrate the status map into `ProjectLibrary`**

Add state for `clipStatuses`, `statusError`, and the currently saving index. Add a `loadProjectStatuses(jobId)` callback that requests `/api/projects/${encodeURIComponent(jobId)}/statuses`, stores `payload.clips || {}`, and reports failures without clearing the clip list.

Call it whenever `selectedProject` changes and whenever a project is opened. Keep status keys as string clip indexes:

```jsx
const statusForClip = (clip, index) => {
  const clipIndex = clip.index ?? index;
  return clipStatuses[String(clipIndex)]?.status || 'not_reviewed';
};
```

Add the optimistic update handler:

```jsx
const handleClipStatusChange = async (clipIndex, nextStatus) => {
  const key = String(clipIndex);
  const previous = clipStatuses[key];
  setStatusError('');
  setClipStatuses((current) => ({ ...current, [key]: { ...(current[key] || {}), status: nextStatus } }));
  setSavingStatusIndex(key);
  try {
    const response = await fetch(getApiUrl(`/api/projects/${encodeURIComponent(selectedProject.job_id)}/clips/${encodeURIComponent(clipIndex)}/status`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    });
    if (!response.ok) throw new Error(await response.text());
    const payload = await response.json();
    setClipStatuses((current) => ({ ...current, [key]: { status: payload.status, updated_at: payload.updated_at } }));
  } catch (error) {
    setClipStatuses((current) => {
      const restored = { ...current };
      if (previous) restored[key] = previous;
      else delete restored[key];
      return restored;
    });
    setStatusError(error.message || 'Could not save clip status.');
  } finally {
    setSavingStatusIndex(null);
  }
};
```

Render the fixed-status summary from `normalizedProjectClips`, counting each clip with `statusForClip`. Pass the status props to `ResultCard`:

```jsx
workflowStatus={statusForClip(clip, index)}
workflowStatusSaving={savingStatusIndex === String(clip.index ?? index)}
onWorkflowStatusChange={(nextStatus) => handleClipStatusChange(clip.index ?? index, nextStatus)}
```

Render `statusError` near the existing project error area. Do not put the selector inside the outer project-card button used by the project list.

- [ ] **Step 4: Integrate the control into `ResultCard`**

Extend the props with `workflowStatus`, `workflowStatusSaving`, and `onWorkflowStatusChange`. Import `ClipWorkflowStatus` and render it in the card content area immediately before `CardContent`:

```jsx
<ClipWorkflowStatus
  status={workflowStatus}
  saving={workflowStatusSaving}
  onChange={onWorkflowStatusChange}
/>
<CardContent clip={clip} />
```

Keep all existing video, editor, render, and publish behavior unchanged.

- [ ] **Step 5: Run the integration tests and full frontend suite**

Run:

```powershell
cd dashboard
npm test -- --run src/components/ClipWorkflowStatus.test.jsx src/components/ProjectLibrary.test.jsx
npm test
npm run lint
npm run build
```

Expected: the focused tests pass, then all frontend tests pass with no lint errors and a successful production build.

- [ ] **Step 6: Commit the integration unit**

```powershell
git add dashboard/src/components/ProjectLibrary.jsx dashboard/src/components/ProjectLibrary.test.jsx dashboard/src/components/ResultCard.jsx
git commit -m "feat: track workflow status per generated clip"
```

### Task 5: Run complete verification and deploy locally

**Files:**
- No source changes expected.

- [ ] **Step 1: Run the complete backend suite**

```powershell
py -m pytest -q
```

Expected: all backend tests pass.

- [ ] **Step 2: Run the complete frontend checks**

```powershell
cd dashboard
npm test
npm run lint
npm run build
```

Expected: all frontend tests pass, lint exits 0, and Vite builds successfully.

- [ ] **Step 3: Deploy the local Kubernetes stack**

```powershell
cd ..
& .\scripts\deploy-local.ps1 -KubeContext docker-desktop
```

Expected: backend, frontend, renderer, and translation deployments roll out successfully.

- [ ] **Step 4: Verify the live API contract**

```powershell
$base = 'http://openshorts.127.0.0.1.nip.io'
curl.exe -sS "$base/api/projects/50ba3042-fd3b-4c29-8d40-1a8756fc0b64/statuses"
curl.exe -sS -X PATCH "$base/api/projects/50ba3042-fd3b-4c29-8d40-1a8756fc0b64/clips/0/status" -H 'Content-Type: application/json' -d '{"status":"reviewing"}'
```

Expected: GET returns version 1 with a clips map, PATCH returns clip index 0 with status `reviewing`, and a subsequent GET preserves it.

- [ ] **Step 5: Verify repository state and commit the final integration if needed**

```powershell
git diff --check
git status --short --branch
```

Expected: no whitespace errors; only intentional commits are present; no generated build artifacts are staged.
