# On-Demand Local Visual Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each clip-generation job use either the configured AI provider or an installed local Ollama vision model, and unload local analysis models when idle.

**Architecture:** Keep existing provider behavior intact and add a native Ollama multimodal path for local jobs. Carry the per-job choice through dashboard headers, Go allowlisting, and the Python worker environment. Load frame-based model services on demand with bounded image input and explicit/idle unloading.

**Tech Stack:** React/Vite, Go HTTP API, Python/FastAPI worker, Ollama HTTP API, FFmpeg/OpenCV, Docker Compose, pytest, Vitest.

---

### Task 1: Native Ollama vision client and bounded frame sampling

**Files:**
- Modify: `openshorts/ai/ai_client.py`
- Modify: `openshorts/analysis/video_frames.py`
- Create: `tests/test_ai_client_ollama.py`
- Create: `tests/test_video_frames.py` (if no existing focused frame-sampling tests exist)

- [ ] Add tests for Ollama `/api/tags`-independent chat requests: model, prompt, JSON response format, base64 images, keep-alive, HTTP errors, and unload request.
- [ ] Add frame-sampling tests proving a maximum of eight timestamped frames per window, a 768-pixel maximum dimension, and no persisted image data.
- [ ] Implement provider-neutral Ollama chat options without changing Codex/OpenRouter/Gemini/LM Studio request behavior.
- [ ] Implement image extraction through the existing FFmpeg frame reader and in-memory encoding; return timestamps plus image bytes only to the caller.
- [ ] Run the focused Python tests and verify the existing AI client tests remain green.

### Task 2: Per-job local provider selection in clip discovery

**Files:**
- Modify: `main.py`
- Modify: `openshorts/analysis/analysis_providers.py`
- Modify: `tests/test_clip_analysis_prompt.py`

- [ ] Add tests that configured-provider analysis remains text/timeline-only and local Ollama receives transcript, audio-event timeline, and sampled images.
- [ ] Add tests that local provider failures propagate without silent fallback and that unload is attempted on success and failure.
- [ ] Pass source video path and window bounds into clip discovery while preserving existing function defaults for all current callers.
- [ ] Select provider from per-job environment; use existing configured provider by default.
- [ ] Wrap local model analysis in a `try/finally` unload operation, using a short keep-alive between windows.
- [ ] Run focused clip-analysis and main generation pipeline tests.

### Task 3: Secure Ollama discovery and job-header forwarding

**Files:**
- Modify: `backend-go/internal/httpapi/integrations_handlers.go`
- Modify: `backend-go/internal/httpapi/local_editor_handlers.go`
- Modify: `backend-go/internal/httpapi/process_handlers.go` only if request validation needs the selection fields
- Modify: `backend-go/internal/httpapi/*_test.go` for integration-handler and header-forwarding coverage
- Modify: `python_worker.py`
- Modify: `tests/test_python_worker.py`

- [ ] Add Go tests for Ollama model discovery through `/api/tags`, rejecting public hosts, credentials, unsupported schemes, and malformed URLs.
- [ ] Add Python worker tests proving dedicated local-model fields become job-scoped environment values without overwriting configured provider credentials.
- [ ] Register the Ollama discovery route and return installed model IDs/sizes without invoking inference.
- [ ] Add allowlisted job headers for selected provider, Ollama URL, and model; forward them to the worker.
- [ ] Run the relevant Go package tests and worker tests.

### Task 4: Settings and per-generation provider picker

**Files:**
- Modify: `dashboard/src/components/AISettingsPanel.jsx`
- Modify: `dashboard/src/components/AISettingsPanel.test.jsx`
- Modify: `dashboard/src/App.jsx` (or the existing generation form component identified during implementation)
- Add/modify: focused dashboard tests for settings persistence, installed-model state, and job headers

- [ ] Add tests for local URL/model persistence, refresh/test states, empty model state, and generated clip-job headers.
- [ ] Add a Local models section with default URL `http://host.docker.internal:11434`, editable model name, installed-model discovery, and a refresh/test action.
- [ ] Show `ollama pull <selected-model>` when the selected model is not installed; do not download it automatically.
- [ ] Add a Clip analysis choice immediately before Generate; default it to the configured Settings provider and offer the local model only when discovered/configured.
- [ ] Disable invalid local selection with a clear Settings link/state; pass the selected option in dedicated request headers.
- [ ] Run dashboard format, format check, lint, and focused Vitest tests.

### Task 5: Idle model lifecycle for Speaches and YAMNet

**Files:**
- Modify: `docker-compose.yml`
- Modify: `services/local_audio_events/app/main.py`
- Modify: `services/local_audio_events/app/detector.py` only if the detector needs an explicit release hook
- Modify: `services/local_audio_events/tests/test_api.py`
- Add/modify: Speaches lifecycle configuration tests or compose validation checks

- [ ] Add service tests proving YAMNet loads on its first detection request, remains reusable while active, unloads after 60 seconds idle, and health stays healthy while unloaded.
- [ ] Remove `speaches-model-init` from normal startup and dependency ordering; configure `STT_MODEL_TTL` to default to 60 seconds and retain the persistent cache volume.
- [ ] Implement an injectable lazy detector lifecycle and idle cleanup with garbage collection.
- [ ] Run local-audio-events tests and validate the Compose configuration.

### Task 6: Integration verification and delivery

**Files:**
- Modify any implementation files identified by failures above; no unrelated cleanup.

- [ ] Run all focused Python, Go, and dashboard tests from Tasks 1–5.
- [ ] Run the repository local CI/security steps applicable to Python, Go, and dashboard changes.
- [ ] Run `graphify update . --no-cluster` with `GRAPHIFY_MAX_WORKERS=2` and review the updated graph status.
- [ ] Inspect `git diff --check`, changed paths, and the full staged diff; preserve unrelated changes.
- [ ] Request independent review of the intended code diff, fix confirmed issues, then request follow-up review before committing.
- [ ] Commit the implementation with a change-type-scoped message.
- [ ] Restart the local app with `scripts/manage-local.ps1 -Action Restart`, then run `-Action Status` and focused health checks.
