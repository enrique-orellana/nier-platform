# Codex Browser Model Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users select a Codex model in the browser from the models available to the connected ChatGPT account.

**Architecture:** The backend will call Codex’s authenticated model catalog endpoint with the stored ChatGPT credential, normalize only usable model records, and expose a sanitized `/api/ai/openai-codex/models` response. The dashboard will fetch that catalog after connection, populate the existing text/analysis/vision selectors, retain `Auto` as a fallback, and persist the user’s selection through the existing model headers.

**Tech Stack:** FastAPI, httpx, pytest, React, Vitest, Testing Library.

---

### Task 1: Add tested Codex model discovery and normalization

**Files:**
- Modify: `ai_client.py`
- Test: `tests/test_ai_client_codex.py`

- [x] **Step 1: Write the failing tests**

Add tests that fake the Codex catalog response and require the discovery function to:

```python
def test_codex_model_discovery_normalizes_available_models(monkeypatch):
    FakeCodexCatalogClient.responses = [FakeCodexCatalogResponse(200, {
        "models": [
            {"slug": "gpt-5.4", "title": "GPT-5.4", "input_modalities": ["text", "image"], "visibility": "list"},
            {"id": "hidden-model", "display_name": "Hidden", "visibility": "hidden"},
            {"slug": "", "title": "Invalid"},
        ],
        "default_model": "gpt-5.4",
    })]

    result = ai_client.discover_codex_models()

    assert result == {
        "models": [{
            "id": "gpt-5.4",
            "label": "GPT-5.4",
            "supportsVision": True,
        }],
        "defaultModel": "gpt-5.4",
    }


def test_codex_model_discovery_refreshes_once_after_auth_rejection(monkeypatch):
    FakeCodexCatalogClient.responses = [
        FakeCodexCatalogResponse(401, {}),
        FakeCodexCatalogResponse(200, {"models": [{"slug": "gpt-5.4"}]}),
    ]
    refreshes = []

    result = ai_client.discover_codex_models(refresh_credentials_fn=lambda store: refreshes.append(store))

    assert result["models"][0]["id"] == "gpt-5.4"
    assert len(refreshes) == 1
```

Extend the existing fake client/response only as needed to capture the request URL and headers. Use a dependency parameter or monkeypatch so tests never require real credentials or network access.

- [x] **Step 2: Run the focused tests and verify the expected failure**

Run: `python -m pytest tests/test_ai_client_codex.py -q`

Expected: FAIL because `discover_codex_models` does not exist yet.

- [x] **Step 3: Implement the minimal discovery function**

In `ai_client.py`:

- Add a `CODEX_MODELS_URL` constant for `https://chatgpt.com/backend-api/codex/models`.
- Build the same bearer/account/originator/version headers used by `_codex_chat`.
- Fetch the catalog with a bounded timeout.
- On a 401/403, refresh credentials once and retry with the new token.
- Accept model IDs from `slug`, `id`, `model`, or `name`; accept labels from `title`, `display_name`, `displayName`, or the ID.
- Skip records with no ID and records explicitly marked hidden/private/unavailable.
- Return only `id`, `label`, and `supportsVision`, plus `defaultModel` when the catalog identifies one.

- [x] **Step 4: Run the focused tests and verify they pass**

Run: `python -m pytest tests/test_ai_client_codex.py -q`

Expected: all Codex client tests pass.

### Task 2: Expose the sanitized catalog through FastAPI

**Files:**
- Modify: `app.py`
- Test: `tests/test_app_codex.py`

- [x] **Step 1: Write the failing endpoint test**

Add a test that patches `app_module.discover_codex_models` and verifies:

```python
def test_codex_models_returns_account_available_models(monkeypatch):
    monkeypatch.setattr(app_module, "discover_codex_models", lambda: {
        "models": [{"id": "gpt-5.4", "label": "GPT-5.4", "supportsVision": True}],
        "defaultModel": "gpt-5.4",
    })

    response = TestClient(app_module.app).get("/api/ai/openai-codex/models")

    assert response.status_code == 200
    assert response.json() == {
        "provider": "openai-codex",
        "models": [{"id": "gpt-5.4", "label": "GPT-5.4", "supportsVision": True}],
        "defaultModel": "gpt-5.4",
    }
```

Also test that a disconnected account receives a non-success response with a safe error message and no credential fields.

- [x] **Step 2: Run the endpoint tests and verify the expected failure**

Run: `python -m pytest tests/test_app_codex.py -q`

Expected: FAIL because the route and imported discovery function do not exist.

- [x] **Step 3: Implement the endpoint**

Import `discover_codex_models`, add `GET /api/ai/openai-codex/models`, and return the normalized catalog only. Translate `CodexReauthRequired` to HTTP 401 and other upstream/auth failures to HTTP 502 with a short user-facing detail string.

- [x] **Step 4: Run the endpoint tests and verify they pass**

Run: `python -m pytest tests/test_app_codex.py -q`

Expected: all Codex endpoint tests pass.

### Task 3: Add browser model state and selectors

**Files:**
- Modify: `dashboard/src/lib/openaiCodex.js`
- Test: `dashboard/src/lib/openaiCodex.test.js`
- Modify: `dashboard/src/components/AISettingsPanel.jsx`
- Test: `dashboard/src/components/AISettingsPanel.test.jsx`
- Modify: `dashboard/src/App.jsx`

- [x] **Step 1: Write failing helper and component tests**

Add helper tests requiring model normalization to retain valid IDs, labels, and vision capability, and component tests requiring connected Codex to render account models in the Text Model selector and call the model refresh handler.

- [x] **Step 2: Run the focused dashboard tests and verify the expected failure**

Run: `npm --prefix dashboard test -- --run dashboard/src/lib/openaiCodex.test.js dashboard/src/components/AISettingsPanel.test.jsx`

Expected: FAIL because the model props, helper, and selector behavior do not exist.

- [x] **Step 3: Implement the minimal browser behavior**

In `App.jsx`:

- Track `{models, defaultModel, loading, error}` for Codex catalog state.
- Fetch `/api/ai/openai-codex/models` when Codex is connected and when the user clicks Refresh.
- Clear catalog state when switching away from Codex or disconnecting.
- Keep `Auto` selected when there is no catalog, when the selected ID disappears, or when discovery fails.
- Do not reset a user-selected model when a successful refresh returns the same ID.
- Pass catalog state and `onRefreshCodexModels` to `AISettingsPanel`.

In `AISettingsPanel.jsx`:

- Replace the three disabled Codex selectors with selectors populated from account models.
- Keep `Auto (Codex default)` as the first option.
- Disable model selectors while disconnected or loading.
- Render a compact `Refresh models` action and a non-secret discovery error/status message.
- Use all account models for text/analysis and only `supportsVision` models for vision; if capability metadata is absent, keep all account models selectable for vision.

- [x] **Step 4: Run focused dashboard tests and verify they pass**

Run: `npm --prefix dashboard test -- --run dashboard/src/lib/openaiCodex.test.js dashboard/src/components/AISettingsPanel.test.jsx`

Expected: all focused Codex/dashboard tests pass.

### Task 4: Verify the integrated change

**Files:**
- Modify: `docs/superpowers/plans/2026-08-08-codex-browser-model-selection.md`

- [x] **Step 1: Run backend regression tests**

Run: `python -m pytest tests/test_ai_client_codex.py tests/test_app_codex.py tests/test_codex_auth.py -q`

Expected: all selected backend tests pass.

- [x] **Step 2: Run dashboard build and focused tests**

Run: `npm --prefix dashboard test -- --run dashboard/src/lib/openaiCodex.test.js dashboard/src/components/AISettingsPanel.test.jsx`

Run: `npm --prefix dashboard run build`

Expected: tests pass and Vite exits with code 0.

- [x] **Step 3: Review the diff and mark this plan complete**

Run: `git diff --check` and `git status --short`

Confirm the diff contains no credentials, raw upstream token fields, or unrelated changes. Mark the completed checkboxes in this plan after the verification commands succeed.
