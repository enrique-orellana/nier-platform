# OpenRouter Transcription Provider Design

## Goal

Allow users to optionally select the provider OpenRouter should use for audio transcription, while preserving OpenRouter's default routing when no provider is configured.

## Design

Add an optional transcription routing provider to the shared AI configuration. The dashboard and local-editor request paths forward the setting in a dedicated header. The OpenRouter transcription payload includes `provider: { only: [value] }` only when the value is nonblank; blank input omits the field entirely.

The setting is exposed beside the existing transcription model field as a text input so provider IDs such as `deepinfra` can be entered without maintaining a hard-coded provider list. It is persisted in local storage and defaults to an empty string.

## Data flow

1. The settings UI reads and writes `ai_transcription_openrouter_provider_v1`.
2. Main dashboard requests send `X-AI-Transcription-OpenRouter-Provider`.
3. Local-editor requests send the same header.
4. `load_ai_config` reads the header or `AI_TRANSCRIPTION_OPENROUTER_PROVIDER` environment variable.
5. `transcribe_audio_openrouter` adds the OpenRouter `provider.only` policy only for a nonblank configured value.

## Compatibility and errors

The new field defaults to empty and does not alter existing payloads or routing. Provider IDs are trimmed before use. OpenRouter remains responsible for validating unsupported provider IDs and returning its normal API error.

## Testing

Backend tests cover configuration loading, provider inclusion, and provider omission. Frontend tests cover rendering the setting and forwarding the saved value through both request-header helpers. Existing OpenRouter, application, and dashboard test suites remain regression gates.
