# MinIO Source Object Picker Implementation Plan

> For agentic workers: use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

Goal: Replace manually pasted MinIO URLs in the Clip Generator with a searchable selector for objects in the youtube-downloads bucket, while processing sources from temporary local files and never duplicating them into the output bucket.

Architecture: Add a backend MinIO source service that lists objects and downloads a selected object through the existing authenticated S3 client. /api/process accepts source_object {bucket, key}; run_job downloads that object into a job-scoped temporary directory, invokes the existing CLI with --input, and removes the temporary directory in finally. The dashboard replaces URL mode with a picker and submits the bucket/key pair.

Tech stack: FastAPI, boto3/MinIO S3 API, Python subprocess jobs, React 18, Vitest, Testing Library, existing Kubernetes ConfigMap credentials.

---

### Task 1: Add the authenticated MinIO source service

Files:
- Create: minio_sources.py
- Create: tests/test_minio_sources.py
- Create: tests/test_minio_api.py
- Modify: app.py near the S3 imports and API route definitions

- [ ] Step 1: Write failing service tests.

Use a fake S3 client to cover:
- listing only youtube-downloads;
- returning key, basename, size, and ISO last-modified metadata;
- search filtering;
- pagination;
- rejecting another bucket;
- rejecting empty, backslash, dot, and traversal keys.

The first test should assert this exact safe response shape:

    {
        "bucket": "youtube-downloads",
        "objects": [{
            "key": "videos/a.mp4",
            "name": "a.mp4",
            "size": 12,
            "last_modified": "2026-08-13T00:00:00+00:00"
        }]
    }

Also assert that returned objects do not contain url, presigned_url, access_key, or secret_key.

- [ ] Step 2: Run the focused tests and verify the expected RED failure.

    python -m pytest -q tests/test_minio_sources.py

Expected: collection fails because minio_sources.py does not exist.

- [ ] Step 3: Implement the service.

Expose these functions:

    SOURCE_BUCKET = "youtube-downloads"

    def validate_source_object(value: dict) -> tuple[str, str]:
        # Return the allowlisted bucket and normalized key, or raise ValueError.

    def list_source_objects(
        search: str = "",
        limit: int = 50,
        continuation_token: str | None = None,
    ) -> dict:
        # Return the configured bucket, safe object metadata, and an opaque next token.

    def download_source_object(
        bucket: str,
        key: str,
        destination: str,
        max_bytes: int,
    ) -> None:
        # Stream the object to destination.part, enforce max_bytes, then rename atomically.

Use get_s3_client() from s3_uploader.py. Use list_objects_v2 with pagination. Cap limit to a safe maximum. Filter search against the object key/name. Use get_object for downloads, enforce ContentLength and streamed byte limits, write to destination.part, atomically rename on success, and remove partial files on errors. Convert missing credentials to RuntimeError and S3 missing-object errors to FileNotFoundError.

- [ ] Step 4: Add GET /api/minio/objects.

The endpoint accepts search, limit, and continuation_token. It calls list_source_objects. Return 503 when MinIO credentials/service are unavailable, 404 only for missing source objects, and 400 for invalid query parameters. Never return Console URLs, presigned URLs, or credentials.

- [ ] Step 5: Run focused tests and commit.

    python -m pytest -q tests/test_minio_sources.py tests/test_minio_api.py

    git add minio_sources.py tests/test_minio_sources.py tests/test_minio_api.py app.py
    git commit -m "feat(minio): list source bucket objects"

### Task 2: Accept a selected object and process it from a temporary file

Files:
- Modify: app.py in the /api/process handler and run_job
- Modify: tests/test_process_minio_url.py
- Create: tests/test_minio_job_download.py

- [ ] Step 1: Write failing API and lifecycle tests.

Add a request test posting:

    {
        "source_object": {
            "bucket": "youtube-downloads",
            "key": "videos/source.bin"
        },
        "acknowledged": true
    }

Assert HTTP 200, job.source_object equals the submitted pair, the queued command does not contain --direct-url, and an arbitrary bucket returns HTTP 400.

Add a run_job test that patches download_source_object and subprocess.Popen, verifies --input points to a temporary path outside output/<job-id>, and asserts the temporary directory is removed after both success and process failure.

- [ ] Step 2: Run the focused tests and verify RED.

    python -m pytest -q tests/test_process_minio_url.py tests/test_minio_job_download.py

Expected: the selected-object request fails because /api/process currently requires url or file and run_job has no source-object download lifecycle.

- [ ] Step 3: Extend /api/process validation.

Accept exactly one of file or JSON source_object. Preserve multipart file uploads. Validate the selected object through validate_source_object and store it as jobs[job_id]["source_object"]. Do not accept arbitrary bucket names or Console URLs. Keep the rights acknowledgement requirement.

- [ ] Step 4: Download before the subprocess and clean up in finally.

When job_data contains source_object, create a temporary directory with tempfile.mkdtemp(prefix=f"openshorts-source-{job_id}-"), download to source.bin with the configured 2 GB limit, and construct the command with:

    ["python", "-u", "main.py",
     "--input", source_path,
     "--source-object", json.dumps(source_object),
     "--target-clips", str(clip_count),
     "-o", output_dir]

Do not place source_path under output/<job-id>. Do not pass --keep-original for selected MinIO objects. Keep the existing stdout polling and artifact upload logic unchanged. Always call shutil.rmtree(temporary_root, ignore_errors=True) in finally.

- [ ] Step 5: Run focused tests and commit.

    python -m pytest -q tests/test_process_minio_url.py tests/test_minio_job_download.py

    git add app.py tests/test_process_minio_url.py tests/test_minio_job_download.py
    git commit -m "feat(minio): process selected objects from temporary files"

### Task 3: Persist MinIO source provenance without copying the source

Files:
- Modify: main.py around argparse and metadata creation
- Modify: render_manifest.py
- Create: tests/test_source_provenance.py

- [ ] Step 1: Write failing provenance tests.

Test that --source-object accepts JSON containing bucket youtube-downloads and key videos/source.bin. Test that metadata and clip manifests retain source_object and do not require a source_*.mp4 copy in output.

- [ ] Step 2: Run RED.

    python -m pytest -q tests/test_source_provenance.py

Expected: argparse rejects --source-object or the manifest lacks source_object.

- [ ] Step 3: Add the CLI argument and source record.

Add:

    parser.add_argument(
        "--source-object",
        type=str,
        help="JSON MinIO source object reference for provenance.",
    )

Parse JSON, validate it with the shared allowlist helper, and include the object in result metadata and each clip manifest. Preserve the existing --source-url context field.

- [ ] Step 4: Make manifest source registration remote-aware.

Do not copy a source into the output directory when the input came from a temporary MinIO path. Register probe/checksum information for the current run and retain bucket/key as the canonical source reference. Future rerenders must hydrate a fresh temporary source from bucket/key before verifying or using the manifest. Existing local-file manifests keep their current behavior.

- [ ] Step 5: Run tests and commit.

    python -m pytest -q tests/test_source_provenance.py tests/test_render_manifest.py

    git add main.py render_manifest.py tests/test_source_provenance.py
    git commit -m "feat(manifest): preserve MinIO source references"

### Task 4: Build the searchable MinIO picker

Files:
- Create: dashboard/src/components/MinioObjectPicker.jsx
- Create: dashboard/src/components/MinioObjectPicker.test.jsx

- [ ] Step 1: Write failing component tests.

Cover:
- initial loading;
- successful list and selection;
- search request;
- empty result;
- unavailable MinIO error and Retry button;
- safe display of key, size, and modified time.

The selection callback must receive:

    {
        bucket: "youtube-downloads",
        key: "videos/source.bin",
        name: "source.bin",
        size: 12,
        last_modified: "2026-08-13T00:00:00Z"
    }

- [ ] Step 2: Run RED.

    cd dashboard
    npm test -- --run src/components/MinioObjectPicker.test.jsx

Expected: the component and test file do not exist.

- [ ] Step 3: Implement the picker.

Use getApiUrl("/api/minio/objects"), a debounced search field, loading/error/empty states, a bounded scroll list, and a selected-object summary. The component must never construct or display a MinIO URL. Use accessible buttons with labels such as Select source.bin and Retry.

- [ ] Step 4: Run focused tests and commit.

    npm test -- --run src/components/MinioObjectPicker.test.jsx

    git add dashboard/src/components/MinioObjectPicker.jsx dashboard/src/components/MinioObjectPicker.test.jsx
    git commit -m "feat(ui): add searchable MinIO object picker"

### Task 5: Replace URL mode and submit bucket/key

Files:
- Modify: dashboard/src/components/MediaInput.jsx
- Modify: dashboard/src/components/MediaInput.test.jsx
- Modify: dashboard/src/App.jsx around handleProcess
- Modify: dashboard/src/components/ProcessingAnimation.jsx

- [ ] Step 1: Write failing integration tests.

Replace the existing manual URL test with a test that waits for source.bin, selects it, checks acknowledgement, submits, and asserts:

    {
        type: "minio-object",
        payload: {
            bucket: "youtube-downloads",
            key: "videos/source.bin"
        },
        acknowledged: true
    }

Also assert there is no manual URL input or Local MinIO URL text. Keep the file-upload test.

- [ ] Step 2: Run RED.

    cd dashboard
    npm test -- --run src/components/MediaInput.test.jsx

Expected: the current component still renders the URL input and emits type url.

- [ ] Step 3: Replace URL mode with MinIO picker.

Use mode minio and mode file. Keep the optional original YouTube/Twitch context URL field. Disable Generate Clips until a MinIO object or local file is selected and acknowledgement is checked. Submit bucket/key only for MinIO selections.

- [ ] Step 4: Update App.jsx and ProcessingAnimation.jsx.

For type minio-object, send JSON:

    {
        source_object: data.payload,
        source_url: data.sourceUrl?.trim() || undefined,
        acknowledged: Boolean(data.acknowledged)
    }

Use JSON headers. Keep multipart file upload handling unchanged. Update ProcessingAnimation so a MinIO object does not call getYouTubeId or render as a YouTube preview; show the selected object name/key instead.

- [ ] Step 5: Run dashboard tests and commit.

    npm test -- --run src/components/MediaInput.test.jsx src/components/MinioObjectPicker.test.jsx
    npm run lint
    npm run build

    git add dashboard/src/components/MediaInput.jsx dashboard/src/components/MediaInput.test.jsx dashboard/src/App.jsx dashboard/src/components/ProcessingAnimation.jsx
    git commit -m "feat(ui): replace MinIO URL input with object selection"

### Task 6: End-to-end validation and local Kubernetes deployment

Files:
- Modify only tests if a targeted integration issue is found.

- [ ] Step 1: Run the complete Python suite.

    python -m pytest -q

Expected: all Python tests pass.

- [ ] Step 2: Run renderer, Remotion, and dashboard checks.

    cd render-service
    npm test
    npm run build
    cd ..\remotion
    npm run build
    cd ..\dashboard
    npm test
    npm run lint
    npm run build

Record any known order-dependent dashboard IndexedDB failure separately; do not change unrelated test infrastructure.

- [ ] Step 3: Build and deploy the local cluster.

    cd ..
    & .\scripts\deploy-local.ps1 -Namespace openshorts -KubeContext docker-desktop

Then verify:

    kubectl rollout status deployment/openshorts-backend -n openshorts --timeout=180s
    kubectl rollout status deployment/openshorts-renderer -n openshorts --timeout=180s
    kubectl rollout status deployment/openshorts-frontend -n openshorts --timeout=180s

- [ ] Step 4: Run a MinIO smoke test.

Open the dashboard, select an object from youtube-downloads, submit a job, and verify:
- the job starts without a Console URL;
- logs show the selected bucket/key without credentials;
- generated clips and metadata appear in output/<job-id>;
- no source.bin or source_*.mp4 appears in the job output;
- the temporary source directory is removed after completion;
- the source object remains only in youtube-downloads.

- [ ] Step 5: Commit only targeted fixes.

    git add app.py minio_sources.py tests/test_minio_sources.py tests/test_minio_api.py
    git commit -m "fix(minio): stabilize source picker integration"
