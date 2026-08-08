# OpenAI Codex (ChatGPT) Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an installation-scoped OpenAI Codex provider that authenticates through ChatGPT device authorization and routes OpenShorts AI requests through the Codex Responses transport.

**Architecture:** Keep OAuth credentials and pending device transactions in a focused Python module. Expose short-lived backend endpoints for connect, poll, status, and disconnect; the browser receives only the verification URL, user code, and sanitized status. Extend the existing `AIConfig`/`chat_completion` boundary with an `openai-codex` branch using the Codex Responses SSE endpoint, while keeping Gemini and LM Studio paths unchanged.

**Tech Stack:** Python 3.11+, FastAPI, `httpx`, JSON/SSE parsing, React 18, Vite, Vitest, React Testing Library, Python `unittest`.

---

## File map

- Create `codex_auth.py`: device-code lifecycle, token exchange/refresh, installation-local credential storage, and sanitized status.
- Create `tests/test_codex_auth.py`: deterministic tests for storage, device login, refresh, and secret redaction.
- Modify `ai_client.py`: add `openai-codex` provider normalization and Codex Responses transport.
- Create `tests/test_ai_client_codex.py`: provider config, request headers/body, SSE output extraction, refresh, and auth errors.
- Modify `app.py`: expose Codex auth endpoints and allow the provider through `build_ai_config`.
- Create `tests/test_app_codex.py`: endpoint contracts and provider validation using fake auth/transport collaborators.
- Create `dashboard/src/lib/openaiCodex.js`: frontend API helpers and status labels.
- Create `dashboard/src/lib/openaiCodex.test.js`: helper behavior and sanitized UI state mapping.
- Modify `dashboard/src/lib/lmStudio.js`: include the always-available `openai-codex` provider option.
- Modify `dashboard/src/lib/lmStudio.test.js`: preserve existing provider order and assert Codex availability.
- Modify `dashboard/src/components/AISettingsPanel.jsx`: render the Codex connect/disconnect state and Codex model controls.
- Modify `dashboard/src/components/AISettingsPanel.test.jsx`: cover disconnected, pending, connected, and reconnect-required states.
- Modify `dashboard/src/App.jsx`: load status, start/poll/disconnect the device flow, persist provider selection, and omit API-key headers for Codex.
- Modify `dashboard/src/components/ProcessingAnimation.jsx`: display `CODEX` rather than labeling every non-Gemini provider as Ollama.
- Modify `.gitignore`: exclude the installation-scoped Codex credential file/directory.
- Modify `.env.example` and `README.md`: document optional Codex storage/model configuration and the no-API-key connection flow.

## Task 1: Add the credential store and device-code lifecycle

**Files:**
- Create: `codex_auth.py`
- Test: `tests/test_codex_auth.py`
- Modify: `.gitignore`

- [ ] **Step 1: Write the failing storage tests**

Add tests for the public module surface:

```python
def test_save_and_load_credentials_round_trip_without_exposing_status_secrets(tmp_path):
    store = CodexCredentialStore(tmp_path / "codex-auth.json")
    store.save(CodexCredentials(
        access_token="access",
        refresh_token="refresh",
        id_token="id",
        account_id="account",
        expires_at=4_000_000_000,
    ))

    assert store.load().refresh_token == "refresh"
    assert store.status() == {"connected": True, "pending": False}
    assert "access" not in json.dumps(store.status())


def test_atomic_refresh_preserves_old_refresh_token_when_response_omits_it(tmp_path):
    store = CodexCredentialStore(tmp_path / "codex-auth.json")
    store.save(CodexCredentials("old-access", "old-refresh", "id", "account", 0))

    store.update_access_token("new-access", expires_at=4_000_000_000)

    saved = store.load()
    assert saved.access_token == "new-access"
    assert saved.refresh_token == "old-refresh"


def test_disconnect_removes_credentials(tmp_path):
    store = CodexCredentialStore(tmp_path / "codex-auth.json")
    store.save(CodexCredentials("access", "refresh", "id", "account", 4_000_000_000))

    store.clear()

    assert store.load() is None
    assert store.status() == {"connected": False, "pending": False}
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `python -m pytest tests/test_codex_auth.py -q`

Expected: collection/import failure because `codex_auth.py` and its credential types do not exist yet.

- [ ] **Step 3: Implement the minimal credential store**

Implement:

```python
@dataclass
class CodexCredentials:
    access_token: str
    refresh_token: str
    id_token: str
    account_id: str
    expires_at: float


class CodexCredentialStore:
    def __init__(self, path: Path): ...
    def load(self) -> Optional[CodexCredentials]: ...
    def save(self, credentials: CodexCredentials) -> None: ...
    def update_access_token(self, access_token: str, *, expires_at: float, refresh_token: Optional[str] = None, id_token: Optional[str] = None) -> None: ...
    def clear(self) -> None: ...
    def status(self) -> dict[str, bool]: ...
```

Use a sibling temporary file plus `os.replace` for atomic writes. Apply best-effort mode `0o600` on POSIX. Resolve the default path from `OPENSHORTS_CODEX_AUTH_FILE`, falling back to `.openshorts/codex-auth.json`. Add `.openshorts/` and the override filename pattern to `.gitignore`.

- [ ] **Step 4: Run the storage tests to verify they pass**

Run: `python -m pytest tests/test_codex_auth.py -q`

Expected: the three storage tests pass.

- [ ] **Step 5: Write the failing device authorization tests**

Add a fake HTTP client test for the current Codex device flow:

```python
@patch("codex_auth.httpx.Client", FakeCodexAuthClient)
def test_start_device_login_returns_sanitized_verification_details():
    result = start_device_login()

    assert result["verificationUrl"] == "https://auth.openai.com/codex/device"
    assert result["userCode"] == "ABCD-EFGH"
    assert result["intervalSeconds"] == 5
    assert "device_auth_id" not in result
```

Also cover a pending poll, successful poll plus authorization-code exchange, a rotated refresh token, and a 401 refresh response that clears the credential and raises `CodexReauthRequired`.

- [ ] **Step 6: Run the auth tests to verify the new tests fail**

Run: `python -m pytest tests/test_codex_auth.py -q`

Expected: failures for missing device-flow functions and refresh behavior.

- [ ] **Step 7: Implement the device-code and refresh lifecycle**

Use these current Codex endpoints and values:

```python
CODEX_AUTH_BASE_URL = "https://auth.openai.com"
CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
DEVICE_USERCODE_URL = f"{CODEX_AUTH_BASE_URL}/api/accounts/deviceauth/usercode"
DEVICE_TOKEN_URL = f"{CODEX_AUTH_BASE_URL}/api/accounts/deviceauth/token"
OAUTH_TOKEN_URL = f"{CODEX_AUTH_BASE_URL}/oauth/token"
DEVICE_VERIFICATION_URL = f"{CODEX_AUTH_BASE_URL}/codex/device"
DEVICE_REDIRECT_URI = f"{CODEX_AUTH_BASE_URL}/deviceauth/callback"
```

Implement:

```python
def start_device_login(*, client: httpx.Client | None = None) -> dict[str, Any]: ...
def poll_device_login(pending: PendingDeviceLogin, *, client: httpx.Client | None = None) -> PollResult: ...
def refresh_credentials(store: CodexCredentialStore, *, client: httpx.Client | None = None) -> CodexCredentials: ...
def get_access_token(store: CodexCredentialStore, *, client: httpx.Client | None = None) -> str: ...
```

`start_device_login` posts `{"client_id": CODEX_CLIENT_ID}` and holds the internal `device_auth_id` only in the backend pending state. `poll_device_login` posts `device_auth_id` and `user_code`; HTTP 403/404 means pending until 15 minutes, while success returns `authorization_code`, `code_verifier`, and exchanges them at `/oauth/token` with `grant_type=authorization_code`. Parse the access-token JWT payload only to obtain `exp` and `https://api.openai.com/auth.chatgpt_account_id`/`chatgpt_account_id`; never log the token or raw response. Refresh with `grant_type=refresh_token`, preserve the old refresh token if the response omits a replacement, and atomically save the updated credential.

- [ ] **Step 8: Run the complete auth test file**

Run: `python -m pytest tests/test_codex_auth.py -q`

Expected: all credential, device-flow, refresh, timeout, and sanitization tests pass.

- [ ] **Step 9: Commit the auth unit**

Run:

```bash
git add codex_auth.py tests/test_codex_auth.py .gitignore
git commit -m "feat: add Codex OAuth credential lifecycle"
```

## Task 2: Add the Codex Responses provider transport

**Files:**
- Modify: `ai_client.py`
- Test: `tests/test_ai_client_codex.py`

- [ ] **Step 1: Write the failing provider/config tests**

Add tests that assert `load_ai_config({"X-AI-Provider": "openai-codex"})` preserves that provider, that `AIConfig.is_openai_codex()` is true, and that an unsupported provider still raises `ValueError`.

- [ ] **Step 2: Run the tests to verify failure**

Run: `python -m pytest tests/test_ai_client_codex.py -q`

Expected: failure because `is_openai_codex` and the provider branch do not exist.

- [ ] **Step 3: Implement provider normalization**

Add `CODEX_DEFAULT_MODEL = os.environ.get("CODEX_MODEL", "gpt-5.4")`, `AIConfig.is_openai_codex()`, and the `openai-codex` branch in `chat_completion`. Treat empty/`auto` model values as `CODEX_DEFAULT_MODEL`; do not read browser cookies or accept `X-Gemini-Key` as Codex auth.

- [ ] **Step 4: Write the failing transport test**

Use a fake credential store and fake streaming response to assert the request is sent to `/backend-api/codex/responses` with the Codex-specific headers and aggregates SSE text deltas:

```python
def test_codex_transport_aggregates_response_output_text_deltas(monkeypatch):
    config = ai_client.AIConfig(provider="openai-codex", text_model="auto")
    monkeypatch.setattr(ai_client, "get_access_token", lambda: "access")
    monkeypatch.setattr(ai_client, "get_codex_account_id", lambda: "account")
    fake = FakeCodexStreamClient([
        'data: {"type":"response.output_text.delta","delta":"{\\"clips\\":"}',
        'data: {"type":"response.output_text.delta","delta":"[]}"}',
        "data: [DONE]",
    ])
    monkeypatch.setattr(ai_client.httpx, "Client", lambda **kwargs: fake)

    result = ai_client.chat_completion(config, "Return JSON", json_mode=True)

    assert result == '{"clips":[]}'
    assert fake.url == "https://chatgpt.com/backend-api/codex/responses"
    assert fake.headers["Authorization"] == "Bearer access"
    assert fake.headers["ChatGPT-Account-ID"] == "account"
    assert fake.payload["model"] == ai_client.CODEX_DEFAULT_MODEL
    assert fake.payload["stream"] is True
    assert fake.payload["store"] is False
```

- [ ] **Step 5: Run the transport test to verify failure**

Run: `python -m pytest tests/test_ai_client_codex.py -q`

Expected: failure because the Codex transport and SSE parser do not exist.

- [ ] **Step 6: Implement the minimal Codex Responses transport**

Implement `_codex_chat` and `_extract_codex_sse_text` in `ai_client.py`:

- Resolve the access token through `codex_auth.get_access_token`.
- Send `POST https://chatgpt.com/backend-api/codex/responses` with `Authorization`, `ChatGPT-Account-ID`, `originator: openshorts`, `Version: openshorts/0.1`, `session_id`, and `x-client-request-id` headers.
- Send `model`, `input`, `stream: true`, `store: false`, and `include: ["reasoning.encrypted_content"]`.
- Map `system_prompt` to `instructions` only when provided; otherwise omit it.
- Map text to a Responses input message and images to `input_image` data URLs.
- Aggregate only `response.output_text.delta` events and ignore lifecycle/reasoning events.
- Raise a provider-specific auth error for 401/403 and an actionable `RuntimeError` for malformed streams or empty output.

Keep the existing Gemini and LM Studio branches unchanged except for the provider dispatch.

- [ ] **Step 7: Add refresh-on-401 coverage and implementation**

Write a test where the first request returns 401, the credential refresh returns a new access token, and the second request succeeds. Implement exactly one refresh/retry; a second auth failure raises `CodexReauthRequired` without a provider fallback.

- [ ] **Step 8: Run focused and regression tests**

Run: `python -m pytest tests/test_ai_client_codex.py tests/test_ai_client_lmstudio.py -q`

Expected: all Codex and LM Studio tests pass.

- [ ] **Step 9: Commit the transport unit**

Run:

```bash
git add ai_client.py tests/test_ai_client_codex.py
git commit -m "feat: route AI requests through Codex Responses"
```

## Task 3: Expose backend connection endpoints

**Files:**
- Modify: `app.py`
- Test: `tests/test_app_codex.py`
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Write failing endpoint contract tests**

Cover:

```python
def test_codex_status_is_sanitized(client, tmp_path):
    response = client.get("/api/ai/openai-codex/status")
    assert response.status_code == 200
    assert response.json() == {"connected": False, "pending": False}


def test_codex_connect_returns_verification_url_and_code_only(client):
    response = client.post("/api/ai/openai-codex/connect")
    assert response.status_code == 200
    assert response.json() == {
        "status": "pending",
        "verificationUrl": "https://auth.openai.com/codex/device",
        "userCode": "ABCD-EFGH",
        "intervalSeconds": 5,
    }


def test_codex_disconnect_clears_credentials(client):
    response = client.post("/api/ai/openai-codex/disconnect")
    assert response.status_code == 200
    assert response.json() == {"connected": False, "pending": False}
```

Assert the connect/poll responses never contain `device_auth_id`, `access_token`, `refresh_token`, or `id_token`. Add a test that `build_ai_config(provider="openai-codex")` succeeds without an API key while Gemini still rejects a missing key.

- [ ] **Step 2: Run endpoint tests to verify failure**

Run: `python -m pytest tests/test_app_codex.py -q`

Expected: 404s or import failures because the endpoints and pending state do not exist.

- [ ] **Step 3: Implement backend endpoints and pending state**

Add a module-level `codex_pending_login` guarded by a lock and these FastAPI routes:

- `GET /api/ai/openai-codex/status`
- `POST /api/ai/openai-codex/connect`
- `POST /api/ai/openai-codex/poll`
- `POST /api/ai/openai-codex/disconnect`

Use `default_codex_store()` from `codex_auth.py`. `connect` starts a transaction and stores its private polling fields only in backend memory. `poll` advances it and persists credentials on success. Clear pending state on success, cancellation, expiry, or terminal error. Return `HTTPException` messages without upstream token bodies.

Update `build_ai_config` to require a base URL only for LM Studio and to leave Codex credential resolution to `chat_completion`.

- [ ] **Step 4: Run endpoint tests to verify they pass**

Run: `python -m pytest tests/test_app_codex.py -q`

Expected: all endpoint and config-contract tests pass.

- [ ] **Step 5: Update configuration and user documentation**

Document `OPENSHORTS_CODEX_AUTH_FILE` and `CODEX_MODEL` in `.env.example`, add Codex to the provider table in `README.md`, and explain that connection uses ChatGPT Codex device authorization rather than an OpenAI API key. State that the credential file must be protected and is excluded from git.

- [ ] **Step 6: Run backend regression tests**

Run: `python -m pytest tests -q`

Expected: all existing backend tests plus the new Codex tests pass.

- [ ] **Step 7: Commit the backend API unit**

Run:

```bash
git add app.py tests/test_app_codex.py .env.example README.md
git commit -m "feat: add Codex connection endpoints"
```

## Task 4: Add dashboard provider and connection UX

**Files:**
- Create: `dashboard/src/lib/openaiCodex.js`
- Test: `dashboard/src/lib/openaiCodex.test.js`
- Modify: `dashboard/src/lib/lmStudio.js`
- Modify: `dashboard/src/lib/lmStudio.test.js`
- Modify: `dashboard/src/components/AISettingsPanel.jsx`
- Modify: `dashboard/src/components/AISettingsPanel.test.jsx`
- Modify: `dashboard/src/App.jsx`
- Modify: `dashboard/src/components/ProcessingAnimation.jsx`

- [ ] **Step 1: Write failing frontend helper/provider tests**

Add tests for:

```javascript
it('keeps Gemini and LM Studio and adds Codex as a visible provider', () => {
  expect(buildVisibleProviders({ lmStudioAvailable: false })).toEqual([
    'gemini',
    'lmstudio',
    'openai-codex',
  ]);
});

it('maps connected status without exposing credential fields', () => {
  expect(normalizeCodexStatus({ connected: true, pending: false })).toEqual({
    connected: true,
    pending: false,
    requiresReconnect: false,
  });
});
```

Add component tests asserting Codex renders `Connect ChatGPT`, then `Connecting...` with the user code, then `Disconnect ChatGPT` when connected. Assert the API/access-key input and image-generation selector are absent for Codex.

- [ ] **Step 2: Run frontend tests to verify failure**

Run: `npm test -- --run dashboard/src/lib/lmStudio.test.js dashboard/src/components/AISettingsPanel.test.jsx`

Expected: failures because the provider option, helper, props, and UI state do not exist.

- [ ] **Step 3: Implement provider helpers and component states**

Add `openaiCodex.js` functions:

```javascript
export const normalizeCodexStatus = (status = {}) => ({
  connected: status.connected === true,
  pending: status.pending === true,
  requiresReconnect: status.requiresReconnect === true,
});

export const codexStatusLabel = ({ connected, pending, requiresReconnect }) => {
  if (pending) return 'Connecting...';
  if (requiresReconnect) return 'Reconnect ChatGPT';
  if (connected) return 'Connected to ChatGPT';
  return 'Not connected';
};
```

Add `openai-codex` to `buildVisibleProviders`. Extend `AISettingsPanel` props with `codexStatus`, `codexPending`, `codexError`, `onConnectCodex`, and `onDisconnectCodex`. Render provider-specific controls and `Auto (Codex default)` for text/analysis/vision; set image generation to none.

- [ ] **Step 4: Run frontend tests to verify they pass**

Run: `npm test -- --run dashboard/src/lib/lmStudio.test.js dashboard/src/components/AISettingsPanel.test.jsx`

Expected: all focused provider and settings-panel tests pass.

- [ ] **Step 5: Implement App connection lifecycle**

In `dashboard/src/App.jsx`:

- Load `/api/ai/openai-codex/status` on mount.
- Add `connectCodex`, `pollCodex`, and `disconnectCodex` callbacks using `getApiUrl`.
- Open `verificationUrl` in a new tab after a successful connect response.
- Poll every two seconds while pending and clear the interval on success, timeout, unmount, or error.
- Set `aiProvider` to `openai-codex` only after the user selects it; do not auto-switch from another provider on connection failure.
- Change `isLocalAi` to `aiProvider === 'lmstudio'` so Codex is treated as a cloud provider in existing warnings.
- Do not send `X-AI-Api-Key` when `aiProvider === 'openai-codex'`.
- Pass connection state and handlers to `AISettingsPanel`.

Update `ProcessingAnimation` to use `CODEX` for `openai-codex` and preserve `GEMINI`/`OLLAMA` labels for existing providers.

- [ ] **Step 6: Run all frontend tests and build**

Run:

```bash
npm test -- --run
npm run lint
npm run build
```

Expected: zero test failures, zero lint errors/warnings, and a successful Vite build.

- [ ] **Step 7: Commit the dashboard unit**

Run:

```bash
git add dashboard/src/lib/openaiCodex.js dashboard/src/lib/openaiCodex.test.js dashboard/src/lib/lmStudio.js dashboard/src/lib/lmStudio.test.js dashboard/src/components/AISettingsPanel.jsx dashboard/src/components/AISettingsPanel.test.jsx dashboard/src/App.jsx dashboard/src/components/ProcessingAnimation.jsx
git commit -m "feat: add Codex provider connection UI"
```

## Task 5: Full verification and handoff

**Files:**
- No new source files; inspect all changed files and git diff.

- [ ] **Step 1: Run the complete backend suite**

Run: `python -m pytest tests -q`

Expected: exit code 0 with zero failures.

- [ ] **Step 2: Run the complete dashboard suite, lint, and build**

Run from `dashboard`:

```bash
npm test -- --run
npm run lint
npm run build
```

Expected: exit code 0 for every command.

- [ ] **Step 3: Inspect the final diff and secret-safety boundary**

Run:

```bash
git diff --check HEAD~4..HEAD
git status --short
rg -n "access_token|refresh_token|id_token|device_auth_id" codex_auth.py app.py ai_client.py dashboard/src --glob '!*.test.*'
```

Expected: credential names occur only in backend storage/transport code; no token values or auth responses are logged or sent to dashboard status responses; the worktree contains only intended changes.

- [ ] **Step 4: Run a local smoke test without credentials**

Start the existing backend and dashboard development flow, open Settings, select `OpenAI Codex (ChatGPT)`, and verify the disconnected state renders. Do not enter or persist real credentials during automated verification. If the user chooses to connect manually afterward, the UI should show the verification URL and code and the backend should transition to connected only after the authorization exchange succeeds.

- [ ] **Step 5: Report evidence and limitations**

Report exact test/lint/build results, changed files, and the fact that the provider depends on the current Codex device-auth and Responses backend contract. Do not claim a real ChatGPT connection was tested unless the user authorizes and completes that interactive flow.
