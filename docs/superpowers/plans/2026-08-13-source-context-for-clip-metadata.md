# Persisted Source Context for Clip Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Clip Generator accept an optional HTTPS YouTube/Twitch source page alongside a Local MinIO URL or uploaded file, persist source metadata/context, and use it for accurate clip metadata and hashtags without downloading the source page's video.

**Architecture:** Keep the processing-media path unchanged. The API validates and attests an optional `source_url`, then passes it to `main.py` as a separate `--source-url` argument. The worker uses the existing `yt-dlp` import only for metadata-only extraction, combines bounded source metadata with the transcript through the configured AI provider, and persists a small structured context in the metadata artifact. The API exposes that context in live results and disk/S3 rehydration, while the browser sends it to the local-editor hashtag endpoint.

**Tech Stack:** FastAPI/Pydantic, Python `yt-dlp` and existing `ai_client.chat_json`, pytest/TestClient, React, Vitest, Testing Library, existing Docker/Kubernetes deployment scripts.

---

## 1. Define the source-context contract with failing tests

**Files:**
- Modify `tests/test_process_minio_url.py`
- Modify `tests/test_local_editor_hashtags_api.py`
- Modify `dashboard/src/components/MediaInput.test.jsx`
- Modify `dashboard/src/components/local-editor/ClipMetadataPanel.test.jsx`
- Create `tests/test_source_context.py`

- [ ] Add API tests for the optional `source_url` field on JSON requests. A valid example must be `https://www.twitch.tv/videos/2842570758`; assert that the queued command contains `--source-url` and the exact source URL, still contains `--direct-url` for the Local MinIO media URL, and does not replace it with `--url`.
- [ ] Add API tests for multipart uploads with `source_url`, asserting the same worker argument and attestation value.
- [ ] Add rejection tests for non-HTTPS sources, unsupported hosts, and malformed URLs. Keep the existing processing-video URL validation and its exact error behavior unchanged.
- [ ] Add a worker-context test module with deterministic fake `yt_dlp.YoutubeDL` and `chat_json` implementations. Cover normalized Twitch metadata, normalized YouTube metadata, bounded description/tags, structured AI output, and the fallback result when metadata lookup or AI synthesis raises.
- [ ] Add a prompt test that calls the clip-planning function with a source context and asserts the prompt includes the source summary/entities and an instruction to use only supported facts.
- [ ] Extend the hashtag API test to submit `source_context` and assert that the prompt includes its structured values while preserving the current hashtag normalization behavior.
- [ ] Extend `MediaInput.test.jsx` to verify the `Original Source URL` field is present in URL mode, is submitted with a Local MinIO URL, and remains present/submitted in file mode.
- [ ] Extend `ClipMetadataPanel.test.jsx` to pass a persisted `source_context` through the clip and assert the hashtag request body contains it.
- [ ] Run the focused Python and dashboard tests and confirm they fail for the missing contract before implementation.

Expected focused commands and initial result:

```powershell
python -m pytest tests/test_process_minio_url.py tests/test_source_context.py tests/test_local_editor_hashtags_api.py -q
cd dashboard; npm test -- --run src/components/MediaInput.test.jsx src/components/local-editor/ClipMetadataPanel.test.jsx
```

The new assertions should fail because no source field, worker flag, metadata helper, prompt block, or hashtag propagation exists yet.

## 2. Implement source URL validation and job propagation

**Files:**
- Modify `app.py`
- Modify `dashboard/src/components/MediaInput.jsx`
- Modify `dashboard/src/App.jsx`
- Modify `tests/test_process_minio_url.py`
- Modify `dashboard/src/components/MediaInput.test.jsx`

- [ ] Add a small `app.py` validation helper for original source pages. Normalize surrounding whitespace, require `https`, require a hostname, and allow only YouTube hosts (`youtube.com`, `www.youtube.com`, `m.youtube.com`, `youtu.be`) and Twitch hosts (`twitch.tv`, `www.twitch.tv`, or a subdomain ending in `.twitch.tv`). Return the normalized URL or raise `HTTPException(400, "Original source URL must be an HTTPS YouTube or Twitch URL")`.
- [ ] Apply that helper to both JSON and multipart `/api/process` inputs. Treat blank optional input as absent. Do not apply this allowlist to the processing URL because Local MinIO remains a generic HTTP(S) direct-media input.
- [ ] Add `source_url` to the job attestation record, keeping the existing acknowledgement, request metadata, and processing-source fields intact.
- [ ] Append `--source-url <validated-source>` to the worker command only when present. Preserve `--direct-url <processing-url>` for URL mode and `--input <uploaded-file>` for file mode.
- [ ] Add `sourceUrl` state to `MediaInput`. Render a labeled optional `Original Source URL` input with helper text explaining that it improves creator/topic/event/location accuracy and does not replace the Local MinIO/file input. Render it in both modes.
- [ ] Include the trimmed source URL in both `onProcess` payloads. Keep the existing rights acknowledgement and submit-disabled behavior.
- [ ] Map `data.sourceUrl` to API `source_url` in both JSON and `FormData` branches of `App.jsx`; omit the field when blank.
- [ ] Re-run the focused API and frontend tests until the contract tests pass.

## 3. Add metadata-only extraction and structured source-context synthesis

**Files:**
- Modify `main.py`
- Modify `tests/test_source_context.py`

- [ ] Add explicit source-context constants/helpers near the existing `yt-dlp` helper code: the allowed structured keys (`who`, `what`, `where`, `when`, `entities`, `source_summary`, `confidence`), maximum field sizes, and a bounded metadata description/tags policy. Keep raw transcript persistence unchanged, but bound prompt payloads before sending them to AI.
- [ ] Implement `fetch_source_metadata(source_url)` using the preserved `yt_dlp` import and `YoutubeDL` with `skip_download=True`, `noplaylist=True`, `quiet=True`, and no output path. Call `extract_info(source_url, download=False)` and never call `download()`.
- [ ] Implement a sanitizer/normalizer that returns only serializable fields: provider/platform, id, title, channel/uploader, description, upload date, categories, tags, view count, duration, thumbnail, and canonical webpage URL. Prefer `channel` over `uploader` when available, preserve the original source URL, truncate long strings, and cap list sizes. Exclude extractor internals, credentials, cookies, and unrelated payloads.
- [ ] Implement `synthesize_source_context(source_metadata, transcript_result)`. Use `load_ai_config()` and `chat_json` with the configured analysis/text model. Require JSON with exactly the agreed context fields, instruct the model to identify who/what/where/when only when supported by metadata or transcript, preserve unknowns as empty/unknown values, and set confidence conservatively. Normalize the response before returning it.
- [ ] Make metadata lookup and synthesis independently best-effort. Return a status payload such as `available`, `metadata_unavailable`, `synthesis_unavailable`, or `unavailable`, plus a bounded human-readable error; do not abort clip generation. If lookup fails, synthesis must not be attempted. If synthesis fails, retain sanitized raw metadata for downstream fallback.
- [ ] Keep `download_youtube_video()` and the legacy `--url` flow unchanged. Add only a separate parser argument `--source-url`; it must not alter the existing `--direct-url` download path.
- [ ] Add tests asserting the mocked `yt-dlp` call uses `download=False`/`skip_download=True`, no media file is requested, YouTube/Twitch fields normalize identically, and each failure path returns a usable fallback status.

## 4. Feed context into clip planning and persist it in metadata

**Files:**
- Modify `main.py`
- Modify `tests/test_source_context.py`
- Add/update any existing main-pipeline tests covering metadata JSON

- [ ] Extend `get_viral_clips` with an optional `source_context=None` argument. Preserve all existing callers by defaulting to `None`.
- [ ] Add a bounded `ORIGINAL SOURCE CONTEXT` block to the existing clip-planning prompt. Include the structured context and sanitized source metadata summary only when available; tell the model to use those facts for titles/descriptions/hooks and never invent missing identities, locations, dates, or events.
- [ ] In the CLI pipeline, parse `args.source_url`, fetch metadata before clip planning, transcribe the processing video as today, synthesize context after transcription, and call `get_viral_clips(..., source_context=source_context)`. The source lookup must not change which file is transcoded.
- [ ] Add a persistence helper that writes `source_url`, `source_metadata`, `source_context`, `source_context_status`, and `source_context_error` to the metadata JSON. Attach a compact `source_url` and `source_context` copy to every generated clip, including transcript/fallback plans, so a clip remains self-describing in the project library.
- [ ] Ensure metadata is written both at the existing early metadata write and at the final write, without serializing non-JSON objects. Keep transcript and cost fields intact.
- [ ] Test that a successful run persists all source fields and that metadata/synthesis failures still produce clips and a metadata artifact with the corresponding warning status.

## 5. Expose persisted context through live results and rehydration

**Files:**
- Modify `app.py`
- Add/update app rehydration tests under `tests/`

- [ ] Add a result-payload helper in `app.py` that takes validated ready clips plus metadata JSON and returns the existing `clips`/`cost_analysis` fields together with `source_url`, `source_metadata`, `source_context`, `source_context_status`, and `source_context_error`.
- [ ] Use that helper for partial live results and final `run_job` results. Attach a compact context copy to any clip loaded from metadata that predates the new per-clip fields, without overwriting clip-specific metadata.
- [ ] Use the same helper in `_rehydrate_job_from_disk` and `_rehydrate_job_from_s3`, preserving existing video URL hydration and S3 behavior. Historical metadata without source fields must continue to load with null/empty source context rather than failing.
- [ ] Add tests with a temporary metadata artifact and mocked S3/disk paths that assert top-level and per-clip source context survives reload.

## 6. Reuse context for editor hashtag generation

**Files:**
- Modify `app.py`
- Modify `dashboard/src/components/local-editor/ClipMetadataPanel.jsx`
- Modify `dashboard/src/components/local-editor/LocalEditorTab.jsx`
- Modify `dashboard/src/components/ProjectLibrary.jsx` only if needed to preserve the existing clip spread
- Modify `tests/test_local_editor_hashtags_api.py`
- Modify `dashboard/src/components/local-editor/ClipMetadataPanel.test.jsx`

- [ ] Extend `LocalEditorHashtagRequest` with optional `source_context` accepting the persisted structured object (and tolerate `null` for older clips). Normalize it to bounded JSON before prompt construction.
- [ ] Add an `ORIGINAL SOURCE CONTEXT` prompt section to `/api/local-editor/hashtags`, after the clip fields and before the JSON-only instruction, telling the AI to use source facts for relevant tags and ignore unknown fields. Keep the existing empty-clip-context validation and provider error handling.
- [ ] Pass `clipMetadata?.source_context` from `LocalEditorTab` into `ClipMetadataPanel`, and include it in the fetch body. The existing `ProjectLibrary` clip normalization spreads persisted fields, so verify that path and change it only if source context is dropped.
- [ ] Test the API prompt with a Twitch context containing creator/topic/entity values, and test the browser request body contains the same context.

## 7. Verify the complete change and prepare the local handoff

**Files:** No new product files; update tests/docs only if verification exposes a real contract mismatch.

- [ ] Run the complete Python test suite:

```powershell
python -m pytest -q
```

- [ ] Run the complete dashboard test suite, lint, and production build:

```powershell
cd dashboard
npm test -- --run
npm run lint
npm run build
```

- [ ] Inspect the final diff for accidental YouTube-specific frontend UI, accidental `yt-dlp` media downloads in the new source-context path, unbounded prompt payloads, and secrets in persisted metadata.
- [ ] Run `git diff --check` and review `git status --short`.
- [ ] Commit the implementation on the current local `main` branch with a focused message such as `feat: persist source context for clip metadata`.
- [ ] Do not deploy until the user explicitly requests deployment; when requested, use the existing local cluster deployment script and verify the rollout plus `/` and `/openapi.json` as done for the preceding MinIO change.

