# OpenRouter Transcription Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users optionally force OpenRouter transcription through a named provider such as `deepinfra`.

**Architecture:** Add an empty-by-default field to `AIConfig`, pass it through the existing dashboard and local-editor header channels, and conditionally add OpenRouter's `provider.only` payload policy. Keep the input as a free-form provider ID to avoid coupling the UI to OpenRouter's provider catalog.

**Tech Stack:** Python, httpx, pytest/unittest, React, Vitest, localStorage.

---

### Task 1: Add backend configuration and payload behavior

**Files:**
- Modify: `ai_client.py:43-242, 312-415`
- Modify: `app.py:2287-2305`
- Modify: `backend-go/internal/httpapi/local_editor_handlers.go:354-368`
- Test: `tests/test_ai_client_openrouter.py`
- Test: `tests/test_app_lmstudio.py`
- Test: `tests/test_local_editor_transcription_api.py`
- Test: `backend-go/internal/httpapi/server_test.go`

- [ ] **Step 1: Write failing backend tests**

Add tests asserting that `load_ai_config` reads `X-AI-Transcription-OpenRouter-Provider`, that a configured provider is sent as `{"provider": {"only": ["deepinfra"]}}`, that a blank provider is absent from the payload, and that the local-editor endpoint forwards the header into `transcribe_audio`.

- [ ] **Step 2: Run the focused tests and verify they fail for the missing field/payload**

Run `python -m pytest tests/test_ai_client_openrouter.py tests/test_app_lmstudio.py -q`.

- [ ] **Step 3: Implement the smallest backend change**

Add an empty `transcription_openrouter_provider` field, load the header/environment value, propagate it through worker environment configuration, conditionally add the trimmed provider policy to the transcription payload, and forward the header from the legacy Python local-editor endpoint.

- [ ] **Step 4: Run the focused tests and verify they pass**

Run `python -m pytest tests/test_ai_client_openrouter.py tests/test_app_lmstudio.py -q`.

### Task 2: Expose and forward the setting in the dashboard

**Files:**
- Modify: `dashboard/src/App.jsx`
- Modify: `dashboard/src/components/AISettingsPanel.jsx`
- Modify: `dashboard/src/components/local-editor/localEditorAi.js`
- Test: `dashboard/src/components/AISettingsPanel.test.jsx`
- Test: `dashboard/src/components/local-editor/localEditorAi.test.js`

- [ ] **Step 1: Write failing UI/header tests**

Assert that the settings panel renders an `OpenRouter transcription provider` input, that `getLocalAiHeaders` forwards its saved value in `X-AI-Transcription-OpenRouter-Provider`, and that the Go HTTP header allow-list preserves it.

- [ ] **Step 2: Run the focused frontend tests and verify they fail**

Run `npm test -- --run dashboard/src/components/AISettingsPanel.test.jsx dashboard/src/components/local-editor/localEditorAi.test.js` from `dashboard`.

- [ ] **Step 3: Implement the UI state, persistence, props, and headers**

Use local storage key `ai_transcription_openrouter_provider_v1`, default to `""`, render the field with the existing transcription controls, and include the header in both request helpers.

- [ ] **Step 4: Run the focused frontend tests and verify they pass**

Run `npm test -- --run dashboard/src/components/AISettingsPanel.test.jsx dashboard/src/components/local-editor/localEditorAi.test.js` from `dashboard`.

### Task 3: Run regression verification

**Files:**
- No source changes.

- [ ] **Step 1: Run backend regression tests**

Run `python -m pytest tests/test_ai_client_openrouter.py tests/test_highlight_generation.py tests/test_remote_subtitles.py tests/test_main_transcription.py -q`.

- [ ] **Step 2: Run frontend regression tests and build**

Run `npm test -- --run` and `npm run build` from `dashboard`.

- [ ] **Step 3: Run GitNexus change detection**

Run `detect_changes` after implementation and confirm only the expected config, transcription, request-header, and settings flows are affected.
