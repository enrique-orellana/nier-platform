# OpenAI File-Input Clip Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Analyze one complete absolute-timestamp transcript file in a single model request—using the connected Codex CLI for “Connect with Codex” deployments or the official OpenAI Responses API when a server key is configured—validate returned clip evidence locally, and preserve the existing lossless windowed fallback when the file cannot fit or the file path is unavailable.

**Architecture:** Keep the existing canonical timeline and timestamp resolver as the source of truth. Add a JSONL transcript artifact writer, a public OpenAI Files/Responses transport, and a Codex CLI transport that reuses the connected ChatGPT OAuth account. The clip pipeline selects one complete-file transport when configured, validates model evidence against canonical IDs and coverage, ranks clips globally, and falls back to the existing overlapping-window path in `auto` mode.

**Tech Stack:** Python 3.12, `httpx`, JSONL, official Codex CLI, OpenAI Files API, OpenAI Responses API, existing `transcript_windows.py` and `main.py` pipeline, pytest, Docker Compose, GitNexus.

---

## Current implementation constraints

- The existing `openai-codex` provider uses ChatGPT/Codex OAuth and a private endpoint; it must remain available.
- Connected Codex users must not need a separate `OPENAI_API_KEY`; the worker uses the installed Codex CLI with a temporary translated auth file.
- A server-side `OPENAI_API_KEY` remains supported for the public OpenAI Files/Responses transport.
- The complete artifact must carry absolute source timestamps for every segment and word.
- The model must return canonical IDs whenever possible; local code resolves IDs to exact source timestamps.
- The model response must prove that it reviewed the complete source range.
- No silent truncation is allowed. If the file is too large, `file` mode fails clearly and `auto` mode uses the existing overlapping windows.
- The remote file must be deleted in a `finally` path after analysis.
- API keys must never appear in logs, job metadata, exception strings, or persisted transcript artifacts.
- Existing providers and legacy behavior must remain unchanged unless the new mode is explicitly selected.

## File map

| File | Change |
|---|---|
| `transcript_windows.py` | Add the complete JSONL artifact writer and full-file response validator. |
| `tests/test_transcript_windows.py` | Test JSONL structure, absolute timings, ID resolution, coverage validation, and invalid candidates. |
| `ai_client.py` | Add public OpenAI Files/Responses and connected Codex CLI transports with parsing, no forced request timeout, and sanitized errors. |
| `tests/test_openai_file_analysis.py` | Mock the public API and Codex CLI; verify request shape, OAuth translation, timeout behavior, parsing, errors, and cleanup. |
| `main.py` | Add configuration helpers, full-file prompt construction, mode selection, integration, and shared finalization. |
| `tests/test_clip_analysis_prompt.py` | Test full-file prompt construction, file-path integration, fallback behavior, metadata, and exact returned bounds alongside the existing windowed-path tests. |
| `tests/test_openai_file_analysis_config.py` | Test file-analysis mode normalization, provider/key eligibility, model selection, and base URL handling. |
| `.env.example` | Document server-only OpenAI file-analysis configuration. |
| `docker-compose.yml` | Pass the new backend environment variables into the local backend container. |
| `docs/superpowers/specs/2026-09-01-openai-file-input-clip-analysis-design.md` | Approved design reference; do not revise unless implementation discovers a material contract change. |

## Task 0: Refresh code intelligence and establish a clean baseline

- [ ] Confirm the current checkout and existing user changes.

  ~~~powershell
  git status --short
  git log -5 --oneline
  ~~~

  Expected result: the approved design commit is present, and no unrelated file is modified by this implementation.

- [ ] Refresh the GitNexus index from the repository root.

  ~~~powershell
  node .gitnexus/run.cjs analyze
  ~~~

  Expected result: analysis completes successfully and the repository index reflects the current source.

- [ ] Run upstream impact analysis before editing any existing symbol. Inspect these symbols individually:

  - `get_viral_clips`
  - `build_analysis_timeline`
  - `resolve_candidate_bounds`
  - `dedupe_clip_candidates`
  - `chat_completion`
  - `chat_json`

  Use GitNexus `impact({target: ..., direction: "upstream"})` and record direct callers, affected processes, and risk. If any result is HIGH or CRITICAL, report the blast radius and revise the integration boundary before editing that symbol.

- [ ] Run the focused baseline tests before making code changes.

  ~~~powershell
  python -m pytest -q tests/test_transcript_windows.py
  python -m pytest -q tests
  ~~~

  Expected result: baseline tests pass, or any pre-existing failures are recorded with their exact test names and kept separate from new failures.

## Task 1: Write a complete canonical transcript artifact

**Files:** `transcript_windows.py`, `tests/test_transcript_windows.py`

- [ ] Add a failing test for a new function with this interface:

  ~~~python
  def write_analysis_timeline_jsonl(
      timeline: Mapping[str, Any],
      destination: str | Path,
  ) -> dict[str, Any]:
      """Write complete canonical segments with nested absolute word timing."""
  ~~~

- [ ] The test fixture must include at least two segments, non-zero segment offsets, word-level timings, punctuation, and a segment without word timings. Assert that:

  - exactly one JSON object is written per canonical segment;
  - the output is valid UTF-8 JSONL;
  - each record has `schema_version: 1`, `unit_type: "segment"`, a stable zero-padded `unit_id`, `segment_id`, `start`, `end`, `text`, and a `words` array;
  - word IDs, word starts, and word ends are preserved when available;
  - segment and word timestamps are absolute, not relative to a window;
  - the return value includes `path`, `record_count`, `bytes`, and `timestamp_mode`;
  - no source segment is omitted.

- [ ] Run the focused test and confirm it fails because the writer does not exist.

  ~~~powershell
  python -m pytest -q tests/test_transcript_windows.py -k jsonl
  ~~~

- [ ] Implement the writer using the already-built `timeline["segments"]` and `timeline["words"]` structures. Do not reconstruct timestamps from text. Preserve the timeline's `timestamp_mode`; when a segment has no words, emit `words: []`.

- [ ] Use deterministic JSON serialization suitable for token estimation and reproducible tests:

  - UTF-8;
  - one compact JSON object per line;
  - stable key ordering;
  - newline after every record;
  - no transcript content in application logs.

- [ ] Re-run the focused tests, then the complete transcript-window test module.

  ~~~powershell
  python -m pytest -q tests/test_transcript_windows.py -k jsonl
  python -m pytest -q tests/test_transcript_windows.py
  ~~~

- [ ] Commit this isolated change after tests pass.

  ~~~powershell
  git add -- transcript_windows.py tests/test_transcript_windows.py
  git commit -m "feat: write complete timestamped transcript artifacts"
  ~~~

## Task 2: Add the public and connected-Codex file transports

**Files:** `ai_client.py`, `tests/test_openai_file_analysis.py`

- [ ] Add red tests using a fake or mocked `httpx.Client` and fake Codex CLI. The tests must verify the public request sequence and the connected-Codex local-artifact sequence:

  1. `POST {base_url}/files` with multipart file content and `purpose=user_data`;
  2. `POST {base_url}/responses` with the uploaded file ID;
  3. `DELETE {base_url}/files/{file_id}` in cleanup.

- [ ] Assert the Responses request body is equivalent to:

  ~~~json
  {
    "model": "configured-model",
    "store": false,
    "input": [
      {
        "role": "user",
        "content": [
          {
            "type": "input_text",
            "text": "analysis prompt"
          },
          {
            "type": "input_file",
            "file_id": "file-test-123"
          }
        ]
      }
    ]
  }
  ~~~

  The request must include the bearer key in the HTTP header, but tests must assert that it is absent from audit payloads and raised error messages.

- [ ] Add a cleanup test where the Responses request raises an HTTP error. Assert that the DELETE request still occurs and that the original analysis exception is preserved if cleanup also fails.

- [ ] Add parsing tests for:

  - a normal `output_text` response;
  - a response whose text is nested in output message content;
  - fenced JSON that requires the existing `extract_json_text` helper;
  - malformed JSON;
  - missing output text.

- [ ] Add error tests for HTTP 401, 413, 429, 500, invalid upload response, invalid response payload, and delete failures. Errors must be actionable but must not include the API key.

- [ ] Implement a public transport function with this interface:

  ~~~python
  def openai_file_analysis_json(
      file_path: str | Path,
      prompt: str,
      *,
      model: str,
      api_key: str,
      base_url: str = OPENAI_API_BASE_URL,
  ) -> dict[str, Any]:
  ~~~

- [ ] Implement the connected-Codex transport for deployments that have a
  dashboard “Connect with Codex” credential but no public API key. Resolve the
  installed official `codex` executable, create a temporary `CODEX_HOME`,
  translate the stored OpenShorts OAuth credential into the CLI `auth.json`
  shape, and invoke `codex exec` with the complete artifact in a read-only
  working directory. Do not send the ChatGPT OAuth token to the public OpenAI
  API, persist the temporary auth directory, or expose the transcript in logs.

- [ ] Do not impose the previous 180-second streaming timeout on either
  complete-file transport. The Codex CLI process must be allowed to finish;
  failures are surfaced through its exit status and sanitized diagnostics.

- [ ] Upload with `httpx` multipart form data and request a short-lived user-data file. Use a one-day expiration where the API supports it:

  ~~~python
  data = {
      "purpose": "user_data",
      "expires_after[anchor]": "created_at",
      "expires_after[seconds]": "86400",
  }
  ~~~

  Do not log the file body, prompt, bearer token, or full response.

- [ ] Make the analysis request non-streaming with `httpx.Client(timeout=None)`. This path must not inherit the previous 180-second streaming deadline. The caller may still provide an outer job-level cancellation policy; the transport itself must wait for the complete response.

- [ ] Parse the returned JSON through the existing JSON extraction utility. Accept `output_text` first, then the standard output-message content representation. Reject empty or malformed output with a typed runtime error that includes the operation and HTTP status where available.

- [ ] Always delete the remote file in `finally`. Cleanup failures must be logged as sanitized warnings and must not mask an earlier upload or analysis failure.

- [ ] Re-run the new test module and the relevant existing AI-client tests.

  ~~~powershell
  python -m pytest -q tests/test_openai_file_analysis.py
  python -m pytest -q tests -k "ai_client or codex or json"
  ~~~

- [ ] Commit the transport independently.

  ~~~powershell
  git add -- ai_client.py tests/test_openai_file_analysis.py
  git commit -m "feat: analyze transcript artifacts through OpenAI files"
  ~~~

## Task 3: Add configuration and Docker deployment wiring

**Files:** `main.py`, `.env.example`, `docker-compose.yml`, `tests/test_openai_file_analysis_config.py`

- [ ] Add normalized mode handling with exactly these values:

  - `auto`: for the `openai-codex` provider, use connected-Codex file analysis without a public key or the public OpenAI path when a key is present; otherwise use existing behavior;
  - `file`: require complete-file analysis; connected Codex does not require a public key;
  - `legacy`: always use the existing windowed path.

  The default must be `auto`.

- [ ] Keep `OPENAI_API_KEY` outside the existing `AIConfig` object if that object is serialized or logged. Read the key only at the backend call boundary and pass it directly to the transport.

- [ ] Add helpers with behavior equivalent to:

  ~~~python
  OPENAI_FILE_ANALYSIS_MODES = {"auto", "file", "legacy"}

  def openai_clip_analysis_mode() -> str:
      value = os.getenv("OPENAI_CLIP_ANALYSIS_MODE", "auto").strip().lower()
      if value not in OPENAI_FILE_ANALYSIS_MODES:
          raise ValueError(
              "OPENAI_CLIP_ANALYSIS_MODE must be one of: auto, file, legacy"
          )
      return value

  def should_use_openai_file_analysis(config: AIConfig) -> bool:
      mode = openai_clip_analysis_mode()
      if mode == "legacy":
          return False
      api_key = os.getenv("OPENAI_API_KEY", "").strip()
      provider = config.normalized_provider()
      if mode == "file" and provider != "openai-codex" and not api_key:
          raise ValueError(
              "OPENAI_API_KEY is required when OPENAI_CLIP_ANALYSIS_MODE=file"
          )
      return provider == "openai-codex"

  def openai_file_analysis_settings(config: AIConfig) -> dict[str, str]:
      model = (
          os.getenv("OPENAI_ANALYZE_MODEL", "").strip()
          or config.analyze_model
          or config.text_model
          or os.getenv("CODEX_MODEL", "").strip()
          or "gpt-5.4"
      )
      return {
          "api_key": os.getenv("OPENAI_API_KEY", "").strip(),
          "base_url": os.getenv(
              "OPENAI_BASE_URL",
              "https://api.openai.com/v1",
          ).strip().rstrip("/"),
          "model": model,
      }
  ~~~

  Resolve the exact existing `AIConfig` attribute names during implementation; do not add an API key field to any object that is emitted in job logs.

- [ ] Add these entries to `.env.example` with comments explaining that the key is server-only:

  ~~~dotenv
  OPENAI_API_KEY=
  OPENAI_BASE_URL=https://api.openai.com/v1
  OPENAI_CLIP_ANALYSIS_MODE=auto
  OPENAI_ANALYZE_MODEL=
  OPENAI_FILE_ANALYSIS_MAX_TOKENS=100000
  ~~~

  Keep the default mode `auto` so deployments use complete-file analysis when the connected Codex CLI is available and retain the lossless fallback otherwise.

- [ ] Add the same variables to the backend `environment` section of `docker-compose.yml`. Values must be read from the host `.env` file or environment; do not hard-code secrets in YAML. Confirm the portable compose file inherits the values as intended.

- [ ] Add configuration tests for default mode, normalization, invalid mode, auto mode with and without key, connected Codex without a public key, non-Codex providers, file mode eligibility, and model/base URL resolution.

- [ ] Validate compose syntax and run the configuration tests.

  ~~~powershell
  docker compose config --quiet
  python -m pytest -q tests -k "config or environment or compose"
  ~~~

- [ ] Commit deployment wiring separately.

  ~~~powershell
  git add -- main.py .env.example docker-compose.yml tests
  git commit -m "feat: configure OpenAI file clip analysis"
  ~~~

## Task 4: Build the full-file prompt and strict response validator

**Files:** `main.py`, `transcript_windows.py`, `tests/test_transcript_windows.py`, `tests/test_clip_analysis_prompt.py`

- [ ] Add a prompt-builder test asserting that a known source produces:

  - `FULL_SOURCE_RANGE_SECONDS: 0.000-1201.615`;
  - the actual `TIMESTAMP_MODE`;
  - explicit instruction to review the complete attached transcript;
  - `start_word_id` and `end_word_id` fields;
  - a required coverage object;
  - no chunk index, core range, or window overlap instructions.

- [ ] Implement a full-file prompt builder that includes:

  - source duration and exact source range;
  - timestamp mode;
  - the clip requirements already enforced by `GEMINI_PROMPT_TEMPLATE`;
  - a compact output schema;
  - the requirement that every candidate cite canonical segment or word IDs;
  - the requirement to return `coverage: {complete, start, end, units_reviewed}`;
  - the requirement to return `shorts: []` when no valid clip exists;
  - an instruction not to infer timestamps from transcript text or reset timestamps at file boundaries.

- [ ] Add a validator with this interface:

  ~~~python
  def validate_full_timeline_response(
      response: Mapping[str, Any],
      indexed_units: Mapping[str, Mapping[str, Any]],
      video_duration: float,
      *,
      timestamp_mode: str,
  ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
  ~~~

- [ ] Require valid coverage before accepting candidates:

  - `coverage.complete is true`;
  - `coverage.start <= 0.001`;
  - `coverage.end >= video_duration - 0.001`;
  - `units_reviewed` is a non-negative integer when present.

  Reject a response that claims only a partial range. In `auto` mode this rejection triggers the existing fallback; in `file` mode it returns an explicit incomplete-analysis error.

- [ ] Resolve each candidate through `resolve_candidate_bounds` using canonical IDs. Do not use model-provided float timestamps as the source of truth when IDs are present. Reject invalid IDs, reversed bounds, out-of-range values, unsupported duration, and candidates that cannot be mapped to the canonical timeline.

- [ ] Deduplicate with `dedupe_clip_candidates`, preserve evidence fields, and return coverage metadata for job logging.

- [ ] Add tests for complete coverage, incomplete coverage, ID-based exact bounds, float-only compatibility where currently supported, invalid IDs, out-of-range timestamps, reversed bounds, duplicate candidates, segment-only timelines, and no-clip responses.

- [ ] Run focused tests and commit.

  ~~~powershell
  python -m pytest -q tests/test_transcript_windows.py -k "full or coverage or candidate"
  python -m pytest -q tests -k "clip or transcript"
  git add -- main.py transcript_windows.py tests
  git commit -m "feat: validate complete-timeline clip evidence"
  ~~~

## Task 5: Integrate the file path with lossless fallback and shared finalization

**Files:** `main.py`, `tests/test_clip_analysis_prompt.py`

- [ ] Add integration tests before changing `get_viral_clips`. Mock:

  - the public file transport;
  - the JSONL writer or inspect the temporary artifact;
  - the existing windowed `chat_json` path.

  Assert the file path makes exactly one public file-analysis call, produces one artifact containing every segment, and does not call the windowed analyzer.

- [ ] Extract the current post-window finalization logic into a private helper, for example:

  ~~~python
  def _finalize_clip_analysis_result(
      result_json: dict[str, Any],
      *,
      transcript: dict[str, Any],
      video_duration: float,
      analysis_metadata: dict[str, Any],
      ai_config: AIConfig,
  ) -> dict[str, Any]:
      ...
  ~~~

  Preserve existing ranking, deduplication, clip limits, LM Studio stretching, legacy float snapping, and cost metadata. Run GitNexus impact analysis on the exact existing finalization symbol or call site before editing it.

- [ ] Add a file-analysis branch after the canonical timeline and indexed units are built, before constructing or iterating windows:

  1. read mode and settings;
  2. estimate artifact tokens from UTF-8 bytes using a documented conservative ratio such as `max(1, bytes // 4)`;
  3. compare against `OPENAI_FILE_ANALYSIS_MAX_TOKENS`;
  4. create a per-job temporary directory using `tempfile.TemporaryDirectory`;
  5. write the complete JSONL artifact;
  6. build the full-file prompt;
  7. call `openai_file_analysis_json` once;
  8. validate coverage and candidates;
  9. pass validated candidates through the shared finalizer;
  10. record mode, model, artifact record count, estimated tokens, coverage, and candidate counts without recording transcript text or secrets.

- [ ] Define fallback semantics precisely:

  - `legacy`: current windowed behavior byte-for-byte as far as practical;
  - `auto` with the `openai-codex` provider: try the connected-Codex CLI when no public key is configured, or the public Files/Responses transport when a key is configured;
  - `auto` file too large, CLI/API unavailable, upload failure, API failure, malformed response, or incomplete coverage: add a sanitized fallback reason and run the existing overlapping windows;
  - `file` with the `openai-codex` provider: require complete-file analysis; a missing CLI, missing public key on the public path, oversized input, CLI/API failure, malformed response, or incomplete coverage returns the existing transcript fallback shape with `analysis.incomplete=true` and an actionable sanitized `analysis.error`;
  - other providers in `auto`: retain their current behavior.

- [ ] Keep the existing lossless window construction unchanged for fallback. It must continue to use absolute timestamps, overlapping windows, core-range evidence, candidate resolution, retries, continuation, and missing-range reporting.

- [ ] Add assertions for the integration metadata:

  ~~~python
  assert analysis["mode"] in {"openai_file", "codex_file"}
  assert analysis["coverage"]["complete"] is True
  assert analysis["artifact"]["record_count"] == len(source_segments)
  assert analysis["windows_planned"] == 0
  ~~~

  For fallback:

  ~~~python
  assert analysis["mode"] == "windowed_fallback"
  assert analysis["fallback_reason"]
  assert analysis["windows_planned"] > 0
  ~~~

- [ ] Verify exact clip bounds in the file path against canonical timeline IDs. Include a candidate whose model floats are intentionally imprecise and assert the returned clip uses canonical word or segment timestamps.

- [ ] Run the focused integration tests, then commit.

  ~~~powershell
  python -m pytest -q tests -k "clip_analysis or viral_clips or openai_file"
  git add -- main.py tests
  git commit -m "feat: route Codex clip analysis through complete files"
  ~~~

## Task 6: Harden security, errors, and regression behavior

**Files:** `ai_client.py`, `main.py`, tests covering existing providers and audit logging

- [ ] Add a redaction test that places a fake API key in:

  - an HTTP exception;
  - an upload error;
  - a delete error;
  - a validation error;
  - an audit event.

  Assert the key is absent from every public log or returned error string.

- [ ] Add retry and status handling tests. The public file path must not retry indefinitely. Retry only where the existing HTTP policy explicitly supports it, with bounded attempts and sanitized diagnostics. A 413 or token-size rejection must immediately produce the configured fallback/error behavior.

- [ ] Add tests proving remote-file cleanup occurs for upload success, upload failure after file creation, analysis failure, malformed response, and successful analysis.

- [ ] Run all existing Codex, OpenRouter, Gemini, LM Studio, timeout, audit, and clip tests. Confirm the earlier Codex no-deadline behavior remains intact for the legacy private endpoint.

  ~~~powershell
  python -m pytest -q tests
  ~~~

- [ ] Review the diff for accidental changes to provider selection, existing prompts, timeout defaults, job status transitions, and response shapes.

## Task 7: Verify, commit, and update the running Docker deployment

- [ ] Run repository-wide verification before the final commit.

  ~~~powershell
  python -m pytest -q
  git diff --check
  git status --short
  ~~~

  Expected result: all tests pass, no whitespace errors, and only files belonging to this feature are modified.

- [ ] Refresh GitNexus after all implementation edits.

  ~~~powershell
  node .gitnexus/run.cjs analyze
  ~~~

- [ ] Run GitNexus `detect_changes()` before committing. Review changed symbols and execution flows against the intended file-analysis path, configuration path, and fallback path. If unexpected symbols or flows appear, investigate before committing.

- [ ] Commit the complete implementation only after the preceding checks pass.

  ~~~powershell
  git add -- ai_client.py main.py transcript_windows.py tests .env.example docker-compose.yml
  git commit -m "feat: support complete-file OpenAI clip analysis"
  ~~~

- [ ] Verify the local ignored `.env`/dashboard Codex connection with explicit trial mode. Do not commit or print credentials. A public key is optional for the connected-Codex path:

  ~~~powershell
  OPENAI_API_KEY=<optional server-side public key>
  OPENAI_CLIP_ANALYSIS_MODE=file
  OPENAI_ANALYZE_MODEL=<configured analysis model>
  ~~~

  If the connected Codex credential is not available, verify the deployment in `auto` mode and exercise the lossless fallback path instead of fabricating a live API result.

- [ ] Rebuild and restart the backend using the repository-managed workflow.

  ~~~powershell
  .\scripts\manage-local.ps1 -Action Restart -Component backend
  .\scripts\manage-local.ps1 -Action Status
  ~~~

  Expected result: the backend is running and the selected compose services are healthy. Volumes remain preserved.

- [ ] Run the backend health check and a focused smoke job. Verify only sanitized logs:

  - one transcript artifact creation;
  - for the public path, one Files upload, one Responses request containing `input_file`, and one remote file deletion;
  - for the connected-Codex path, one complete local JSONL artifact supplied to one read-only Codex CLI request;
  - complete coverage metadata;
  - exact canonical clip timestamps;
  - no chunk-window analysis messages on the successful file path;
  - no API key in container logs or job metadata.

- [ ] If the live file path fails, capture the sanitized HTTP status, mode, model, artifact size estimate, and coverage state. Do not switch silently to a different provider or claim deployment success until the backend restart and smoke check complete.

## Completion criteria

- The approved design is implemented without changing the existing provider contract.
- The complete transcript is attached once as a JSONL file with absolute segment and word timestamps.
- The model receives a single full-file Responses request and is required to report complete coverage.
- Returned clip timestamps are canonicalized locally and validated against the entire source.
- No candidate is lost solely because it crossed a chunk boundary.
- Oversized or unavailable file analysis has explicit, observable fallback behavior.
- Remote files are deleted after every attempted analysis.
- All tests pass, GitNexus `detect_changes()` matches the intended scope, and the backend restart plus health/smoke checks succeed.
