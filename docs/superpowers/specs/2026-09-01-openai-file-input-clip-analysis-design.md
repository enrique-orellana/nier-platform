# OpenAI File-Input Clip Analysis Design

## Goal

Analyze a complete source transcript in one model request so the model can see
the entire timeline at once, while preserving exact absolute timestamps and
avoiding candidate loss at artificial chunk boundaries.

The uploaded artifact is the canonical timestamped transcript, not the raw
video. Video transcription remains local to the existing pipeline. The model
returns candidate clip bounds using canonical transcript unit IDs, and the
worker resolves those IDs back to exact source timestamps before persisting the
clip plan.

## Context and constraints

The current `openai-codex` provider authenticates with a ChatGPT/Codex OAuth
credential and sends inline text to the private
`chatgpt.com/backend-api/codex/responses` endpoint. That endpoint is not the
official OpenAI Files API and the current integration has no supported
`file_id` upload contract.

The complete-file path supports both authentication modes. With a connected
`openai-codex` account and no public key, the worker invokes the official Codex
CLI in a read-only working directory and gives it the local artifact. If a
server-side `OPENAI_API_KEY` is configured, the public OpenAI Files/Responses
transport remains available. Neither credential is sent to the dashboard,
stored in job metadata, or written to logs. The direct private HTTP transport
remains the lossless-window fallback.

OpenAI's Responses API accepts file inputs, and the Files API supports
uploading files with the `user_data` purpose. The API still enforces model
context limits; a file that cannot fit must produce an explicit fallback or
configuration result rather than silently dropping transcript content.

References:

- [Responses API: create a model response](https://developers.openai.com/api/reference/cli/resources/responses/methods/create)
- [Files API: upload a file](https://developers.openai.com/api/reference/typescript/resources/files/methods/create)

## User-visible behavior

When file-input analysis is configured, clip generation will:

1. Transcribe the source using the existing transcription pipeline.
2. Build one complete, compact, timestamped transcript artifact.
3. Give that artifact once to the selected complete-file transport: the
   connected Codex CLI reads the local file, or the public OpenAI transport
   uploads it once.
4. Send one model request containing the file-backed context and clip-analysis
   instructions.
5. Resolve model-selected unit IDs to canonical timestamps locally.
6. Delete the temporary remote file after the response, best effort.

The job progress log will identify the stages as upload, full-timeline analysis,
validation, and cleanup. It will not expose API keys or raw authorization data.

If the Codex CLI is unavailable or the artifact cannot fit the configured
budget, `auto` falls back to the existing lossless overlapping-window path.
`file` reports an incomplete analysis instead of silently dropping content.

## Configuration

Add server-only configuration:

- `OPENAI_API_KEY`: optional server-only credential for the public OpenAI
  Files/Responses transport; not required for connected Codex.
- `OPENAI_BASE_URL`: optional test/deployment override, defaulting to
  `https://api.openai.com/v1`.
- `OPENAI_CLIP_ANALYSIS_MODE`: `file` to require file-input analysis,
  `legacy` to use the existing provider transport, or `auto` to use file-input
  analysis when the selected Codex transport is available and otherwise
  preserve the selected provider. The default is `auto`.
- `OPENAI_ANALYZE_MODEL`: optional model override. When unset, use the existing
  analysis model selection rather than introducing a silent model migration.

The dashboard does not need a new API-key field in this iteration. The key is
provided through the deployment environment and is only read by the backend.
The `.env.example` file documents the variables without containing a secret.

## Transcript artifact contract

Write a per-job JSONL file with one record per complete analysis unit. Every
record uses absolute seconds from the beginning of the source video:

```json
{"unit_id":"u000001","start":12.125,"end":13.400,"text":"Hello world","segment_id":0,"word_ids":[0,1]}
```

The artifact contract is:

- `unit_id` is globally unique within the job and stable for the request.
- `start` and `end` are canonical source timestamps, never window-relative.
- `text` is complete text for the unit; no unit is split solely to fit a prompt.
- `segment_id` and `word_ids` preserve the mapping to the existing normalized
  transcript where word timestamps exist.
- Segment-level units are used when word timestamps are unavailable; the
  system must not fabricate word timing.
- A small metadata object is sent in the textual prompt with source duration,
  timestamp mode, unit count, and the artifact schema version.

The artifact is compact enough for direct file input. It is not sent through
file search because retrieval is not an exhaustive timeline traversal and
could omit relevant moments.

## Model request and response contract

The request uses the official Responses API shape:

```json
{
  "model": "<configured analysis model>",
  "store": false,
  "input": [{
    "role": "user",
    "content": [
      {"type": "input_text", "text": "...full-timeline instructions..."},
      {"type": "input_file", "file_id": "file-..."}
    ]
  }]
}
```

The instructions require the model to:

- inspect the full source range from `0` through `video_duration`;
- consider moments that cross natural transcript boundaries;
- return candidates independently of the final requested clip count;
- use `start_unit_id` and `end_unit_id` for every candidate;
- include echoed numeric timestamps only as diagnostics;
- return a coverage object containing the reviewed source range and timestamp
  mode;
- return a JSON object with a generous candidate limit so global local ranking
  happens after the complete response.

Expected response shape:

```json
{
  "coverage": {
    "start": 0.0,
    "end": 1201.615,
    "complete": true
  },
  "shorts": [{
    "start_unit_id": "u001234",
    "end_unit_id": "u001241",
    "start": 734.125,
    "end": 756.900,
    "score": 0.94,
    "reason": "..."
  }]
}
```

The local validator will:

- reject unknown unit IDs and reversed ranges;
- resolve IDs to canonical timestamps;
- ensure candidate start units belong to the source timeline;
- use canonical timestamps over model-echoed floats;
- deduplicate and rank all candidates globally;
- mark the analysis incomplete when the model does not claim full coverage or
  when the local evidence is insufficient.

The model's `complete` flag is evidence, not proof of recall. The application
must preserve the coverage metadata so incomplete analysis cannot be presented
as exhaustive.

## Size and fallback policy

Before upload, estimate the serialized artifact size and token count using the
same compact representation that will be uploaded. If it is within the
configured model input budget, use one file-input request.

If it cannot fit:

- `file` mode fails clearly with an input-size diagnostic and no silent data
  loss;
- `auto` mode falls back to the existing lossless overlapping-window planner,
  which preserves complete coverage and exact timestamps;
- the fallback is recorded in analysis metadata so the UI can distinguish
  full-file analysis from windowed analysis.

The fallback is a safety net for context limits, not the normal path. A model
request timeout is not used to truncate a valid file analysis response.

## Upload, cleanup, and security

- Upload with `purpose: user_data` and a short expiration policy.
- Keep the file ID only in process-local state or non-sensitive audit metadata.
- Never place transcript content, API keys, or bearer tokens in normal job
  metadata or dashboard responses.
- Delete the remote file in a `finally` path after success or failure; tolerate
  an already-expired or already-deleted file.
- Use the existing audit emitter for sanitized host, path, duration, status,
  and error fields.
- Never send the ChatGPT OAuth access token to the public OpenAI API.

## Implementation boundaries

Expected production changes are limited to:

- `ai_client.py`: public OpenAI file upload plus Codex CLI file-backed analysis,
  with sanitized cleanup/error handling behind focused interfaces;
- `main.py`: choose the file-input analysis path, generate the JSONL artifact,
  validate the response, and preserve the existing lossless fallback;
- configuration/deployment files: document and pass server-only OpenAI API
  settings into the backend container;
- tests: request-shape, artifact, validation, fallback, cleanup, and secret
  redaction coverage.

The existing dashboard connection flow, video transcription, rendering, and
frontend behavior are outside this change. The existing direct Codex OAuth
transport remains available for lossless-window fallback; complete-file Codex
analysis uses the installed CLI with a temporary translated auth file.

## Testing and acceptance criteria

Tests must cover:

1. A complete transcript produces one JSONL artifact with absolute timestamps,
   stable IDs, and no missing units.
2. Word-timestamp and segment-timestamp fallback modes preserve their existing
   semantics.
3. The public request, when selected, contains exactly one `input_file`; the
   connected Codex request reads exactly one complete local artifact. Both use
   the required full-range instructions.
4. The API key is sent only in the Authorization header and never appears in
   logs, audit metadata, exceptions, or job responses.
5. Candidate IDs resolve to exact canonical timestamps and invalid candidates
   are rejected.
6. Incomplete coverage is surfaced and cannot be labelled exhaustive.
7. Oversized artifacts use the configured `file`/`auto` behavior without
   silently dropping transcript units.
8. Remote file cleanup runs after both successful and failed model requests.
9. Existing provider and lossless-window tests remain green.

The live deployment acceptance check is a real complete-file Codex request with
a known transcript fixture: it must authenticate through the connected account,
read one complete local artifact, return validated candidates spanning the full
source range, and report `codex_file`. The public API path is covered separately
with mocked upload/analysis/cleanup tests.
