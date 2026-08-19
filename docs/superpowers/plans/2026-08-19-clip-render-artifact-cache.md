# Clip Render Artifact Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make deferred clip renders reuse the parent’s local source video while continuing to publish all UI-facing source and clip URLs through MinIO.

**Architecture:** Keep MinIO as the durable source of truth and the only UI-facing media origin. Treat the parent job directory as a worker-only cache: hydration downloads only missing/non-empty files, child renders exclude the unchanged source from upload, and successful child cleanup preserves only the local source file. Parent generation behavior remains unchanged.

**Tech Stack:** Python 3.12, boto3/S3-compatible MinIO storage, pytest/unittest, existing `python_worker.py` protocol, GitNexus impact/change analysis.

---

## File map

- Modify `s3_uploader.py:626-696` to support excluded artifact paths and reuse existing local files during hydration.
- Modify `python_worker.py:118-187` to pass child-render exclusions and preserve the worker-only source during cleanup.
- Modify `tests/test_s3_clip_urls.py:114-142` with hydration and upload regression coverage.
- Modify `tests/test_python_worker.py:196-229` with wrapper and selective-cleanup regression coverage.
- Create `docs/superpowers/plans/2026-08-19-clip-render-artifact-cache.md` (this plan).

## Task 1: Confirm blast radius and establish failing tests

**Files:**
- Test: `tests/test_s3_clip_urls.py`
- Test: `tests/test_python_worker.py`
- Modify: none until the tests are failing

- [ ] **Step 1: Run GitNexus impact analysis before editing symbols**

Run these analyses against `openshorts`:

```text
impact({target: "hydrate_job_artifacts", direction: "upstream", repo: "openshorts"})
impact({target: "upload_job_artifacts", direction: "upstream", repo: "openshorts"})
impact({target: "upload_generation_artifacts", direction: "upstream", repo: "openshorts"})
impact({target: "cleanup_generation_scratch", direction: "upstream", repo: "openshorts"})
impact({target: "_run_clip_generation", direction: "upstream", repo: "openshorts"})
```

Record direct callers and risk. If any result is `HIGH` or `CRITICAL`, stop and report it before editing.

- [ ] **Step 2: Add a failing hydration-cache test**

In `tests/test_s3_clip_urls.py`, extend the fake S3 client with a `downloads` list and add this test:

```python
def test_hydrate_job_artifacts_reuses_existing_non_empty_files(self):
    class FakePaginator:
        def paginate(self, **kwargs):
            assert kwargs == {"Bucket": "openshorts-media", "Prefix": "job-1/"}
            return [{"Contents": [
                {"Key": "job-1/source.mp4"},
                {"Key": "job-1/source_metadata.json"},
            ]}]

    class FakeS3Client:
        def __init__(self):
            self.downloads = []

        def get_paginator(self, name):
            assert name == "list_objects_v2"
            return FakePaginator()

        def download_file(self, bucket, key, destination):
            self.downloads.append((bucket, key, destination))
            Path(destination).write_bytes(key.encode("utf-8"))

    with tempfile.TemporaryDirectory() as directory:
        source = Path(directory, "source.mp4")
        source.write_bytes(b"existing-source")
        client = FakeS3Client()
        with patch.object(s3_uploader, "get_s3_client", return_value=client):
            hydrated = s3_uploader.hydrate_job_artifacts(directory, "job-1")

        self.assertEqual(hydrated, 1)
        self.assertEqual(source.read_bytes(), b"existing-source")
        self.assertEqual(client.downloads[0][1], "job-1/source_metadata.json")
```

- [ ] **Step 3: Run the hydration test and verify it fails for the intended reason**

Run:

```bash
python -m pytest tests/test_s3_clip_urls.py -k reuses_existing_non_empty_files -q
```

Expected: FAIL because the current implementation downloads `source.mp4` even when the local destination already contains data.

- [ ] **Step 4: Add a failing selective-upload test**

In `tests/test_s3_clip_urls.py`, add:

```python
def test_upload_job_artifacts_can_exclude_worker_source(self):
    with tempfile.TemporaryDirectory() as directory:
        Path(directory, "source.mp4").write_bytes(b"source")
        Path(directory, "source_metadata.json").write_text("{}", encoding="utf-8")

        with patch.object(s3_uploader, "upload_file_to_s3", return_value=True) as upload:
            self.assertTrue(
                s3_uploader.upload_job_artifacts(
                    directory,
                    "job-1",
                    excluded_paths={"source.mp4"},
                )
            )

        uploaded = [call.args[2] for call in upload.call_args_list]
        self.assertNotIn("job-1/source.mp4", uploaded)
        self.assertIn("job-1/source_metadata.json", uploaded)
```

- [ ] **Step 5: Run the selective-upload test and verify it fails for the intended reason**

Run:

```bash
python -m pytest tests/test_s3_clip_urls.py -k can_exclude_worker_source -q
```

Expected: FAIL because `upload_job_artifacts` does not yet accept `excluded_paths`.

- [ ] **Step 6: Add a failing selective-cleanup test**

In `tests/test_python_worker.py`, add:

```python
def test_cleanup_generation_scratch_preserves_selected_source(tmp_path):
    job_root = tmp_path / "job-1"
    job_root.mkdir()
    source = job_root / "source.mp4"
    source.write_bytes(b"source")
    (job_root / "source_metadata.json").write_text("{}", encoding="utf-8")
    (job_root / "rendered_clip.mp4").write_bytes(b"clip")
    scratch = job_root / "manifests"
    scratch.mkdir()
    (scratch / "clip.json").write_text("{}", encoding="utf-8")

    cleanup_generation_scratch(str(job_root), "job-1", preserve_paths=[str(source)])

    assert source.read_bytes() == b"source"
    assert not (job_root / "source_metadata.json").exists()
    assert not (job_root / "rendered_clip.mp4").exists()
    assert not scratch.exists()
```

- [ ] **Step 7: Run the selective-cleanup test and verify it fails for the intended reason**

Run:

```bash
python -m pytest tests/test_python_worker.py -k preserves_selected_source -q
```

Expected: FAIL because `cleanup_generation_scratch` does not yet accept `preserve_paths`.

## Task 2: Implement cache-aware hydration and selective S3 upload

**Files:**
- Modify: `s3_uploader.py:626-696`
- Test: `tests/test_s3_clip_urls.py`

- [ ] **Step 1: Implement the minimal hydration guard**

Before `client.download_file(...)`, compute the destination as today and skip it when it is an existing non-empty regular file:

```python
if os.path.isfile(destination) and os.path.getsize(destination) > 0:
    continue
```

Keep the existing prefix filtering, extension filtering, directory creation, and path traversal protection unchanged. Increment `hydrated` only when a download actually occurs.

- [ ] **Step 2: Run hydration tests**

Run:

```bash
python -m pytest tests/test_s3_clip_urls.py -k "hydrate_job_artifacts" -q
```

Expected: PASS, including the existing “downloads only job files” test and the new reuse test.

- [ ] **Step 3: Add an optional exclusion set to the uploader**

Change the signature to:

```python
def upload_job_artifacts(directory, job_id, excluded_paths=None):
```

Normalize the optional values to forward-slash relative paths once, then skip a file when its `relative_name` is in that set. Preserve the current behavior when `excluded_paths` is omitted or empty, including validation and `eligible_count` semantics.

- [ ] **Step 4: Run uploader tests**

Run:

```bash
python -m pytest tests/test_s3_clip_urls.py -q
```

Expected: PASS with source exclusion, validation, nested manifests, failed uploads, and existing hydration coverage.

## Task 3: Implement worker-only source preservation

**Files:**
- Modify: `python_worker.py:118-187`
- Test: `tests/test_python_worker.py`

- [ ] **Step 1: Extend the worker upload wrapper without changing parent generation defaults**

Change the wrapper to accept an optional exclusion list and forward it:

```python
def upload_generation_artifacts(output_dir: str, job_id: str, excluded_paths=None) -> bool:
    """Publish generated media to the configured MinIO/S3 output bucket."""
    if not str(os.environ.get("AWS_S3_BUCKET") or "").strip():
        return False
    from s3_uploader import upload_job_artifacts

    if excluded_paths:
        return bool(upload_job_artifacts(output_dir, job_id, excluded_paths=excluded_paths))
    return bool(upload_job_artifacts(output_dir, job_id))
```

Keep calls for non-`clip_render` operations unchanged so parent generation still uploads its source.

- [ ] **Step 2: Extend cleanup with an optional preserved-path list**

Change `cleanup_generation_scratch` so its default behavior remains the existing whole-directory removal, while `preserve_paths` causes it to remove every other direct child safely:

```python
def cleanup_generation_scratch(output_dir: str, job_id: str, preserve_paths=None) -> None:
    """Remove completed job scratch while retaining explicitly preserved files."""
    job_id = str(job_id or "").strip()
    output_path = Path(output_dir).resolve()
    if not job_id or output_path.name != job_id:
        raise ValueError("refusing to remove a non-job-scoped output directory")
    preserved = {Path(path).resolve() for path in (preserve_paths or [])}
    if not preserved:
        shutil.rmtree(output_path)
        return
    for child in output_path.iterdir():
        if child.resolve() in preserved:
            continue
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()
```

The implementation must preserve the current safety check and must not allow a preserved path outside `output_path` to affect deletion.

- [ ] **Step 3: Add a helper for a child render’s source-relative path**

Inside `_run_clip_generation`, resolve the request’s `source_path` relative to `output_dir` only for `clip_render`. If the source is inside the job root, pass its POSIX relative path to the uploader exclusion set and preserve its absolute path during cleanup. If it is outside the job root, do not exclude or preserve it; the existing render command still receives the request path, but cleanup remains limited to the job root.

Use this shape:

```python
operation = str(request.get("operation") or "")
source_path = str(request.get("source_path") or "").strip()
excluded_paths = set()
preserve_paths = []
if operation == "clip_render" and source_path:
    output_root = Path(output_dir).resolve()
    candidate = Path(source_path).resolve()
    try:
        excluded_paths.add(candidate.relative_to(output_root).as_posix())
        preserve_paths.append(str(candidate))
    except ValueError:
        pass
```

- [ ] **Step 4: Use the exclusion and preservation only for child renders**

Replace the final upload/cleanup block with this exact behavior:

```python
uploaded = upload_generation_artifacts(
    output_dir,
    artifact_job_id,
    excluded_paths=excluded_paths or None,
)
result = load_generation_result(output_dir)
if uploaded:
    cleanup_generation_scratch(
        output_dir,
        artifact_job_id,
        preserve_paths=preserve_paths or None,
    )
return exit_code, result
```

The resulting `result` and persisted metadata must continue to contain MinIO-backed URLs; no local `/app/output/...` path may be inserted into the response.

- [ ] **Step 5: Add wrapper forwarding coverage**

In `tests/test_python_worker.py`, extend the existing upload wrapper test with a captured argument assertion:

```python
def test_upload_generation_artifacts_forwards_exclusions(monkeypatch, tmp_path):
    calls = []

    def fake_upload(directory, job_id, excluded_paths=None):
        calls.append((directory, job_id, excluded_paths))
        return True

    monkeypatch.setenv("AWS_S3_BUCKET", "openshorts-media")
    monkeypatch.setattr("s3_uploader.upload_job_artifacts", fake_upload)

    assert upload_generation_artifacts(str(tmp_path), "job-1", {"source.mp4"}) is True
    assert calls == [(str(tmp_path), "job-1", {"source.mp4"})]
```

- [ ] **Step 6: Run worker tests**

Run:

```bash
python -m pytest tests/test_python_worker.py -q
```

Expected: PASS, including parent-generation default cleanup, child source preservation, and exclusion forwarding.

## Task 4: Verify the complete behavior and UI boundary

**Files:**
- Modify: none unless a test exposes a defect
- Test: `tests/test_s3_clip_urls.py`, `tests/test_python_worker.py`, existing project test suites

- [ ] **Step 1: Run the focused regression suites**

Run:

```bash
python -m pytest tests/test_s3_clip_urls.py tests/test_python_worker.py -q
```

Expected: all tests pass with no failures.

- [ ] **Step 2: Run the full Python test suite**

Run:

```bash
python -m pytest -q
```

Expected: exit code 0 and no regressions in generation, S3, lifecycle, or rendering tests.

- [ ] **Step 3: Inspect the changed behavior statically**

Confirm with search that:

```bash
rg -n "upload_generation_artifacts|cleanup_generation_scratch|hydrate_job_artifacts|source_path|video_url" python_worker.py s3_uploader.py tests/test_python_worker.py tests/test_s3_clip_urls.py
```

The child-render path must exclude only the local source file from upload, preserve it locally, and leave MinIO URL generation untouched.

- [ ] **Step 4: Run GitNexus change detection before committing implementation**

Run:

```text
detect_changes({repo: "openshorts"})
```

Expected: the changed-symbol set is limited to `hydrate_job_artifacts`, `upload_job_artifacts`, `upload_generation_artifacts`, `cleanup_generation_scratch`, `_run_clip_generation`, and their direct test callers. Do not commit if unrelated production symbols or execution flows appear.

- [ ] **Step 5: Commit the implementation**

```bash
git add s3_uploader.py python_worker.py tests/test_s3_clip_urls.py tests/test_python_worker.py
git commit -m "fix: cache source artifacts for clip renders"
```
