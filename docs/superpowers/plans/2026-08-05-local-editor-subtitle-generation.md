# Local Editor Subtitle Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate editable timed subtitles from the uploaded `/editor` video through the local OpenShorts backend.

**Architecture:** Add a multipart FastAPI endpoint that stores one temporary upload, calls the existing local `transcribe_audio`/`faster-whisper` path in an executor, and returns language plus transcript segments. Add a frontend request helper in `LocalEditorTab` that validates and clamps the returned segments before committing them as one undoable editor action.

**Tech Stack:** FastAPI, Python `faster-whisper`, React 18, Vitest, Testing Library, existing local editor persistence/history.

---

### Task 1: Add and test the local transcription endpoint

**Files:**
- Modify: `app.py` near the existing subtitle imports and API routes
- Modify: `subtitles.py` only if the existing transcript function needs a reusable import-safe boundary
- Test: `tests/test_local_editor_transcription_api.py`

- [ ] **Step 1: Write the failing endpoint tests**

Create a FastAPI `TestClient` test module that monkeypatches the transcription function and upload directory. Cover:

```python
def test_local_editor_transcription_returns_segments(tmp_path, monkeypatch):
    monkeypatch.setattr(app_module, "UPLOAD_DIR", str(tmp_path))
    monkeypatch.setattr(app_module, "transcribe_audio", lambda path: {
        "language": "it",
        "segments": [
            {"start": 0.25, "end": 1.4, "text": " Ciao mondo "},
            {"start": 1.4, "end": 1.4, "text": "empty duration"},
        ],
    })
    response = TestClient(app_module.app).post(
        "/api/local-editor/transcribe",
        files={"file": ("demo.mp4", b"video-bytes", "video/mp4")},
    )
    assert response.status_code == 200
    assert response.json() == {
        "language": "it",
        "segments": [
            {"start": 0.25, "end": 1.4, "text": " Ciao mondo "},
            {"start": 1.4, "end": 1.4, "text": "empty duration"},
        ],
    }
    assert list(tmp_path.iterdir()) == []


def test_local_editor_transcription_rejects_non_video_upload(tmp_path, monkeypatch):
    monkeypatch.setattr(app_module, "UPLOAD_DIR", str(tmp_path))
    response = TestClient(app_module.app).post(
        "/api/local-editor/transcribe",
        files={"file": ("captions.srt", b"1", "application/x-subrip")},
    )
    assert response.status_code == 400
    assert "video" in response.json()["detail"].lower()
    assert list(tmp_path.iterdir()) == []
```

- [ ] **Step 2: Run the endpoint tests and verify the expected red failure**

Run:

```powershell
pytest tests/test_local_editor_transcription_api.py -q
```

Expected: the tests fail because `/api/local-editor/transcribe` and the patchable transcription import do not exist yet.

- [ ] **Step 3: Implement the endpoint**

Import `transcribe_audio` from `subtitles` in `app.py`. Add:

```python
@app.post("/api/local-editor/transcribe")
async def transcribe_local_editor_video(file: UploadFile = File(...)):
    if not file.content_type or not file.content_type.startswith("video/"):
        raise HTTPException(status_code=400, detail="Please upload a video file.")

    safe_name = Path(file.filename or "local-video").name
    temp_path = os.path.join(UPLOAD_DIR, f"local-editor-{uuid.uuid4().hex}-{safe_name}")
    try:
        with open(temp_path, "wb") as output:
            shutil.copyfileobj(file.file, output)
        loop = asyncio.get_running_loop()
        transcript = await loop.run_in_executor(None, transcribe_audio, temp_path)
        return {
            "language": transcript.get("language", "und"),
            "segments": transcript.get("segments", []),
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Subtitle generation failed: {exc}") from exc
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)
```

Keep the file cleanup in `finally`; do not expose the temporary path in the response. Place the route before unrelated thumbnail routes and after the existing subtitle imports.

- [ ] **Step 4: Run the endpoint tests and verify green**

Run:

```powershell
pytest tests/test_local_editor_transcription_api.py -q
```

Expected: both endpoint tests pass.

- [ ] **Step 5: Commit the backend endpoint**

```powershell
git add app.py tests/test_local_editor_transcription_api.py
git commit -m "feat: add local editor transcription endpoint"
```

### Task 2: Add editor-side generated cue normalization and request behavior

**Files:**
- Modify: `dashboard/src/components/local-editor/LocalEditorTab.jsx`
- Test: `dashboard/src/components/local-editor/LocalEditorTab.test.jsx`

- [ ] **Step 1: Write the failing editor tests**

Add tests that mock `global.fetch`, upload a local video, expand Subtitles, and click `Generate subtitles`. Cover:

```jsx
it('generates subtitles from the local video and records one undoable action', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:demo');
    global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ language: 'en', segments: [
            { start: 0.25, end: 1.4, text: 'Generated caption' },
        ] }),
    });
    render(<LocalEditorTab />);
    fireEvent.change(screen.getByLabelText(/upload video/i), { target: { files: [makeVideoFile()] } });
    await waitFor(() => expect(screen.getByRole('button', { name: /toggle subtitles settings/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /toggle subtitles settings/i }));
    fireEvent.click(screen.getByRole('button', { name: /generate subtitles/i }));

    await waitFor(() => expect(screen.getAllByText('Generated caption').length).toBeGreaterThan(0));
    expect(global.fetch).toHaveBeenCalledWith('/api/local-editor/transcribe', expect.objectContaining({ method: 'POST' }));
    expect(screen.getByRole('button', { name: 'Undo', exact: true })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }));
    expect(screen.queryByText('Generated caption')).not.toBeInTheDocument();
});
```

Also add a failure test asserting an error message leaves existing subtitle text visible, and a replacement test asserting `window.confirm('Replace the current subtitle track?')` is requested before generation when cues already exist.

- [ ] **Step 2: Run the focused editor tests and verify the expected red failure**

Run:

```powershell
cd dashboard
npm test -- --run src/components/local-editor/LocalEditorTab.test.jsx
```

Expected: the new tests fail because the generation control and request handler are absent.

- [ ] **Step 3: Implement generation state and cue normalization**

Add a `generatingSubtitles` state to `LocalEditorTab`. Add a request handler that:

```jsx
const generateSubtitles = async () => {
    if (subtitleCues.length && !window.confirm('Replace the current subtitle track?')) return;
    setGeneratingSubtitles(true);
    setError('');
    try {
        const formData = new FormData();
        formData.append('file', videoFile, videoFile.name);
        const response = await fetch('/api/local-editor/transcribe', { method: 'POST', body: formData });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.detail || 'Could not generate subtitles.');
        const generatedCues = (payload.segments || []).map((segment, index) => clampCue({
            id: `generated-${Date.now()}-${index}`,
            type: 'subtitle',
            label: String(segment.text || '').trim(),
            text: String(segment.text || '').trim(),
            startMs: Number(segment.start) * 1000,
            endMs: Number(segment.end) * 1000,
        }, durationMs)).filter((cue) => cue.text && cue.endMs > cue.startMs);
        if (!generatedCues.length) throw new Error('No speech was detected in this video.');
        commitEdit((current) => ({ ...current, subtitleCues: generatedCues }));
        setSelected(null);
        setSubtitlesOpen(true);
    } catch (generationError) {
        setError(generationError.message || 'Could not generate subtitles.');
    } finally {
        setGeneratingSubtitles(false);
    }
};
```

Use the existing `getApiUrl` helper instead of hard-coding the path if the editor currently imports it; otherwise add the import. Keep `subtitleStyle` untouched and do not clear cues until a valid response is ready.

- [ ] **Step 4: Add the generation control beside Import subtitles**

Inside the expanded Subtitles panel, add a button with accessible name `Generate subtitles`, disabled while `generatingSubtitles`, showing a spinner and `Transcribing…` while active. Keep the existing Import button and the new bottom-positioned Remove Subtitles danger button.

- [ ] **Step 5: Run the focused editor tests and verify green**

Run:

```powershell
npm test -- --run src/components/local-editor/LocalEditorTab.test.jsx
```

Expected: all LocalEditorTab tests pass, including generated-cue Undo, replacement confirmation, and error preservation.

- [ ] **Step 6: Commit the editor generation flow**

```powershell
git add dashboard/src/components/local-editor/LocalEditorTab.jsx dashboard/src/components/local-editor/LocalEditorTab.test.jsx
git commit -m "feat: generate subtitles in local editor"
```

### Task 3: Verify the integrated feature and deploy

**Files:**
- Modify: none unless verification exposes an implementation defect

- [ ] **Step 1: Run backend tests**

```powershell
pytest -q
```

Expected: all Python tests pass.

- [ ] **Step 2: Run frontend tests, lint, and build**

```powershell
cd dashboard
npm test -- --run
npm run lint
npm run build
```

Expected: all tests pass, lint exits 0, and Vite produces a production build.

- [ ] **Step 3: Check the final diff**

```powershell
cd ..
git diff --check HEAD~2..HEAD
git status --short
```

Expected: no whitespace errors and no uncommitted changes.

- [ ] **Step 4: Deploy to the local cluster**

```powershell
.\scripts\deploy-local.ps1
```

Expected: backend and frontend rollouts complete successfully.

- [ ] **Step 5: Verify the deployed editor route and workloads**

```powershell
kubectl get deployment -n openshorts
kubectl get pods -n openshorts
$headers = @{ Host = 'openshorts.127.0.0.1.nip.io'; Accept = 'text/html' }
(Invoke-WebRequest -UseBasicParsing -Headers $headers -Uri 'http://localhost/editor').StatusCode
```

Expected: deployments report `1/1`, active pods are Running, and `/editor` returns HTTP 200.

