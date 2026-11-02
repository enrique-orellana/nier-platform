+# Provider-Agnostic Audio Tracks and Clip Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make speech transcription, sound-event tracks, and clip selection configurable through service endpoints while keeping timeline construction and candidate validation independent of the selected provider.

**Architecture:** Put provider-specific HTTP protocols behind reusable, typed adapters. A shallow common provider base shares configuration and transport behavior; focused transcription, sound-event, and clip-analysis interfaces keep each component independently replaceable. A registry/factory maps environment-selected provider names to concrete adapters, and a dependency-injected coordinator composes them without provider branches. Normalize speech and event responses into one absolute-time, multi-track timeline, then send that timeline through the configured clip-analysis adapter. Compatible local and remote endpoints are selected through environment configuration; a provider with a proprietary protocol needs one adapter registration, after which the coordinator remains unchanged. No stage silently switches providers or manufactures heuristic clips after analysis failure.

**Tech Stack:** Python, httpx, FFmpeg, pytest, Docker Compose, existing Codex/OpenRouter/LM Studio adapters.

---

## Scope and fixed contracts

- Preserve the existing transcript fields: text, segments, and segments[].words.
- Add a canonical tracks collection with separate speech and sound-event tracks. Keep source-video absolute timestamps and stable IDs.
- The ASR adapter returns the existing transcript shape plus optional provider metadata and optional embedded event tracks.
- A standalone event API uses a versioned JSON contract: POST /v1/audio/events accepts an audio file and model name, and returns {"events":[{"start":12.4,"end":13.3,"label":"Laughter","confidence":0.82}]}. Times are relative to the submitted chunk; the caller adds the chunk's source offset.
- A service that implements a supported protocol can be selected by changing environment values only. A proprietary protocol needs one adapter implementation; the pipeline remains unchanged.
- Provider failure or invalid output fails the job. Do not switch providers or generate heuristic candidates.
- Endpoint, model, and provider selection come from environment configuration for this pipeline; request headers may still provide the existing transcription-language hint but cannot silently switch the configured service.
- Preserve the OpenRouter transcription wrapper used by saasshorts.py; change the clip-discovery path without breaking SaaS subtitle transcription.
- Model runtimes and weights remain separate services managed independently. This plan configures and consumes their APIs; it does not bake model weights into the backend image.
- OpenShorts can serialize its analysis jobs, but CPU-thread and container limits for a separately managed local model server must be set in that server's own environment or Compose file.

## File map

- Modify ai_client.py: keep existing chat endpoints as adapter implementations; add an OpenAI-compatible adapter for local or remote chat endpoints and preserve the chat_json facade.
- Create analysis_providers.py: provider interfaces/base, typed config/domain records, registry/factories, installable `openshorts.analysis_providers` entry points, OpenRouter and OpenAI-compatible ASR adapters, event-service adapter, and strict response normalization.
- Modify highlight_generation.py: extract a reusable chunked-transcription component; inject a transcription provider, retain chunking/timestamp offsets, and preserve the legacy OpenRouter wrapper used by other features.
- Modify transcript_windows.py: expose canonical speech/event tracks through reusable timeline-builder functions/classes and include in-window events in compact analysis windows; preserve existing word and segment IDs.
- Create analysis_job_lock.py: acquire configurable cross-process slots around AI analysis only, using the existing filelock dependency.
- Modify main.py: expose a reusable `ClipDiscoveryPipeline` with an injected analysis provider, collect event tracks, provide them to every analysis mode, validate one candidate contract, and surface analysis failures instead of falling back to heuristic clips.
- Modify docker-compose.yml and .env.example: pass ASR/event settings to the backend without placing credentials in image files or logs.
- Create tests/test_analysis_providers.py and tests/test_analysis_job_lock.py; update tests/test_highlight_generation.py, tests/test_transcript_windows.py, tests/test_main_transcription.py, tests/test_main_generation_pipeline.py, and relevant tests/test_ai_client_*.py.

### Reusable component contract

- Keep inheritance shallow: a small `AnalysisProvider` base may share config validation, HTTP transport, and sanitized service errors; `TranscriptionProvider`, `AudioEventProvider`, and `ClipAnalysisProvider` define focused operations.
- A `ProviderRegistry` maps stable provider IDs to factories per capability. Built-in adapters register at startup; an additional Python package can register a new adapter without modifying orchestration. Endpoint-compatible providers remain configuration-only.
- `AudioAnalysisPipeline` composes speech, optional event, and timeline components. `ClipDiscoveryPipeline` consumes normalized tracks and an analysis provider. Each accepts dependencies through constructors so tests and future services can replace any component.
- Domain records and serialized timeline contracts contain no credentials or transport objects. Adapters normalize responses at their boundary; the core works with validated records only.
- Do not introduce runtime plugin discovery from arbitrary folders or provider-specific conditionals in `main.py`; plugin registration must be explicit and deterministic.

## Required repository workflow

Before modifying code symbols, run GitNexus impact({target, direction: "upstream"}) for each affected symbol and report callers, affected flows, and risk. Required targets: transcribe_audio_openrouter, transcribe_video_with_config, build_analysis_timeline, compact_timeline_for_prompt, build_analysis_windows, get_viral_clips, and _finalize_clip_analysis_result. Review HIGH or CRITICAL risk before editing.

Before each implementation commit, run GitNexus detect_changes() and confirm the changed symbols and flows match the task. After implementation, commit only the feature files, apply the backend changes with .\scripts\manage-local.ps1 -Action Restart -Component backend, run .\scripts\manage-local.ps1 -Action Status, and execute the focused clip-discovery smoke check.

---

### Task 1: Configure provider-neutral chat and transcription services

**Files:**
- Modify: ai_client.py
- Modify: docker-compose.yml
- Modify: .env.example
- Test: tests/test_ai_client_openrouter.py
- Test: tests/test_ai_client_codex.py
- Create: tests/test_analysis_providers.py

- [ ] **Step 1: Add failing tests for explicit transcription settings**

In tests/test_analysis_providers.py, test that the loader reads AI_TRANSCRIPTION_PROVIDER, AI_TRANSCRIPTION_BASE_URL, AI_TRANSCRIPTION_MODEL, and AI_TRANSCRIPTION_API_KEY from the environment, accepts a third-party provider ID for registry lookup, rejects missing required configuration for built-in adapters, and requires explicit ASR selection when the active chat provider is not OpenRouter. Use a concrete local test endpoint: http://127.0.0.1:8000/v1.

    def test_transcription_config_uses_explicit_service_settings(monkeypatch):
    monkeypatch.setenv("AI_TRANSCRIPTION_PROVIDER", "openai-compatible")
        monkeypatch.setenv("AI_TRANSCRIPTION_BASE_URL", "http://127.0.0.1:8000/v1")
        monkeypatch.setenv("AI_TRANSCRIPTION_MODEL", "whisper-small")
        monkeypatch.setenv("AI_TRANSCRIPTION_API_KEY", "")
        config = load_transcription_config()
        assert config.provider == "openai-compatible"
        assert config.base_url == "http://127.0.0.1:8000/v1"
        assert config.model == "whisper-small"
        assert config.api_key == ""

    def test_local_chat_requires_explicit_transcription_provider():
        with pytest.raises(ValueError, match="AI_TRANSCRIPTION_PROVIDER must be set explicitly"):
            load_transcription_config({"AI_PROVIDER": "lmstudio"})

    def test_openrouter_chat_preserves_legacy_transcription_default():
        config = load_transcription_config({"AI_PROVIDER": "openrouter"})
        assert config.provider == "openrouter-json"

Run: python -m pytest tests/test_analysis_providers.py -q
Expected: FAIL because the loader does not exist.

- [ ] **Step 2: Add one OpenAI-compatible chat adapter**

Add an openai-compatible branch to AIConfig.normalized_provider() and chat_completion() in ai_client.py. POST to {AI_BASE_URL}/chat/completions, use a bearer key only when configured, send AI_MODEL or AI_ANALYZE_MODEL, and preserve JSON extraction through chat_json(). Make base-URL path handling provider-specific so a configured prefix such as /v1 or /api/v1 is preserved. Do not add provider-specific branches to main.py.

- [ ] **Step 3: Test chat provider selection**

Mock the HTTP response for a request to http://127.0.0.1:11434/v1/chat/completions. Assert chat_json() returns the parsed object, sends the configured model, and does not contact another endpoint. Also configure http://127.0.0.1:9000/api/v1 and assert the generic adapter requests /api/v1/chat/completions rather than dropping the prefix. Keep the existing OpenRouter and Codex adapter tests unchanged.

Run: python -m pytest tests/test_ai_client_openrouter.py tests/test_ai_client_codex.py tests/test_analysis_providers.py -q
Expected: PASS with the new generic adapter and existing provider tests.

- [ ] **Step 4: Add transcription settings to Compose and the example env**

Pass AI_TRANSCRIPTION_PROVIDER, AI_TRANSCRIPTION_BASE_URL, AI_TRANSCRIPTION_API_KEY, AI_TRANSCRIPTION_MODEL, and AI_TRANSCRIPTION_LANGUAGE to the backend in docker-compose.yml. Also pass the existing AI_API_KEY for remote chat. Leave the ASR provider and endpoint unset by default in Compose; infer the legacy OpenRouter ASR only when the active chat provider is OpenRouter. With another active chat provider, require an explicit ASR provider so audio is never sent to OpenRouter by accident. Built-in and installed plugin IDs select the adapter. Document endpoint selection in .env.example, and never log credentials.

Run: docker compose config --quiet
Expected: exit code 0 with no resolved configuration printed.

- [ ] **Step 5: Run GitNexus impact review and commit**

Run detect_changes(); confirm only provider dispatch and its config/tests changed. Commit as feat: add configurable analysis provider adapters.

---

### Task 2: Route chunked transcription through a generic ASR adapter

**Files:**
- Create: analysis_providers.py
- Modify: highlight_generation.py:144
- Modify: ai_client.py:772
- Test: tests/test_analysis_providers.py
- Test: tests/test_highlight_generation.py
- Test: tests/test_main_transcription.py

- [ ] **Step 1: Add failing tests for supported ASR protocols**

Mock HTTP calls and verify:
  - openrouter-json preserves the existing OpenRouter JSON request and optional route hint;
  - openai-compatible sends multipart file, model, language, verbose_json, and word/segment timestamp granularity;
  - equivalent local and remote responses normalize to the same text, segments, words, and language;
  - openrouter-json may use existing AI_API_KEY when AI_TRANSCRIPTION_API_KEY is unset only if chat analysis also uses OpenRouter, while openai-compatible never reuses AI_API_KEY;
  - unknown protocols and malformed responses raise clear errors without invoking a second adapter.

Run: python -m pytest tests/test_analysis_providers.py -q
Expected: FAIL until the adapters and normalizer exist.

- [ ] **Step 2: Implement the ASR boundary**

In analysis_providers.py define immutable TranscriptionProviderConfig and transcribe_audio_chunk(path, config). Dispatch only on the configured protocol:
  - openrouter-json uses the current OpenRouter JSON audio request;
  - openai-compatible uses the standard multipart /audio/transcriptions endpoint for Speaches-style local or compatible external services.

Normalize both responses into the transcript shape already consumed by the app. Require non-empty text and positive, finite segment/word ranges. Keep errors readable and redact keys and audio data. Retain transcribe_audio_openrouter() as a compatibility wrapper for saasshorts.py.

Use AI_TRANSCRIPTION_API_KEY for the ASR call. For openrouter-json only, accept AI_API_KEY as a legacy key alias when the dedicated key is unset and chat analysis is also configured for OpenRouter. Never send a local chat key to an OpenRouter endpoint; never send AI_API_KEY to an openai-compatible endpoint unless it was also explicitly configured as AI_TRANSCRIPTION_API_KEY.

- [ ] **Step 3: Verify both adapters**

Run: python -m pytest tests/test_analysis_providers.py tests/test_ai_client_openrouter.py -q
Expected: PASS, including legacy OpenRouter behavior.

- [ ] **Step 4: Make chunk orchestration provider-neutral**

In highlight_generation.py replace the direct transcribe_audio_openrouter import and call with transcribe_audio_chunk. Keep FFmpeg mono extraction, chunk size/overlap, and merge_transcript_segments(). Add range_start to each returned segment and word offset so selected source ranges retain absolute video timestamps. Log the configured provider name, not a hard-coded provider.

- [ ] **Step 5: Test offsets, overlap, and failure behavior**

Extend tests/test_highlight_generation.py to cover overlapping chunks, duplicate-word merging, a non-zero source range, segment-only responses, and a selected provider error that never calls another adapter.

Run: python -m pytest tests/test_highlight_generation.py tests/test_main_transcription.py tests/test_analysis_providers.py -q
Expected: PASS with absolute source timestamps and strict selected-provider errors.

- [ ] **Step 6: Run GitNexus impact review and commit**

Run detect_changes(); confirm the ASR flow changed only through the provider adapter and chunk orchestrator. Commit as refactor: make clip transcription provider agnostic.

---

### Task 3: Normalize speech and sound events as separate timeline tracks

**Files:**
- Modify: analysis_providers.py
- Modify: transcript_windows.py:54
- Modify: transcript_windows.py:223
- Modify: transcript_windows.py:269
- Test: tests/test_analysis_providers.py
- Test: tests/test_transcript_windows.py

- [ ] **Step 1: Add failing event and window tests**

Use a transcript fixture and a laugh event at 12.4–13.3 seconds. Assert that the transcript segments and words remain unchanged; the event gets its own stable ID and confidence; invalid bounds, labels, or confidence are rejected; and a compact window includes only events intersecting its time range. Assert that an event crossing a context-window boundary appears in every intersecting window.

Run: python -m pytest tests/test_transcript_windows.py -q
Expected: FAIL because the timeline currently contains no event track.

- [ ] **Step 2: Implement the event-service adapter**

Add AudioEventProviderConfig and detect_audio_events(path, config) to analysis_providers.py. For openshorts-events-v1, POST the audio and model to {base_url}/v1/audio/events and require an events array with start, end, label, and confidence. Normalize IDs and source metadata. Support explicit none and embedded modes; a selected HTTP provider error or invalid response must fail.

- [ ] **Step 3: Extend the canonical timeline**

Update build_analysis_timeline() to preserve timestamp_mode, segments, and words while adding:
  - a speech track referencing canonical word/segment IDs and existing absolute times;
  - a sound_events track containing normalized event records.

Update compact_timeline_for_prompt() to include events intersecting the context interval. Count event payload against the existing prompt-size limit. Keep timeline_units_by_id() and resolve_candidate_bounds() based on speech IDs only.

- [ ] **Step 4: Verify the new track contract**

Run: python -m pytest tests/test_transcript_windows.py tests/test_analysis_providers.py -q
Expected: PASS; transcript-only fixtures retain the same speech IDs and fields, and events never appear as words.

- [ ] **Step 5: Run GitNexus impact review and commit**

Run detect_changes(); confirm only track normalization, event handling, and prompt-window serialization changed. Commit as feat: add normalized sound-event timeline tracks.

---

### Task 4: Analyze tracks through the configured provider and fail strictly

**Files:**
- Modify: main.py:172
- Modify: main.py:2677
- Modify: main.py:2758
- Modify: docker-compose.yml
- Modify: .env.example
- Test: tests/test_main_generation_pipeline.py
- Test: tests/test_transcript_windows.py
- Test: tests/test_ai_client_openrouter.py
- Test: tests/test_ai_client_codex.py

- [ ] **Step 1: Add failing multi-provider prompt tests**

Create one fixture with speech, a laugh, and applause. Run the same normalized data through OpenRouter, Codex, and an OpenAI-compatible local chat adapter. Assert the prompt uses identical track content, absolute times, and canonical speech IDs for each provider. Assert candidate validation rejects event IDs as speech boundaries and rejects candidates outside the source or outside the 15–60 second range.

Run: python -m pytest tests/test_main_generation_pipeline.py tests/test_transcript_windows.py -q
Expected: FAIL because prompts do not currently include sound events.

- [ ] **Step 2: Merge configured event data before analysis**

Before calling get_viral_clips(), merge event tracks returned by the ASR service with the explicitly selected event-service response. In embedded mode require the ASR response to include valid event data; in none mode pass an empty event track. A selected event provider error fails the job.

- [ ] **Step 3: Use one prompt and candidate contract**

Update the windowed and complete-file analysis paths in main.py to pass relevant speech/event tracks to chat_json(). State in the prompt that events are evidence, not speech, and only supplied IDs/timestamps may be referenced. Keep the existing candidate JSON shape, resolve_candidate_bounds(), dedupe_clip_candidates(), clip limits, and persistence behavior. Provider transport remains in ai_client.py adapters.

- [ ] **Step 4: Remove heuristic fallback after provider failure**

When all configured analysis requests fail, the response is invalid, or no candidate survives validation, raise a clip-analysis error through the worker so the job ends in failed status. Do not call _build_fallback_clip_plan(), change provider, or change endpoint. Keep retries, if retained, against the same configured endpoint only. Once the impact check confirms _build_fallback_clip_plan() has no remaining caller, remove the dead helper.

- [ ] **Step 5: Test the strict failure and common-result behavior**

Run: python -m pytest tests/test_main_generation_pipeline.py tests/test_ai_client_openrouter.py tests/test_ai_client_codex.py tests/test_transcript_windows.py -q
Expected: PASS; all providers use the same candidate contract, and errors never invoke another provider or the heuristic generator.

- [ ] **Step 6: Run GitNexus impact review and commit**

Run detect_changes(); confirm clip analysis consumes canonical tracks and provider-specific transport remains behind adapters. Commit as feat: analyze audio tracks with configured provider.

---

### Task 5: Limit concurrent clip-discovery AI pipelines

**Files:**
- Create: analysis_job_lock.py
- Modify: main.py
- Modify: docker-compose.yml
- Test: tests/test_analysis_job_lock.py
- Test: tests/test_main_generation_pipeline.py

- [ ] **Step 1: Add a failing cross-process lock test**

Use Python multiprocessing with a temporary lock directory and limit 1. Start three workers; each acquires a slot, increments a shared active count, sleeps briefly, and decrements the count. Assert the maximum active count is exactly 1. Repeat with limit 2 and assert it never exceeds 2.

Run: python -m pytest tests/test_analysis_job_lock.py -q
Expected: FAIL because the shared analysis slot does not exist.

- [ ] **Step 2: Implement numbered file-lock slots**

Use the existing filelock dependency from requirements.txt. Implement acquire_analysis_slot(lock_dir, limit) as a context manager over limit persistent FileLock slots. Poll slots in a bounded interval, acquire the first available slot, and release it in finally. Reject non-positive limits. The OS lock must be shared across Python worker processes in the backend container.

- [ ] **Step 3: Hold a slot only during clip-discovery AI work**

In main.py, acquire one slot around transcription, event detection, timeline analysis, and clip-plan persistence. Release it before rendering so render jobs can continue in parallel. Read AI_ANALYSIS_CONCURRENCY from the backend environment and use a shared lock directory under /app/output/.openshorts/audio-analysis-locks so all worker processes use the same slots.

- [ ] **Step 4: Wire concurrency configuration and test it**

Pass AI_ANALYSIS_CONCURRENCY and LOCAL_AUDIO_ANALYSIS_LOCK_DIR to the backend in docker-compose.yml. Add AI_ANALYSIS_CONCURRENCY=1 and a persistent lock-directory example to .env.example. Test invalid values and assert render work is not inside the lock scope.

Run: python -m pytest tests/test_analysis_job_lock.py tests/test_main_generation_pipeline.py -q
Expected: PASS; clip-discovery AI concurrency respects the configured limit, while rendering is not serialized by this lock.

- [ ] **Step 5: Run GitNexus impact review and commit**

Run detect_changes(); confirm only the AI analysis stage is serialized. Commit as feat: limit concurrent clip analysis jobs.

---

### Task 6: Finish configuration and verify the running backend

**Files:**
- Modify: docker-compose.yml
- Modify: .env.example
- Modify: docs/superpowers/specs/2026-11-02-local-audio-analysis-clip-selection-design.md
- Test: tests/test_analysis_providers.py
- Test: tests/test_highlight_generation.py
- Test: tests/test_main_generation_pipeline.py

- [ ] **Step 1: Document the complete environment contract**

Document and pass these values to the backend:
  - AI_TRANSCRIPTION_PROVIDER, AI_TRANSCRIPTION_BASE_URL, AI_TRANSCRIPTION_MODEL, AI_TRANSCRIPTION_LANGUAGE, and AI_TRANSCRIPTION_API_KEY;
  - AUDIO_EVENT_PROVIDER with explicit values none, embedded, or openshorts-events-v1, plus AUDIO_EVENT_BASE_URL, AUDIO_EVENT_MODEL, AUDIO_EVENT_API_KEY, and AUDIO_EVENT_MIN_CONFIDENCE;
  - existing AI_PROVIDER, AI_BASE_URL, AI_API_KEY, and AI_ANALYZE_MODEL for clip selection; use AI_PROVIDER=openai-compatible with an Ollama-compatible URL for a local Ollama model, or keep the existing Codex/OpenRouter values for those adapters;
  - AI_ANALYSIS_CONCURRENCY, default 1, and LOCAL_AUDIO_ANALYSIS_LOCK_DIR.

Add AI_API_KEY to the backend service environment in docker-compose.yml; do not print its resolved value during configuration review.

Provider and protocol must be explicit for the new ASR/event stages. A compatible service is selected by URL, model, and credentials; a custom protocol requires an adapter once. Do not store credentials in timeline records, logs, or the example env file.

When a configured endpoint is local, cap its CPU threads and Docker CPU/memory in the endpoint's own service configuration. The OpenShorts worker can enforce AI_ANALYSIS_CONCURRENCY but cannot impose resource limits on a separately managed endpoint.

- [ ] **Step 2: Test configuration errors without network calls**

Test an unsupported protocol, missing base URL, missing key for a key-protected provider, invalid concurrency, and explicit event mode none. Each invalid configuration must fail during configuration validation; none may attempt another provider.

Run: python -m pytest tests/test_analysis_providers.py tests/test_analysis_job_lock.py -q
Expected: PASS with deterministic errors and no HTTP requests.

- [ ] **Step 3: Run focused regressions**

Run: python -m pytest tests/test_analysis_providers.py tests/test_highlight_generation.py tests/test_transcript_windows.py tests/test_main_transcription.py tests/test_main_generation_pipeline.py tests/test_ai_client_openrouter.py tests/test_ai_client_codex.py -q
Expected: PASS; OpenRouter and Codex integrations remain compatible, and SaaS subtitle callers retain their legacy behavior.

- [ ] **Step 4: Validate Compose without exposing resolved values**

Run: docker compose config --quiet
Expected: exit code 0 with no rendered configuration output.

- [ ] **Step 5: Review, detect scope, commit, and restart the backend**

Review git status --short and git diff. Stage only the files in this plan. Run GitNexus detect_changes() and confirm changed symbols and execution flows are limited to providers, tracks, clip analysis, tests, and configuration. Commit as feat: make audio track analysis provider agnostic.

Apply and inspect the local backend:

    .\scripts\manage-local.ps1 -Action Restart -Component backend
    .\scripts\manage-local.ps1 -Action Status

Run one clip-discovery smoke flow with a local endpoint and one with a compatible remote endpoint. Confirm both produce the same canonical track/candidate shape, only configured services receive requests, event labels stay out of subtitles, and failed configured services report an error.

---

## Plan self-review

- **Spec coverage:** configurable service endpoints and adapters (Tasks 1, 2, 6); absolute-time ASR chunk normalization (Task 2); independent speech/event tracks and overlapping windows (Task 3); provider-neutral selection, candidate validation, and strict failure (Task 4); configurable cross-process concurrency (Task 5); runtime wiring and verification (Task 6).
- **No provider fallback:** a selected service failure cannot switch endpoints or generate heuristic candidates.
- **Compatibility:** OpenRouter and Codex remain available; the SaaS subtitle caller keeps its existing OpenRouter wrapper.
- **Protocol boundary:** configuration-only switching is guaranteed for supported protocols. An incompatible API needs one adapter before it can be selected by configuration.
