# Editor Hashtag Generation Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add an AI-powered hashtag generator to the editor's left clip-metadata sidebar and persist generated hashtags in saved version manifests.

**Architecture:** Add a provider-agnostic FastAPI endpoint that receives title, caption, and current subtitle text and calls the existing chat_json abstraction. The sidebar owns generation interaction, LocalEditorTab supplies live subtitle cues, and FullScreenEditor owns saved-version metadata state and writes publishing_metadata.hashtags into the manifest.

**Tech Stack:** FastAPI/Pydantic, Python chat_json AI client, React, Vitest, Testing Library, and Kubernetes local deployment.

---

## File map

- Create tests/test_local_editor_hashtags_api.py.
- Modify app.py for the request model, normalization helper, and POST /api/local-editor/hashtags.
- Create dashboard/src/components/local-editor/localEditorAi.js and its test.
- Modify ClipMetadataPanel.jsx and ClipMetadataPanel.test.jsx.
- Modify LocalEditorTab.jsx and LocalEditorTab.test.jsx.
- Modify FullScreenEditor.jsx and FullScreenEditor.test.jsx.

Implementation stays inline on the existing main checkout. Do not create a worktree or stage unrelated changes.

### Task 1: Add the backend hashtag-generation endpoint

Files:
- Create tests/test_local_editor_hashtags_api.py.
- Modify app.py near the existing local-editor routes.

- [ ] Step 1: Write failing API tests.

Use TestClient and monkeypatch app_module.chat_json:

~~~python
def test_generates_normalized_hashtags_from_clip_context(monkeypatch):
    seen = {}

    def fake_chat_json(config, prompt, **kwargs):
        seen["prompt"] = prompt
        return {"hashtags": ["#Gaming", "gaming", "#Juan Guarnizo", "#viral"] + [f"tag{i}" for i in range(20)]}

    monkeypatch.setattr(app_module, "chat_json", fake_chat_json)
    response = TestClient(app_module.app).post(
        "/api/local-editor/hashtags",
        headers={"X-AI-Provider": "lmstudio", "X-AI-Base-Url": "http://lmstudio.test"},
        json={"title": "Mi clip", "caption": "Una historia inesperada", "subtitle_text": "La conversación completa del clip"},
    )

    assert response.status_code == 200
    tags = response.json()["hashtags"]
    assert tags[0] == "#Gaming"
    assert sum(tag.casefold() == "#gaming" for tag in tags) == 1
    assert "#JuanGuarnizo" in tags
    assert len(tags) == 12
    assert "Mi clip" in seen["prompt"]
    assert "La conversación completa del clip" in seen["prompt"]


def test_rejects_empty_clip_context(monkeypatch):
    calls = {"count": 0}

    def fake_chat_json(*args, **kwargs):
        calls["count"] += 1
        return {"hashtags": ["#unused"]}

    monkeypatch.setattr(app_module, "chat_json", fake_chat_json)
    response = TestClient(app_module.app).post(
        "/api/local-editor/hashtags",
        headers={"X-AI-Provider": "lmstudio", "X-AI-Base-Url": "http://lmstudio.test"},
        json={"title": "", "caption": "", "subtitle_text": ""},
    )

    assert response.status_code == 400
    assert "context" in response.json()["detail"].lower()
    assert calls["count"] == 0


def test_returns_provider_failure_as_safe_http_error(monkeypatch):
    def failing_chat_json(*args, **kwargs):
        raise ValueError("provider unavailable")

    monkeypatch.setattr(app_module, "chat_json", failing_chat_json)
    response = TestClient(app_module.app).post(
        "/api/local-editor/hashtags",
        headers={"X-AI-Provider": "lmstudio", "X-AI-Base-Url": "http://lmstudio.test"},
        json={"title": "Mi clip", "caption": "Caption", "subtitle_text": "Subtitle"},
    )

    assert response.status_code == 502
    assert "hashtag" in response.json()["detail"].lower()
~~~

- [ ] Step 2: Run the API tests and verify red.

Run: pytest tests/test_local_editor_hashtags_api.py -q

Expected: collection or assertion failures because the request model and route do not exist.

- [ ] Step 3: Implement validation and normalization.

Add to app.py:

~~~python
class LocalEditorHashtagRequest(BaseModel):
    title: str = ""
    caption: str = ""
    subtitle_text: str = ""


def normalize_generated_hashtags(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    normalized = []
    seen = set()
    for item in value:
        tag = re.sub(r"^#+", "", str(item or "").strip())
        tag = re.sub(r"\s+", "", tag)
        tag = re.sub(r"[^\wÀ-ÖØ-öø-ÿ-]", "", tag, flags=re.UNICODE)
        if not tag or tag.casefold() in seen:
            continue
        seen.add(tag.casefold())
        normalized.append(f"#{tag}")
        if len(normalized) == 12:
            break
    return normalized
~~~

- [ ] Step 4: Implement POST /api/local-editor/hashtags.

Build the AI config from the same X-AI headers used by translation. Run synchronous chat_json in a worker, require a JSON object with a hashtags array, normalize it, and return HTTP 502 for provider or malformed-response failures. The prompt must include title, caption, and current edited subtitle transcript, request 8 to 12 tags in the source language, and forbid explanations or duplicates.

If the resolved provider is Gemini and no API key is configured, return the same clear 400 missing-key error used by the existing AI endpoints before starting the worker.

The endpoint should call chat_json with:
~~~python
model=config.analyze_model or config.text_model,
reasoning_effort=config.analyze_reasoning_effort or config.reasoning_effort,
timeout=120,
~~~

- [ ] Step 5: Run pytest tests/test_local_editor_hashtags_api.py -q. Expected: all endpoint tests pass.

- [ ] Step 6: Commit only app.py and the new API test:
~~~powershell
git add app.py tests/test_local_editor_hashtags_api.py
git commit -m "feat: add local editor hashtag generation API"
~~~

### Task 2: Add the shared frontend helpers and sidebar interaction

Files:
- Create dashboard/src/components/local-editor/localEditorAi.js.
- Create dashboard/src/components/local-editor/localEditorAi.test.js.
- Modify dashboard/src/components/local-editor/ClipMetadataPanel.jsx.
- Modify dashboard/src/components/local-editor/ClipMetadataPanel.test.jsx.
- Modify dashboard/src/components/local-editor/LocalEditorTab.jsx.

- [ ] Step 1: Write failing helper tests.

~~~js
it('serializes current subtitle cues', () => {
    expect(subtitleTextFromCues([{ text: 'Hola' }, { text: 'mundo' }])).toBe('Hola mundo');
});

it('reads local AI settings', () => {
    localStorage.setItem('ai_provider_v1', 'lmstudio');
    localStorage.setItem('ai_base_url_v1', 'http://localhost:1234');
    expect(getLocalAiHeaders()).toMatchObject({
        'X-AI-Provider': 'lmstudio',
        'X-AI-Base-Url': 'http://localhost:1234',
    });
});
~~~

Run: cd dashboard; npm test -- --run src/components/local-editor/localEditorAi.test.js

Expected: module/export failures.

- [ ] Step 2: Create localEditorAi.js and move the existing getLocalAiHeaders implementation out of LocalEditorTab.jsx.

The module must export:
~~~js
export const getLocalAiHeaders = () => {
    const provider = localStorage.getItem('ai_provider_v1') || 'gemini';
    const apiKey = localStorage.getItem('gemini_key') || '';
    const headers = {
        'X-AI-Provider': provider,
        'X-AI-Model': localStorage.getItem('ai_text_model_v1') || 'auto',
        'X-AI-Analyze-Model': localStorage.getItem('ai_analyze_model_v1') || 'auto',
        'X-AI-Vision-Model': localStorage.getItem('ai_vision_model_v1') || 'auto',
        'X-AI-Image-Model': localStorage.getItem('ai_image_model_v1') || 'auto',
        'X-AI-Reasoning-Effort': localStorage.getItem('ai_text_effort_v1') || 'auto',
        'X-AI-Analyze-Reasoning-Effort': localStorage.getItem('ai_analyze_effort_v1') || 'auto',
        'X-AI-Vision-Reasoning-Effort': localStorage.getItem('ai_vision_effort_v1') || 'auto',
    };
    const baseUrl = localStorage.getItem('ai_base_url_v1');
    if (baseUrl) headers['X-AI-Base-Url'] = baseUrl;
    if (apiKey) headers[provider === 'gemini' ? 'X-Gemini-Key' : 'X-AI-Api-Key'] = apiKey;
    return headers;
};

export const subtitleTextFromCues = (cues = []) => cues
    .map((cue) => String(cue?.text || cue?.label || '').trim())
    .filter(Boolean)
    .join(' ');
~~~

Update LocalEditorTab to import the helper for existing subtitle translation.

- [ ] Step 3: Write failing ClipMetadataPanel tests.

Test successful replacement and request payload:
~~~jsx
it('replaces default hashtags using title, caption, and edited subtitles', async () => {
    const onHashtagsChange = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ hashtags: ['#gaming', '#historia', '#viral'] }),
    }));
    render(<ClipMetadataPanel clip={clip} subtitleCues={[{ text: 'Texto editado' }]} onHashtagsChange={onHashtagsChange} />);
    fireEvent.click(screen.getByRole('button', { name: /generate hashtags/i }));
    await waitFor(() => expect(onHashtagsChange).toHaveBeenCalledWith(['#gaming', '#historia', '#viral']));
    expect(screen.getByRole('group', { name: 'Hashtags' })).toHaveTextContent('#gaming');
    expect(screen.queryByText('#shorts')).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/local-editor/hashtags', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
            title: clip.video_title_for_youtube_short,
            caption: clip.video_description_for_tiktok,
            subtitle_text: 'Texto editado',
        }),
    }));
});

it('preserves existing hashtags and shows an inline error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ detail: 'Provider unavailable' }),
    }));
    render(<ClipMetadataPanel clip={clip} />);
    fireEvent.click(screen.getByRole('button', { name: /generate hashtags/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Provider unavailable'));
    expect(screen.getByRole('group', { name: 'Hashtags' })).toHaveTextContent('#shorts');
});
~~~

Run: cd dashboard; npm test -- --run src/components/local-editor/ClipMetadataPanel.test.jsx

Expected: failures because generation control and callback do not exist.

- [ ] Step 4: Implement the panel control.

Accept subtitleCues, hashtags, and onHashtagsChange. Use hashtags, then clip.hashtags, then #shorts/#viral. POST title, caption, and subtitleTextFromCues(subtitleCues) to /api/local-editor/hashtags with JSON and getLocalAiHeaders(). Disable the button with a spinner while awaiting, replace tags only after a non-empty successful response, and show a role=alert error while preserving current tags.

Synchronize the panel's displayed tags when the hashtags prop changes after a version load, and include the current tags in the panel's non-empty guard so a metadata-only saved version still renders the sidebar.

Use this core handler:
~~~jsx
const generateHashtags = async () => {
    setGeneratingHashtags(true);
    setHashtagError('');
    try {
        const response = await fetch(getApiUrl('/api/local-editor/hashtags'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getLocalAiHeaders() },
            body: JSON.stringify({ title, caption, subtitle_text: subtitleTextFromCues(subtitleCues) }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.detail || 'Could not generate hashtags.');
        const nextHashtags = Array.isArray(payload.hashtags) ? payload.hashtags : [];
        if (!nextHashtags.length) throw new Error('The AI returned no hashtags.');
        setGeneratedHashtags(nextHashtags);
        onHashtagsChange?.(nextHashtags);
    } catch (error) {
        setHashtagError(error.message || 'Could not generate hashtags.');
    } finally {
        setGeneratingHashtags(false);
    }
};
~~~

Keep the existing bordered role=group aria-label=Hashtags box and add a Generate hashtags button with Loader2/WandSparkles.

- [ ] Step 5: Run helper and panel tests:
~~~powershell
npm test -- --run src/components/local-editor/localEditorAi.test.js src/components/local-editor/ClipMetadataPanel.test.jsx
~~~
Expected: all pass.

- [ ] Step 6: Commit only the shared helper, panel, and LocalEditorTab import changes:
~~~powershell
git add dashboard/src/components/local-editor/localEditorAi.js dashboard/src/components/local-editor/localEditorAi.test.js dashboard/src/components/local-editor/ClipMetadataPanel.jsx dashboard/src/components/local-editor/ClipMetadataPanel.test.jsx dashboard/src/components/local-editor/LocalEditorTab.jsx
git commit -m "feat: add editor hashtag generation control"
~~~

### Task 3: Wire live subtitle context through LocalEditorTab

Files:
- Modify dashboard/src/components/local-editor/LocalEditorTab.jsx.
- Modify dashboard/src/components/local-editor/LocalEditorTab.test.jsx.

- [ ] Step 1: Write a failing integration test.

Render LocalEditorTab with two initialEditorState.subtitleCues, stub the initial video fetch and hashtag endpoint, click Generate hashtags, and assert the POST body contains both cue texts in order:
~~~jsx
expect(JSON.parse(fetchMock.mock.calls[1][1].body).subtitle_text)
    .toBe('Primera frase Segunda frase');
~~~

- [ ] Step 2: Add onHashtagsChange to LocalEditorTab props and render:
~~~jsx
<ClipMetadataPanel
    clip={clipMetadata}
    subtitleCues={subtitleCues}
    hashtags={clipMetadata?.hashtags}
    onHashtagsChange={onHashtagsChange}
/>
~~~
Do not change the edit-history shape.

- [ ] Step 3: Run:
~~~powershell
npm test -- --run src/components/local-editor/LocalEditorTab.test.jsx -t "uses current edited subtitle cues"
npm test -- --run src/components/local-editor/LocalEditorTab.test.jsx
~~~
Expected: both pass.

### Task 4: Persist and restore hashtags with saved versions

Files:
- Modify dashboard/src/components/editor/FullScreenEditor.jsx.
- Modify dashboard/src/components/editor/FullScreenEditor.test.jsx.

- [ ] Step 1: Write failing persistence tests.

Mock saveAndRenderVersion, render the local editor with clip title/caption and a manifest containing a subtitle cue, click Generate hashtags, click Save as new version, and assert:
~~~js
expect(saveAndRenderVersion).toHaveBeenCalledWith(expect.objectContaining({
    manifest: expect.objectContaining({
        publishing_metadata: { hashtags: ['#editedclip'] },
    }),
}));
~~~

Add a load test with initialManifest.publishing_metadata.hashtags = ['#savedtag'] and assert the sidebar displays #savedtag instead of #shorts. Run the hashtag-focused test and verify it fails.

- [ ] Step 2: Add publishingMetadata state initialized from initialManifest, then clip.hashtags, then ['#shorts', '#viral']:

~~~jsx
const [publishingMetadata, setPublishingMetadata] = useState(() => ({
    ...(initialManifest?.publishing_metadata || {}),
    hashtags: initialManifest?.publishing_metadata?.hashtags || clip.hashtags || ['#shorts', '#viral'],
}));
~~~

Whenever a hydrated manifest is installed in initial load, loadVersion, or branchVersion, set the same metadata object from hydratedManifest.publishing_metadata with the clip/default fallback.

Add publishing_metadata: publishingMetadata to currentManifest and its dependency list. Pass:
~~~jsx
clipMetadata={{ ...clip, hashtags: publishingMetadata.hashtags }}
onHashtagsChange={(hashtags) => setPublishingMetadata((current) => ({ ...current, hashtags }))}
~~~
to LocalEditorTab, and include publishingMetadata in saveVersion dependencies.

- [ ] Step 3: Run:
~~~powershell
npm test -- --run src/components/editor/FullScreenEditor.test.jsx -t hashtags
npm test -- --run src/components/editor/FullScreenEditor.test.jsx
~~~
Expected: all pass.

- [ ] Step 4: Commit:
~~~powershell
git add dashboard/src/components/editor/FullScreenEditor.jsx dashboard/src/components/editor/FullScreenEditor.test.jsx dashboard/src/components/local-editor/LocalEditorTab.test.jsx
git commit -m "feat: persist generated editor hashtags"
~~~

### Task 5: Full verification and local-cluster deployment

Files: no planned source changes; preserve unrelated working-tree files.

- [ ] Step 1: Run pytest -q. Expected: all Python tests pass.

- [ ] Step 2: Run dashboard tests, build, and touched-file lint:
~~~powershell
cd dashboard
npm test
npm run build
npx eslint src/components/local-editor/localEditorAi.js src/components/local-editor/localEditorAi.test.js src/components/local-editor/ClipMetadataPanel.jsx src/components/local-editor/ClipMetadataPanel.test.jsx src/components/local-editor/LocalEditorTab.jsx src/components/local-editor/LocalEditorTab.test.jsx src/components/editor/FullScreenEditor.jsx src/components/editor/FullScreenEditor.test.jsx
~~~
Expected: all existing and new tests pass, build succeeds, and touched files have no lint errors. Report existing Mediabunny, Browserslist, large-chunk, or unrelated refresh warnings instead of changing them.

- [ ] Step 3: Inspect:
~~~powershell
cd ..
git status --short
git diff --check
git log -5 --oneline
~~~
Expected: only intended feature files are changed and no unrelated files are staged.

- [ ] Step 4: Deploy with .\scripts\deploy-local.ps1. Expected: local images build, all four deployments roll out, and the script prints Local deploy completed successfully.

- [ ] Step 5: Verify:
~~~powershell
kubectl get pods -n openshorts
$source = curl.exe -s http://openshorts.127.0.0.1.nip.io/src/components/local-editor/ClipMetadataPanel.jsx
if ($source -notmatch 'Generate hashtags') { throw 'Deployed frontend does not contain hashtag generation.' }
~~~
Open the project URL, refresh, generate tags, save a new version, and reopen it to confirm persistence.

- [ ] Step 6: Report implementation commits, verification results, local URL, and any pre-existing warnings accurately. Do not claim production deployment.
