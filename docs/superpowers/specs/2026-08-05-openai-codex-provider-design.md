# OpenAI Codex (ChatGPT) Provider Design

## Overview

OpenShorts will support OpenAI Codex as an AI provider that users connect with their ChatGPT account through the official Codex OAuth/device authorization flow. This allows a local, single-user OpenShorts installation to use Codex models covered by the user's ChatGPT plan without asking the user to paste an OpenAI API key.

This feature does not use ChatGPT browser cookies, passwords, unofficial web endpoints, or scraped session tokens. It uses a refreshable Codex credential stored by the OpenShorts backend.

## Scope and assumptions

- The current OpenShorts deployment model is one user per installation.
- One active OpenAI Codex connection is stored per installation.
- Gemini and LM Studio remain supported and retain their current behavior.
- The provider identifier is `openai-codex`.
- The feature supports Codex-compatible text and vision requests where the Codex transport supports them.
- Image generation is not promised by this provider. The UI will show no image-generation model for Codex unless the transport later exposes a supported capability.
- ChatGPT plan limits and Codex model availability are controlled by OpenAI and may change independently of OpenShorts.

## User experience

The AI Settings panel will include an `OpenAI Codex (ChatGPT)` provider option.

When selected:

- The API/access-key field is replaced by connection status and a `Connect ChatGPT` button when disconnected.
- Clicking connect calls the backend to start the device authorization flow.
- The dashboard displays the authorization URL and user code, and opens the URL when the browser permits it.
- The dashboard polls a backend status endpoint until authorization succeeds, is cancelled, expires, or fails.
- On success, the UI shows the connected state and allows the user to disconnect.
- Disconnecting removes the stored Codex credential and returns the provider to the disconnected state.
- A revoked or expired credential displays `Reconnect ChatGPT` and does not silently fall back to another provider.

The provider and connection state will be persisted for the local installation. Existing API-key persistence for Gemini and local endpoint persistence for LM Studio remain unchanged.

## Backend architecture

### Provider configuration

`AIConfig` will recognize `openai-codex` as a supported provider. It will not require an API key or base URL from request headers. Existing `X-AI-Provider` and `X-AI-Model` headers will continue to select the provider and model.

The backend will add a small Codex credential service with explicit responsibilities:

1. Start an OAuth/device authorization transaction.
2. Poll or complete the authorization exchange.
3. Persist the refreshable credential in a local installation-scoped store.
4. Refresh access tokens when required.
5. Delete credentials on disconnect.
6. Return sanitized connection status without exposing tokens.

The credential service will be isolated from request construction so token storage and transport behavior can be tested independently.

### Authentication endpoints

The backend will expose endpoints equivalent to:

- `GET /api/ai/openai-codex/status` — return disconnected, pending, or connected status.
- `POST /api/ai/openai-codex/connect` — start a device authorization transaction and return only the user-facing URL/code and polling metadata.
- `POST /api/ai/openai-codex/poll` — advance a pending transaction and return sanitized status.
- `POST /api/ai/openai-codex/disconnect` — remove the stored credential.

The exact route names may follow existing app conventions, but the separation between start, status/poll, and disconnect is required.

The authorization implementation will follow the Codex device-code flow: OpenAI supplies a verification URL and user code, and the backend polls the authorization transaction until credentials are issued. It will not implement a separate ChatGPT web-login flow.

### Credential storage

Credentials will be stored server-side in an installation-local file or existing application storage location, following the repository's existing persistence conventions. The store must:

- Be excluded from source control.
- Use restrictive filesystem permissions where supported.
- Never be returned in API responses.
- Never be written to normal application logs.
- Support atomic replacement during refresh.
- Preserve the refresh token when an authorization response omits it.

If the deployment environment cannot safely persist credentials, the connection endpoint will return a clear configuration error rather than claiming that the connection succeeded.

## Codex request transport

The provider transport will be implemented behind the existing `chat_completion`/`chat_json` boundary using the Codex-specific Responses API mode (`codex_responses`), not standard Chat Completions. It will:

- Load the installation credential.
- Obtain or refresh a short-lived access token.
- Send the request using the Codex-compatible endpoint and request schema.
- Map text, system prompts, JSON requests, and supported image inputs into the Codex request format.
- Normalize the response into the existing string result expected by OpenShorts.
- Translate authentication, rate-limit, capability, and transport errors into actionable provider-specific errors.

No automatic provider fallback will happen during an active request. Provider switching remains a settings decision.

## Model and capability behavior

The first release will expose `Auto (Codex default)` rather than a live model catalog. The backend will select the current Codex default supported by the transport, with the model kept in one provider constant so it can be updated without changing the dashboard contract. A live catalog is out of scope for this first release.

Text and clip-analysis requests will use the selected Codex model. Vision requests will use the selected model only when the transport and model support image input. Image-generation selection will be disabled or set to none for this provider.

## Error handling

- User cancellation: return to disconnected state with a retry message.
- Authorization timeout: expire the pending transaction and allow a new connection attempt.
- Invalid or revoked credential: mark the provider disconnected and show `Reconnect ChatGPT`.
- Rate limit or plan allowance reached: show the provider error and preserve the selected provider.
- Unsupported capability: show a specific message and do not substitute another provider.
- OpenAI transport failure: preserve the credential unless the response proves it is invalid.
- Malformed authorization or model response: fail closed with a diagnostic-safe message.

## Testing strategy

Tests will be written before implementation and will cover:

- Provider normalization and unsupported-provider behavior.
- Credential-store create, read, atomic update, refresh preservation, and delete behavior.
- OAuth start, pending poll, success, cancellation, timeout, and revoked-token paths.
- Sanitization of all authentication responses and logs.
- Codex request formatting for text, system prompts, JSON mode, and supported image input.
- Access-token refresh and retry behavior.
- Dashboard rendering for disconnected, pending, connected, and reconnect-required states.
- Provider-specific model and image-generation controls.
- Existing Gemini and LM Studio tests remaining green.

Integration tests will use a fake Codex authorization/transport server; no real ChatGPT credentials will be used in automated tests.

## Out of scope

- Multi-user accounts or tenant-level credential management.
- Importing ChatGPT cookies or browser session data.
- Reusing a ChatGPT web session for arbitrary model requests.
- OpenAI API-key billing or generic OpenAI API provider support.
- Automatic fallback from Codex to Gemini or LM Studio.
- Image generation through Codex unless a supported Codex capability is explicitly added later.
