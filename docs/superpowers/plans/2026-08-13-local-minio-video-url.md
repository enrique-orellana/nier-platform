# Local MinIO Video URL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard Clip Generator's YouTube URL input with a direct Local MinIO URL workflow while preserving the existing `yt-dlp` helper and CLI `--url` path for legacy use.

**Architecture:** The dashboard continues posting a URL to `/api/process`, but the API queues `main.py --direct-url <url>` instead of `main.py --url <url>`. `main.py` gains a streamed direct HTTP downloader with localhost-to-`AWS_S3_ENDPOINT_URL` normalization, while the existing `download_youtube_video()` and CLI `--url` branch remain unchanged and are still used by legacy thumbnail/CLI code. The dashboard URL mode is relabeled to Local MinIO and does not expose YouTube-specific wording.

**Tech Stack:** React 18, Vitest, Testing Library, FastAPI, Python `httpx`, `argparse`, existing subprocess job queue.

---

### Task 1: Add frontend regression coverage for the Local MinIO input

**Files:**
- Create: `dashboard/src/components/MediaInput.test.jsx`
- Modify: `dashboard/src/components/MediaInput.jsx`

- [ ] **Step 1: Write the failing test**

Create a focused component test that renders `MediaInput` with a checked acknowledgment, types a direct MinIO URL, submits the form, and verifies the label and payload:

```jsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MediaInput from './MediaInput';

describe('MediaInput', () => {
  it('submits a Local MinIO URL without YouTube-specific UI', () => {
    const onProcess = vi.fn();
    render(<MediaInput onProcess={onProcess} isProcessing={false} targetClipCount={6} onTargetClipCountChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: /local minio url/i })).toBeInTheDocument();
    expect(screen.queryByText(/youtube url/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'http://localhost:9000/openshorts-media/source.mp4' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /generate clips/i }));

    expect(onProcess).toHaveBeenCalledWith({
      type: 'url',
      payload: 'http://localhost:9000/openshorts-media/source.mp4',
      acknowledged: true,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run dashboard/src/components/MediaInput.test.jsx` from `D:\workspace\openshorts\dashboard`.

Expected: FAIL because the current component renders `YouTube URL` and does not have a Local MinIO label.

- [ ] **Step 3: Implement the minimal frontend change**

In `dashboard/src/components/MediaInput.jsx`, remove the `Youtube` import and replace the URL tab and input copy:

```jsx
import { Upload, FileVideo, X, Link } from 'lucide-react';
```

Use `Link` for the tab icon, label it `Local MinIO URL`, set the placeholder to `http://localhost:9000/bucket/video.mp4`, and add helper text that says the URL must be reachable by the OpenShorts backend. Keep the existing `type="url"`, `onProcess({ type: 'url', payload: url, acknowledged: true })`, acknowledgment, file mode, clip count, and submit behavior unchanged.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --run dashboard/src/components/MediaInput.test.jsx`.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/components/MediaInput.jsx dashboard/src/components/MediaInput.test.jsx
git commit -m "feat: replace YouTube input with Local MinIO URL"
```

### Task 2: Add direct URL normalization and streaming download helpers

**Files:**
- Modify: `main.py` near `sanitize_filename()` and `download_youtube_video()`
- Test: `tests/test_direct_video_url.py`

- [ ] **Step 1: Write failing tests**

Create tests for the desired helper contract:

```python
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import main


class DirectVideoUrlTests(unittest.TestCase):
    def test_localhost_url_uses_configured_s3_endpoint(self):
        with patch.dict(os.environ, {"AWS_S3_ENDPOINT_URL": "http://minio:9000"}, clear=False):
            self.assertEqual(
                main.resolve_direct_video_url("http://localhost:9000/media/video.mp4?X-Amz-Signature=x"),
                "http://minio:9000/media/video.mp4?X-Amz-Signature=x",
            )

    def test_non_loopback_url_is_unchanged(self):
        url = "https://minio.example/media/video.mp4?signature=x"
        self.assertEqual(main.resolve_direct_video_url(url), url)

    def test_direct_download_streams_to_output_and_uses_path_filename(self):
        response = Mock(status_code=200, headers={"content-length": "5"})
        response.iter_bytes.return_value = iter([b"he", b"llo"])
        response.raise_for_status.return_value = None

        with tempfile.TemporaryDirectory() as directory, patch.object(main.httpx, "stream") as stream:
            stream.return_value.__enter__.return_value = response
            path, title = main.download_direct_video("http://minio:9000/media/source-video.mp4", directory)
            self.assertEqual(title, "source-video")
            self.assertEqual(Path(path).read_bytes(), b"hello")

    def test_direct_download_rejects_response_over_max_size(self):
        response = Mock(status_code=200, headers={"content-length": str(main.DIRECT_VIDEO_MAX_BYTES + 1)})
        response.raise_for_status.return_value = None

        with tempfile.TemporaryDirectory() as directory, patch.object(main.httpx, "stream") as stream:
            stream.return_value.__enter__.return_value = response
            with self.assertRaisesRegex(ValueError, "exceeds the configured file size limit"):
                main.download_direct_video("http://minio:9000/media/video.mp4", directory)

    def test_direct_download_rejects_non_http_scheme(self):
        with self.assertRaises(ValueError):
            main.resolve_direct_video_url("file:///tmp/video.mp4")


if __name__ == "__main__":
    unittest.main()
```

The implementation should use `urllib.parse.urlsplit/urlunsplit`, recognize `localhost`, `127.0.0.1`, and `::1`, preserve path/query/fragment, and use `httpx.stream("GET", ..., follow_redirects=True, timeout=300.0)`. Read in 1 MiB chunks, reject a declared `Content-Length` above `MAX_FILE_SIZE_MB * 1024 * 1024`, and reject when the accumulated bytes exceed the same limit. Use `sanitize_filename()` and fall back to `<timestamp-or-job-safe-name>.mp4` when the path has no filename. Return `(local_path, title)`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_direct_video_url.py -q`.

Expected: FAIL because `resolve_direct_video_url`, `download_direct_video`, and `DIRECT_VIDEO_MAX_BYTES` do not exist.

- [ ] **Step 3: Implement the minimal helpers**

Import `urlsplit`/`urlunsplit` and `httpx` in `main.py`. Add:

```python
DIRECT_VIDEO_MAX_BYTES = 500 * 1024 * 1024


def resolve_direct_video_url(url: str) -> str:
    parsed = urlsplit((url or '').strip())
    if parsed.scheme not in {'http', 'https'} or not parsed.netloc:
        raise ValueError('Video URL must use http:// or https://')
    endpoint = os.environ.get('AWS_S3_ENDPOINT_URL', '').strip()
    if endpoint and parsed.hostname in {'localhost', '127.0.0.1', '::1'}:
        internal = urlsplit(endpoint)
        if internal.scheme in {'http', 'https'} and internal.netloc:
            return urlunsplit((internal.scheme, internal.netloc, parsed.path, parsed.query, parsed.fragment))
    return url
```

Implement `download_direct_video()` next to the existing YouTube helper. Keep `download_youtube_video()` unchanged, including its cookie and `yt-dlp` behavior. The direct helper must not import or call `yt_dlp`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_direct_video_url.py -q`.

Expected: PASS with all direct URL helper tests green.

- [ ] **Step 5: Commit**

```bash
git add main.py tests/test_direct_video_url.py
git commit -m "feat: add streamed direct MinIO video downloads"
```

### Task 3: Wire `/api/process` to the direct URL CLI path without removing yt-dlp

**Files:**
- Modify: `app.py:54,862-930`
- Modify: `main.py:1410-1470`
- Test: `tests/test_process_minio_url.py`

- [ ] **Step 1: Write failing API/CLI tests**

Add tests that patch the job queue and AI configuration, post an acknowledged MinIO URL, and assert the queued command contains `--direct-url` and does not contain `--url`:

```python
from fastapi.testclient import TestClient
import app as app_module


def test_process_queues_direct_url_without_ytdlp_flag(monkeypatch):
    app_module.jobs.clear()
    queued = []
    class Queue:
        async def put(self, value):
            queued.append(value)
    monkeypatch.setattr(app_module, 'job_queue', Queue())
    monkeypatch.setattr(app_module, 'build_ai_config', lambda **kwargs: type('Config', (), {
        'is_gemini': lambda self: False,
    })())

    response = TestClient(app_module.app).post(
        '/api/process?clip_count=3',
        json={'url': 'http://localhost:9000/openshorts-media/source.mp4', 'acknowledged': True},
    )

    assert response.status_code == 200
    command = app_module.jobs[response.json()['job_id']]['cmd']
    assert '--direct-url' in command
    assert 'http://localhost:9000/openshorts-media/source.mp4' in command
    assert '--url' not in command


def test_process_rejects_non_http_url(monkeypatch):
    monkeypatch.setattr(app_module, 'build_ai_config', lambda **kwargs: type('Config', (), {
        'is_gemini': lambda self: False,
    })())
    response = TestClient(app_module.app).post(
        '/api/process',
        json={'url': 'file:///tmp/source.mp4', 'acknowledged': True},
    )
    assert response.status_code == 400
```

Add a CLI test that parses/executes the new `--direct-url` branch with `download_direct_video` patched, proving the frontend path uses the direct helper while the existing `--url` branch remains unchanged.

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_process_minio_url.py -q`.

Expected: FAIL because `/api/process` currently queues `-u`/`--url` and `main.py` has no `--direct-url` argument.

- [ ] **Step 3: Implement the API and CLI wiring**

In `app.py`, validate submitted URL scheme before creating the job, remove the `DISABLE_YOUTUBE_URL` rejection from this endpoint, and queue:

```python
if url:
    parsed_url = urlsplit(url.strip())
    if parsed_url.scheme not in {'http', 'https'} or not parsed_url.netloc:
        raise HTTPException(status_code=400, detail='Video URL must use http:// or https://')
    cmd.extend(['--direct-url', url.strip()])
```

Leave `DISABLE_YOUTUBE_URL` and all `download_youtube_video()` call sites used by thumbnail workflows untouched. In `main.py`, make the argparse input group include `--direct-url` alongside existing `--input` and `--url`, then add a branch that chooses the output directory like the URL branch and calls `download_direct_video(args.direct_url, output_dir)`. The legacy `args.url` branch must continue to call `download_youtube_video(args.url, output_dir)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_process_minio_url.py tests/test_direct_video_url.py -q`.

Expected: PASS, with the queued frontend path containing only `--direct-url` and the legacy `--url` implementation still present.

- [ ] **Step 5: Commit**

```bash
git add app.py main.py tests/test_process_minio_url.py
git commit -m "feat: route Clip Generator URLs to MinIO downloader"
```

### Task 4: Verify the full change and preserve the legacy boundary

**Files:**
- Modify: `README.md` only if the current user-facing URL documentation mentions YouTube input.

- [ ] **Step 1: Search for frontend YouTube URL wiring**

Run: `rg -n "YouTube URL|youtube.*url|--url|download_youtube_video" dashboard/src app.py main.py tests`.

Expected: `dashboard/src` contains no Clip Generator YouTube URL label or `--url` command construction; `main.py` and unrelated thumbnail code may still contain the legacy helper and CLI branch.

- [ ] **Step 2: Run backend tests**

Run: `python -m pytest -q`.

Expected: all existing and new Python tests pass.

- [ ] **Step 3: Run dashboard tests and lint/build**

Run from `D:\workspace\openshorts\dashboard`:

```bash
npm test -- --run
npm run lint
npm run build
```

Expected: all tests pass, ESLint exits 0, and Vite produces a production build.

- [ ] **Step 4: Review the final diff**

Run: `git diff HEAD~4..HEAD --stat; git status --short`.

Expected: only the spec/plan and focused implementation/test files are changed; no generated build output or unrelated files are staged.

- [ ] **Step 5: Commit documentation updates if needed**

If `README.md` was changed in Step 1, commit it with:

```bash
git add README.md
git commit -m "docs: describe Local MinIO URL input"
```
