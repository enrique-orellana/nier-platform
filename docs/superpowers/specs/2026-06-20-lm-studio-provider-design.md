# LM Studio Provider Design

Date: 2026-06-20
Status: Approved for spec review

## Summary

OpenShorts will gain LM Studio support as a local AI provider alongside Gemini and Ollama.
The integration will use two LM Studio API surfaces:

- Discovery uses LM Studio native `GET /api/v1/models` so the app can read `display_name`, `type`, loaded-state data, and `capabilities.vision`.
- Inference uses LM Studio OpenAI-compatible `POST /v1/chat/completions` so generation stays close to a standard chat-completions contract.

LM Studio will not be shown as an always-available provider in the dashboard.
The provider becomes visible only after a successful discovery probe against the configured base URL returns at least one usable LLM.

## Goals

- Add `lmstudio` as a supported backend provider.
- Discover LM Studio models dynamically instead of hard-coding model IDs.
- Use LM Studio labels from the server response.
- Split discovered models into text/analyze and vision-compatible lists.
- Hide LM Studio completely when discovery fails.
- Keep Gemini and Ollama behavior unchanged.

## Non-Goals

- Replace the existing Ollama path.
- Add LM Studio image-generation support beyond manual model entry.
- Auto-install or auto-start LM Studio.
- Persist server-side AI credentials.
- Refactor unrelated dashboard settings behavior.

## Current Constraints

- The backend currently supports only `gemini` and `ollama`.
- The frontend currently shows only Gemini and Ollama in the provider dropdown.
- The frontend sends provider and model settings to the backend through request headers.
- The current local-model path assumes Ollama and targets `/api/chat`.

## High-Level Design

### Provider Model

OpenShorts will support three provider identifiers:

- `gemini`
- `ollama`
- `lmstudio`

`lmstudio` is a first-class backend provider, but it is a conditional frontend provider.
That means the backend understands it at all times, while the UI only exposes it after discovery succeeds.

### Discovery And Inference Split

LM Studio integration uses a split design on purpose:

- Discovery endpoint: `GET {baseUrl}/api/v1/models`
- Inference endpoint: `POST {baseUrl}/v1/chat/completions`

This is the recommended balance for this repo because the native discovery endpoint provides reliable labels and capability metadata, while chat completions keeps the inference contract closer to other OpenAI-style clients.

### Capability Rules

The backend will normalize LM Studio model records into a provider-agnostic shape:

- `id`: LM Studio model key
- `label`: LM Studio `display_name`
- `supportsText`: `true` for every discovered `llm`
- `supportsVision`: `true` when `capabilities.vision` is true
- `isLoaded`: `true` when `loaded_instances` is non-empty
- `contextLength`: best available max context length value

Filtering rules:

- Text model list: every discovered model with `type == "llm"`
- Analyze model list: same as text model list
- Vision model list: discovered LLMs where `capabilities.vision == true`
- Image model field: remains manual text input for now

## Backend Design

### AI Client Changes

`ai_client.py` will gain LM Studio-specific helpers for:

- base URL normalization
- discovery requests against `/api/v1/models`
- OpenAI-compatible chat requests against `/v1/chat/completions`
- normalization of LM Studio model metadata into the shared internal shape

Provider resolution logic will be extended so that:

- `config.normalized_provider()` recognizes `lmstudio`
- `chat_completion()` branches to an LM Studio request path when `provider == "lmstudio"`
- unsupported provider errors still fail fast

### Authentication Behavior

The existing `API / Access Key` field in the dashboard will also serve as the optional LM Studio API token.

Rules:

- if the field is empty, discovery and inference call LM Studio without an Authorization header
- if the field is present, discovery and inference send `Authorization: Bearer <token>`
- Gemini behavior remains unchanged
- Ollama behavior remains unchanged

This keeps the current settings surface small and avoids adding a second local-provider credential field.

### Discovery Route

The backend will expose a new route in `app.py`:

- `POST /api/ai/lmstudio/discover`

Request body:

```json
{
  "baseUrl": "http://localhost:1234",
  "apiKey": ""
}
```

Response body on success:

```json
{
  "available": true,
  "provider": "lmstudio",
  "baseUrl": "http://localhost:1234",
  "textModels": [
    {
      "id": "google/gemma-4-27b",
      "label": "Gemma 4 27B",
      "supportsText": true,
      "supportsVision": true,
      "isLoaded": true,
      "contextLength": 262144
    }
  ],
  "visionModels": [
    {
      "id": "google/gemma-4-27b",
      "label": "Gemma 4 27B",
      "supportsText": true,
      "supportsVision": true,
      "isLoaded": true,
      "contextLength": 262144
    }
  ]
}
```

Response body on discovery failure:

```json
{
  "available": false,
  "provider": "lmstudio",
  "baseUrl": "http://localhost:1234",
  "textModels": [],
  "visionModels": [],
  "error": "Unable to discover LM Studio models"
}
```

The route will never dump raw upstream exception strings into the UI.
Server logs may keep the detailed error, but the HTTP response stays clean and predictable.

### Base URL Handling

LM Studio base URL normalization will:

- trim whitespace
- remove trailing slashes
- preserve scheme and host
- avoid doubling `/v1` or `/api/v1` paths in follow-up requests

The user enters the service origin, for example:

- `http://localhost:1234`
- `http://192.168.1.50:1234`

The backend constructs the specific discovery and inference paths itself.

## Frontend Design

### Provider Visibility

Gemini and Ollama remain static entries in the provider select.
LM Studio is conditional:

- hidden by default
- inserted into the provider dropdown only after successful discovery
- removed again if later discovery fails

If local storage contains `lmstudio` from an earlier session but the current discovery fails, the UI immediately falls back to a visible provider:

- prefer `ollama` if a local base URL is already configured
- otherwise use `gemini`

This prevents the dashboard from loading into a hidden or invalid provider state.

### Settings Flow

The Settings screen will add an LM Studio detection flow:

1. User enters a base URL in the existing Base URL field.
2. User clicks `Detect LM Studio`.
3. Frontend calls `POST /api/ai/lmstudio/discover`.
4. On success:
   the UI stores the discovered model lists in state, adds LM Studio to the provider dropdown, and allows the user to select it.
5. On failure:
   the UI leaves LM Studio hidden and clears any stale LM Studio discovery state.

The detect action is explicit.
The app will not silently probe arbitrary URLs on every keystroke.

### Model Controls

When `aiProvider === "lmstudio"`:

- Text Model options come from discovered `textModels`
- Clip Analysis Model options come from discovered `textModels`
- Vision Model options come from discovered `visionModels`
- Image Model remains a plain text input

When `aiProvider !== "lmstudio"`:

- current Gemini and Ollama model behavior remains unchanged

### No-Vision Case

LM Studio may be successfully discovered without any vision-capable models.
In that case:

- LM Studio can still appear as a provider because text-only workflows remain valid
- the Vision Model control is empty or disabled
- vision-dependent actions should block with a clear user-facing message instead of failing later in the pipeline

The user should learn that LM Studio is available, but not fully capable for vision workloads with the current installed models.

## Request Header Behavior

The dashboard continues using the existing provider header contract:

- `X-AI-Provider`
- `X-AI-Api-Key`
- `X-AI-Base-Url`
- `X-AI-Model`
- `X-AI-Analyze-Model`
- `X-AI-Vision-Model`
- `X-AI-Image-Model`

For LM Studio:

- `X-AI-Provider` is `lmstudio`
- `X-AI-Base-Url` is the LM Studio service origin
- `X-AI-Api-Key` is optional and maps to Bearer auth
- model headers carry discovered LM Studio model IDs

No new per-request header shape is required.

## Error Handling

### Discovery Failures

Discovery is considered failed when:

- base URL is empty
- base URL is malformed
- network connection fails
- timeout occurs
- authentication fails
- response is not a valid LM Studio model-list payload
- payload contains no usable `llm` models

On failure:

- backend returns `available=false`
- frontend does not show LM Studio
- stale LM Studio model lists are cleared from state
- if LM Studio was active, provider selection falls back to a visible provider

### Inference Failures

Inference failures for LM Studio follow the same operational standard as other providers:

- backend raises a clear provider-specific error
- UI surfaces a concise failure message
- no fallback provider switch happens automatically during an active generation request

Provider switching should be a settings decision, not a silent runtime side effect.

## Testing Strategy

### Backend Tests

Add tests for:

- provider normalization accepting `lmstudio`
- LM Studio base URL normalization
- discovery response normalization from `/api/v1/models`
- filtering of text vs vision models
- clean failure payloads for discovery errors
- OpenAI-compatible LM Studio chat request shaping for `/v1/chat/completions`

### Frontend Tests

Add tests for:

- LM Studio absent from the provider dropdown before detection
- successful detection adding LM Studio to the provider dropdown
- failed detection keeping LM Studio hidden
- previously selected LM Studio falling back to a visible provider after failure
- LM Studio model dropdowns using dynamic discovered values
- empty or disabled vision control when no vision-capable models are discovered

## Rollout Notes

- `.env.example` should document LM Studio as an optional provider path
- Kubernetes examples do not need to default to LM Studio
- Ollama remains the default local provider for existing local and cluster flows

## Risks

- LM Studio native and OpenAI-compatible endpoints may differ in future versions
- some users may expect silent auto-discovery instead of the explicit detect button
- text-only LM Studio setups may still reach vision-required workflows unless frontend guards are applied consistently

These risks are acceptable for the first iteration because the design favors predictability over hidden behavior.

## Implementation Summary

Implementation should:

- add LM Studio discovery and chat support to the backend
- add one discovery route
- add explicit frontend detection state and conditional provider visibility
- populate text and vision model controls dynamically from LM Studio discovery results
- preserve existing Gemini and Ollama behavior
