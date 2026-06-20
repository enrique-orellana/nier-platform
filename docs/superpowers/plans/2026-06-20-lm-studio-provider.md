# LM Studio Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add LM Studio as a conditional provider with native model discovery, OpenAI-compatible inference, dynamic text and vision model lists, and provider visibility that disappears when discovery fails.

**Architecture:** Keep the backend provider abstraction in `ai_client.py`, add one FastAPI discovery route in `app.py`, and expose LM Studio in the dashboard only after a successful detect call. Keep Ollama and Gemini behavior intact, and move frontend LM Studio logic into small focused helpers and a dedicated settings panel component so the giant `App.jsx` file does not absorb more stateful provider logic.

**Tech Stack:** Python 3.11, FastAPI, httpx, stdlib `unittest`, React 18, Vite 4, Vitest, Testing Library

---

## File Structure

**Backend**

- Modify: `ai_client.py`
  Responsibility: normalize provider state, discover LM Studio models, send LM Studio OpenAI-compatible chat-completions requests.
- Modify: `app.py`
  Responsibility: expose `POST /api/ai/lmstudio/discover`, validate LM Studio config for requests that need it.
- Modify: `.env.example`
  Responsibility: document LM Studio as an optional local provider path.
- Create: `tests/test_ai_client_lmstudio.py`
  Responsibility: unit-test discovery normalization and chat request shaping.
- Create: `tests/test_app_lmstudio.py`
  Responsibility: route-level tests for LM Studio discovery success and failure.

**Frontend**

- Modify: `dashboard/package.json`
  Responsibility: add `test` script and frontend test dependencies.
- Modify: `dashboard/vite.config.js`
  Responsibility: register Vitest config for jsdom.
- Create: `dashboard/src/test/setup.js`
  Responsibility: Testing Library and `jest-dom` setup.
- Create: `dashboard/src/lib/lmStudio.js`
  Responsibility: provider visibility helpers, fallback provider selection, discovery response normalization for the UI.
- Create: `dashboard/src/lib/lmStudio.test.js`
  Responsibility: unit tests for provider visibility and fallback behavior.
- Create: `dashboard/src/components/AISettingsPanel.jsx`
  Responsibility: isolate AI provider settings UI, including Detect LM Studio flow.
- Create: `dashboard/src/components/AISettingsPanel.test.jsx`
  Responsibility: verify LM Studio stays hidden until discovery succeeds and disappears on failure.
- Modify: `dashboard/src/App.jsx`
  Responsibility: integrate AI settings panel, store LM Studio discovery state, pass dynamic model lists and fallback behavior through existing request headers.

## Task 1: Backend Discovery Helpers

**Files:**
- Modify: `ai_client.py`
- Create: `tests/test_ai_client_lmstudio.py`

- [ ] **Step 1: Write the failing discovery normalization test**

```python
import unittest
from unittest.mock import patch

import ai_client


class DummyDiscoveryResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {
            "models": [
                {
                    "type": "llm",
                    "key": "google/gemma-4-27b",
                    "display_name": "Gemma 4 27B",
                    "loaded_instances": [{"id": "google/gemma-4-27b"}],
                    "max_context_length": 262144,
                    "capabilities": {"vision": True},
                },
                {
                    "type": "llm",
                    "key": "deepseek-r1",
                    "display_name": "DeepSeek R1",
                    "loaded_instances": [],
                    "max_context_length": 131072,
                    "capabilities": {"vision": False},
                },
                {
                    "type": "embedding",
                    "key": "nomic-embed",
                    "display_name": "Nomic Embed",
                    "loaded_instances": [],
                    "max_context_length": 2048,
                },
            ]
        }


class DummyDiscoveryClient:
    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def get(self, url, headers=None):
        self.url = url
        self.headers = headers
        return DummyDiscoveryResponse()


class AIClientLmStudioDiscoveryTests(unittest.TestCase):
    @patch("ai_client.httpx.Client", DummyDiscoveryClient)
    def test_discover_lmstudio_models_filters_text_and_vision(self):
        result = ai_client.discover_lmstudio_models("http://localhost:1234/", api_key="token")

        self.assertEqual(
            [model["id"] for model in result["textModels"]],
            ["google/gemma-4-27b", "deepseek-r1"],
        )
        self.assertEqual(
            [model["id"] for model in result["visionModels"]],
            ["google/gemma-4-27b"],
        )
        self.assertTrue(result["textModels"][0]["isLoaded"])
        self.assertEqual(result["textModels"][0]["label"], "Gemma 4 27B")
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m unittest tests.test_ai_client_lmstudio.AIClientLmStudioDiscoveryTests.test_discover_lmstudio_models_filters_text_and_vision -v`

Expected: `AttributeError: module 'ai_client' has no attribute 'discover_lmstudio_models'`

- [ ] **Step 3: Write the minimal discovery implementation**

```python
def _build_bearer_headers(api_key: str) -> dict[str, str]:
    if not api_key:
        return {}
    return {"Authorization": f"Bearer {api_key}"}


def _normalize_lmstudio_model(model: Mapping[str, Any]) -> Optional[dict[str, Any]]:
    if model.get("type") != "llm":
        return None

    capabilities = model.get("capabilities") or {}
    loaded_instances = model.get("loaded_instances") or []
    return {
        "id": str(model.get("key") or "").strip(),
        "label": str(model.get("display_name") or model.get("key") or "").strip(),
        "supportsText": True,
        "supportsVision": bool(capabilities.get("vision")),
        "isLoaded": bool(loaded_instances),
        "contextLength": model.get("max_context_length") or 0,
    }


def discover_lmstudio_models(base_url: str, api_key: str = "", timeout: float = 10.0) -> dict[str, Any]:
    origin = AIConfig(provider="lmstudio", base_url=base_url).resolved_base_url()
    with httpx.Client(timeout=timeout) as client:
        response = client.get(f"{origin}/api/v1/models", headers=_build_bearer_headers(api_key))
    response.raise_for_status()
    payload = response.json()

    models = []
    for raw_model in payload.get("models", []):
        normalized = _normalize_lmstudio_model(raw_model)
        if normalized and normalized["id"]:
            models.append(normalized)

    return {
        "textModels": models,
        "visionModels": [model for model in models if model["supportsVision"]],
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python -m unittest tests.test_ai_client_lmstudio.AIClientLmStudioDiscoveryTests.test_discover_lmstudio_models_filters_text_and_vision -v`

Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add ai_client.py tests/test_ai_client_lmstudio.py
git commit -m "feat: add LM Studio model discovery helpers"
```

## Task 2: Backend LM Studio Inference Path

**Files:**
- Modify: `ai_client.py`
- Modify: `tests/test_ai_client_lmstudio.py`

- [ ] **Step 1: Write the failing LM Studio chat request test**

```python
class DummyChatResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {
            "choices": [
                {
                    "message": {
                        "content": "{\"clips\":[]}"
                    }
                }
            ]
        }


class RecordingChatClient:
    last_url = None
    last_headers = None
    last_json = None

    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def post(self, url, headers=None, json=None):
        RecordingChatClient.last_url = url
        RecordingChatClient.last_headers = headers
        RecordingChatClient.last_json = json
        return DummyChatResponse()


class AIClientLmStudioChatTests(unittest.TestCase):
    @patch("ai_client.httpx.Client", RecordingChatClient)
    def test_chat_completion_uses_openai_compatible_endpoint_for_lmstudio(self):
        config = ai_client.AIConfig(
            provider="lmstudio",
            api_key="token",
            base_url="http://localhost:1234/",
            text_model="google/gemma-4-27b",
        )

        text = ai_client.chat_completion(
            config,
            "Return JSON",
            json_mode=True,
            model="google/gemma-4-27b",
        )

        self.assertEqual(text, "{\"clips\":[]}")
        self.assertEqual(RecordingChatClient.last_url, "http://localhost:1234/v1/chat/completions")
        self.assertEqual(
            RecordingChatClient.last_headers["Authorization"],
            "Bearer token",
        )
        self.assertEqual(
            RecordingChatClient.last_json["response_format"],
            {"type": "json_object"},
        )
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m unittest tests.test_ai_client_lmstudio.AIClientLmStudioChatTests.test_chat_completion_uses_openai_compatible_endpoint_for_lmstudio -v`

Expected: `ValueError: Unsupported AI provider: lmstudio`

- [ ] **Step 3: Write the minimal LM Studio inference implementation**

```python
def _build_openai_message(prompt: str, images: Optional[Sequence[Any]] = None) -> dict[str, Any]:
    if not images:
        return {"role": "user", "content": prompt}

    content = [{"type": "text", "text": prompt}]
    for image in images:
        encoded = _encode_image_source(image)
        content.append(
            {
                "type": "image_url",
                "image_url": {"url": f"data:image/png;base64,{encoded}"},
            }
        )
    return {"role": "user", "content": content}


def _lmstudio_chat(
    config: AIConfig,
    prompt: str,
    *,
    system_prompt: Optional[str] = None,
    json_mode: bool = False,
    model: Optional[str] = None,
    images: Optional[Sequence[Any]] = None,
    timeout: float = 300.0,
) -> str:
    url = f"{config.resolved_base_url()}/v1/chat/completions"
    messages: list[dict[str, Any]] = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append(_build_openai_message(prompt, images))

    payload: dict[str, Any] = {
        "model": model or config.text_model,
        "messages": messages,
        "temperature": 0.2,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}

    with httpx.Client(timeout=timeout) as client:
        response = client.post(
            url,
            headers=_build_bearer_headers(config.api_key),
            json=payload,
        )
    response.raise_for_status()
    data = response.json()
    return ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""


class AIConfig:
    def is_lmstudio(self) -> bool:
        return self.normalized_provider() == "lmstudio"


def chat_completion(...):
    if provider == "lmstudio":
        return _lmstudio_chat(
            config,
            prompt,
            system_prompt=system_prompt,
            json_mode=json_mode,
            model=model or config.text_model,
            images=images,
            timeout=timeout,
        )
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m unittest tests.test_ai_client_lmstudio -v`

Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add ai_client.py tests/test_ai_client_lmstudio.py
git commit -m "feat: add LM Studio chat completions support"
```

## Task 3: FastAPI Discovery Route

**Files:**
- Modify: `app.py`
- Create: `tests/test_app_lmstudio.py`

- [ ] **Step 1: Write the failing discovery route tests**

```python
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

import app


class LmStudioDiscoveryRouteTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app.app)

    @patch("app.discover_lmstudio_models")
    def test_discover_endpoint_returns_normalized_model_lists(self, discover_mock):
        discover_mock.return_value = {
            "textModels": [
                {"id": "google/gemma-4-27b", "label": "Gemma 4 27B", "supportsText": True, "supportsVision": True, "isLoaded": True, "contextLength": 262144}
            ],
            "visionModels": [
                {"id": "google/gemma-4-27b", "label": "Gemma 4 27B", "supportsText": True, "supportsVision": True, "isLoaded": True, "contextLength": 262144}
            ],
        }

        response = self.client.post(
            "/api/ai/lmstudio/discover",
            json={"baseUrl": "http://localhost:1234", "apiKey": "token"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["available"])
        self.assertEqual(response.json()["provider"], "lmstudio")

    @patch("app.discover_lmstudio_models", side_effect=RuntimeError("boom"))
    def test_discover_endpoint_returns_clean_failure_payload(self, discover_mock):
        response = self.client.post(
            "/api/ai/lmstudio/discover",
            json={"baseUrl": "http://localhost:1234", "apiKey": ""},
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["available"])
        self.assertEqual(response.json()["textModels"], [])
        self.assertIn("Unable to discover LM Studio models", response.json()["error"])
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m unittest tests.test_app_lmstudio.LmStudioDiscoveryRouteTests -v`

Expected: `404 Client Error` or `AssertionError` because `/api/ai/lmstudio/discover` does not exist yet

- [ ] **Step 3: Write the minimal route implementation**

```python
from pydantic import BaseModel
from ai_client import AIConfig, ai_config_to_env, discover_lmstudio_models, load_ai_config


class LmStudioDiscoveryRequest(BaseModel):
    baseUrl: str
    apiKey: Optional[str] = None


def _lmstudio_discovery_failure(base_url: str) -> dict[str, Any]:
    return {
        "available": False,
        "provider": "lmstudio",
        "baseUrl": base_url,
        "textModels": [],
        "visionModels": [],
        "error": "Unable to discover LM Studio models",
    }


@app.post("/api/ai/lmstudio/discover")
async def discover_lmstudio_endpoint(req: LmStudioDiscoveryRequest):
    base_url = (req.baseUrl or "").strip()
    if not base_url:
        return _lmstudio_discovery_failure(base_url)

    try:
        discovered = discover_lmstudio_models(base_url, api_key=(req.apiKey or "").strip())
    except Exception as exc:
        print(f"LM Studio discovery failed for {base_url}: {exc}")
        return _lmstudio_discovery_failure(base_url)

    if not discovered["textModels"]:
        return _lmstudio_discovery_failure(base_url)

    return {
        "available": True,
        "provider": "lmstudio",
        "baseUrl": AIConfig(provider="lmstudio", base_url=base_url).resolved_base_url(),
        "textModels": discovered["textModels"],
        "visionModels": discovered["visionModels"],
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m unittest tests.test_app_lmstudio.LmStudioDiscoveryRouteTests -v`

Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add app.py tests/test_app_lmstudio.py
git commit -m "feat: add LM Studio discovery API route"
```

## Task 4: Frontend LM Studio Helpers And Test Harness

**Files:**
- Modify: `dashboard/package.json`
- Modify: `dashboard/vite.config.js`
- Create: `dashboard/src/test/setup.js`
- Create: `dashboard/src/lib/lmStudio.js`
- Create: `dashboard/src/lib/lmStudio.test.js`

- [ ] **Step 1: Write the failing frontend helper test**

```javascript
import { describe, expect, it } from 'vitest';

import {
  buildVisibleProviders,
  pickProviderAfterDiscoveryFailure,
} from './lmStudio';

describe('lmStudio helpers', () => {
  it('shows lmstudio only when discovery is available', () => {
    expect(buildVisibleProviders({ lmStudioAvailable: false })).toEqual(['gemini', 'ollama']);
    expect(buildVisibleProviders({ lmStudioAvailable: true })).toEqual(['gemini', 'ollama', 'lmstudio']);
  });

  it('falls back to ollama before gemini when lmstudio disappears', () => {
    expect(
      pickProviderAfterDiscoveryFailure({
        currentProvider: 'lmstudio',
        ollamaBaseUrl: 'http://localhost:11434',
      }),
    ).toBe('ollama');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- src/lib/lmStudio.test.js`

Working directory: `dashboard`

Expected: `Missing script: "test"` or module resolution failure for `./lmStudio`

- [ ] **Step 3: Write the minimal frontend test setup and helper implementation**

```json
{
  "scripts": {
    "test": "vitest run"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.8.0",
    "@testing-library/react": "^16.3.0",
    "jsdom": "^26.1.0",
    "vitest": "^2.1.9"
  }
}
```

```javascript
export default defineConfig(({ mode }) => {
  // existing config
  return {
    plugins: [react()],
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.js',
    },
  };
});
```

```javascript
import '@testing-library/jest-dom/vitest';
```

```javascript
export const buildVisibleProviders = ({ lmStudioAvailable }) => (
  lmStudioAvailable ? ['gemini', 'ollama', 'lmstudio'] : ['gemini', 'ollama']
);

export const pickProviderAfterDiscoveryFailure = ({ currentProvider, ollamaBaseUrl }) => {
  if (currentProvider !== 'lmstudio') return currentProvider;
  return (ollamaBaseUrl || '').trim() ? 'ollama' : 'gemini';
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- src/lib/lmStudio.test.js`

Working directory: `dashboard`

Expected: `2 passed`

- [ ] **Step 5: Commit**

```bash
git add dashboard/package.json dashboard/vite.config.js dashboard/src/test/setup.js dashboard/src/lib/lmStudio.js dashboard/src/lib/lmStudio.test.js
git commit -m "test: add frontend LM Studio helper coverage"
```

## Task 5: Extract AI Settings Panel And Integrate LM Studio UI

**Files:**
- Create: `dashboard/src/components/AISettingsPanel.jsx`
- Create: `dashboard/src/components/AISettingsPanel.test.jsx`
- Modify: `dashboard/src/App.jsx`

- [ ] **Step 1: Write the failing settings panel tests**

```javascript
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import AISettingsPanel from './AISettingsPanel';

describe('AISettingsPanel', () => {
  it('hides lmstudio until discovery succeeds', () => {
    render(
      <AISettingsPanel
        aiProvider="gemini"
        aiBaseUrl=""
        apiKey=""
        aiQualityPreset="balanced"
        aiTextModel="auto"
        aiAnalyzeModel="auto"
        aiVisionModel="auto"
        aiImageModel=""
        lmStudioAvailable={false}
        lmStudioModels={{ textModels: [], visionModels: [] }}
        onDetectLmStudio={vi.fn()}
      />,
    );

    expect(screen.queryByRole('option', { name: /LM Studio/i })).not.toBeInTheDocument();
  });

  it('shows lmstudio when discovery state is available', () => {
    render(
      <AISettingsPanel
        aiProvider="lmstudio"
        aiBaseUrl="http://localhost:1234"
        apiKey=""
        aiQualityPreset="balanced"
        aiTextModel="google/gemma-4-27b"
        aiAnalyzeModel="google/gemma-4-27b"
        aiVisionModel="google/gemma-4-27b"
        aiImageModel=""
        lmStudioAvailable
        lmStudioModels={{
          textModels: [{ id: 'google/gemma-4-27b', label: 'Gemma 4 27B' }],
          visionModels: [{ id: 'google/gemma-4-27b', label: 'Gemma 4 27B' }],
        }}
        onDetectLmStudio={vi.fn()}
      />,
    );

    expect(screen.getByRole('option', { name: /LM Studio \(Detected\)/i })).toBeInTheDocument();
  });

  it('calls detect when the user requests LM Studio discovery', async () => {
    const onDetectLmStudio = vi.fn().mockResolvedValue({ available: false });

    render(
      <AISettingsPanel
        aiProvider="gemini"
        aiBaseUrl="http://localhost:1234"
        apiKey=""
        aiQualityPreset="balanced"
        aiTextModel="auto"
        aiAnalyzeModel="auto"
        aiVisionModel="auto"
        aiImageModel=""
        lmStudioAvailable={false}
        lmStudioModels={{ textModels: [], visionModels: [] }}
        onDetectLmStudio={onDetectLmStudio}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Detect LM Studio/i }));

    await waitFor(() => {
      expect(onDetectLmStudio).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- src/components/AISettingsPanel.test.jsx`

Working directory: `dashboard`

Expected: module resolution failure because `AISettingsPanel.jsx` does not exist

- [ ] **Step 3: Write the minimal component and App integration**

```javascript
// dashboard/src/components/AISettingsPanel.jsx
import React from 'react';

import { buildVisibleProviders } from '../lib/lmStudio';

export default function AISettingsPanel({
  aiProvider,
  setAiProvider,
  apiKey,
  setApiKey,
  aiBaseUrl,
  setAiBaseUrl,
  aiQualityPreset,
  setAiQualityPreset,
  aiTextModel,
  setAiTextModel,
  aiAnalyzeModel,
  setAiAnalyzeModel,
  aiVisionModel,
  setAiVisionModel,
  aiImageModel,
  setAiImageModel,
  lmStudioAvailable,
  lmStudioModels,
  onDetectLmStudio,
}) {
  const providerOptions = buildVisibleProviders({ lmStudioAvailable });
  const textOptions = aiProvider === 'lmstudio' ? lmStudioModels.textModels : null;
  const visionOptions = aiProvider === 'lmstudio' ? lmStudioModels.visionModels : null;

  return (
    <div className="glass-panel p-6 mb-8">
      <label className="block">
        <span className="block text-sm text-zinc-400 mb-2">Provider</span>
        <select value={aiProvider} onChange={(e) => setAiProvider(e.target.value)} className="input-field">
          {providerOptions.includes('gemini') && <option value="gemini">Gemini (Cloud)</option>}
          {providerOptions.includes('ollama') && <option value="ollama">Ollama (Local)</option>}
          {providerOptions.includes('lmstudio') && <option value="lmstudio">LM Studio (Detected)</option>}
        </select>
      </label>

      <button type="button" onClick={onDetectLmStudio} className="btn-primary py-2 px-4 text-sm mt-4">
        Detect LM Studio
      </button>

      {textOptions && (
        <select value={aiTextModel} onChange={(e) => setAiTextModel(e.target.value)} className="input-field">
          {textOptions.map((model) => (
            <option key={model.id} value={model.id}>{model.label}</option>
          ))}
        </select>
      )}

      {visionOptions && (
        <select value={aiVisionModel} onChange={(e) => setAiVisionModel(e.target.value)} className="input-field" disabled={visionOptions.length === 0}>
          {visionOptions.map((model) => (
            <option key={model.id} value={model.id}>{model.label}</option>
          ))}
        </select>
      )}
    </div>
  );
}
```

```javascript
// dashboard/src/App.jsx
import AISettingsPanel from './components/AISettingsPanel';
import {
  pickProviderAfterDiscoveryFailure,
} from './lib/lmStudio';

const [lmStudioAvailable, setLmStudioAvailable] = useState(false);
const [lmStudioModels, setLmStudioModels] = useState({ textModels: [], visionModels: [] });

const shouldSendAiBaseUrl = useCallback(() => {
  if (!['ollama', 'lmstudio'].includes(aiProvider)) return false;
  return !!aiBaseUrl && !!aiBaseUrl.trim();
}, [aiProvider, aiBaseUrl]);

const detectLmStudio = useCallback(async () => {
  const res = await fetch(getApiUrl('/api/ai/lmstudio/discover'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseUrl: aiBaseUrl, apiKey }),
  });
  const data = await res.json();

  if (!data.available) {
    setLmStudioAvailable(false);
    setLmStudioModels({ textModels: [], visionModels: [] });
    setAiProvider((current) => pickProviderAfterDiscoveryFailure({
      currentProvider: current,
      ollamaBaseUrl: CONFIGURED_OLLAMA_BASE_URL || aiBaseUrl,
    }));
    return data;
  }

  setLmStudioAvailable(true);
  setLmStudioModels({
    textModels: data.textModels,
    visionModels: data.visionModels,
  });
  return data;
}, [aiBaseUrl, apiKey]);

useEffect(() => {
  if (aiProvider === 'lmstudio' && !lmStudioAvailable) {
    setAiProvider(
      pickProviderAfterDiscoveryFailure({
        currentProvider: 'lmstudio',
        ollamaBaseUrl: CONFIGURED_OLLAMA_BASE_URL || aiBaseUrl,
      }),
    );
  }
}, [aiProvider, aiBaseUrl, lmStudioAvailable]);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- src/components/AISettingsPanel.test.jsx src/lib/lmStudio.test.js`

Working directory: `dashboard`

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/components/AISettingsPanel.jsx dashboard/src/components/AISettingsPanel.test.jsx dashboard/src/App.jsx dashboard/src/lib/lmStudio.js dashboard/src/lib/lmStudio.test.js
git commit -m "feat: add LM Studio settings flow to dashboard"
```

## Task 6: Env Docs And Full Verification

**Files:**
- Modify: `.env.example`
- Modify: `tests/test_ai_client_lmstudio.py`
- Modify: `dashboard/src/components/AISettingsPanel.test.jsx`

- [ ] **Step 1: Write the failing edge-case tests**

```python
class AIClientLmStudioDiscoveryTests(unittest.TestCase):
    @patch("ai_client.httpx.Client", side_effect=RuntimeError("offline"))
    def test_discover_lmstudio_models_failure_raises_clean_runtime_error(self, _client):
        with self.assertRaises(RuntimeError):
            ai_client.discover_lmstudio_models("http://localhost:1234", api_key="")
```

```javascript
it('disables the vision selector when no vision-capable models are discovered', () => {
  render(
    <AISettingsPanel
      aiProvider="lmstudio"
      aiBaseUrl="http://localhost:1234"
      apiKey=""
      aiQualityPreset="balanced"
      aiTextModel="deepseek-r1"
      aiAnalyzeModel="deepseek-r1"
      aiVisionModel=""
      aiImageModel=""
      lmStudioAvailable
      lmStudioModels={{ textModels: [{ id: 'deepseek-r1', label: 'DeepSeek R1' }], visionModels: [] }}
      onDetectLmStudio={vi.fn()}
    />,
  );

  expect(screen.getByLabelText(/Vision Model/i)).toBeDisabled();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m unittest tests.test_ai_client_lmstudio -v`

Run: `npm run test -- src/components/AISettingsPanel.test.jsx`

Working directory for frontend command: `dashboard`

Expected: backend failure because LM Studio error handling is raw, frontend failure because the vision control is not disabled yet

- [ ] **Step 3: Write the minimal final implementation and docs updates**

```python
def discover_lmstudio_models(base_url: str, api_key: str = "", timeout: float = 10.0) -> dict[str, Any]:
    origin = AIConfig(provider="lmstudio", base_url=base_url).resolved_base_url()
    try:
        with httpx.Client(timeout=timeout) as client:
            response = client.get(f"{origin}/api/v1/models", headers=_build_bearer_headers(api_key))
        response.raise_for_status()
    except Exception as exc:
        raise RuntimeError(f"LM Studio discovery failed for {origin}") from exc
```

```env
# Optional local provider alternative to Ollama.
# Discovery route: POST /api/ai/lmstudio/discover
# Base URL example: http://localhost:1234
AI_PROVIDER=ollama
AI_BASE_URL=http://localhost:11434
```

```javascript
<label className="block">
  <span className="block text-sm text-zinc-400 mb-2">Vision Model</span>
  <select
    aria-label="Vision Model"
    value={aiVisionModel}
    onChange={(e) => setAiVisionModel(e.target.value)}
    className="input-field"
    disabled={aiProvider === 'lmstudio' && visionOptions.length === 0}
  >
```

- [ ] **Step 4: Run the full verification commands**

Run: `python -m unittest tests.test_ai_client_lmstudio tests.test_app_lmstudio -v`

Run: `npm run test -- src/lib/lmStudio.test.js src/components/AISettingsPanel.test.jsx`

Run: `npm run build`

Working directory for frontend commands: `dashboard`

Expected: backend tests `OK`, frontend tests pass, Vite build exits `0`

- [ ] **Step 5: Commit**

```bash
git add .env.example tests/test_ai_client_lmstudio.py tests/test_app_lmstudio.py dashboard/src/components/AISettingsPanel.test.jsx dashboard/src/components/AISettingsPanel.jsx dashboard/src/App.jsx dashboard/src/lib/lmStudio.js dashboard/src/lib/lmStudio.test.js dashboard/package.json dashboard/vite.config.js dashboard/src/test/setup.js
git commit -m "feat: add LM Studio provider"
```
