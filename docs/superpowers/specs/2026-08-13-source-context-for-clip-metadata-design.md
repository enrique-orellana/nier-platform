# Persisted Source Context for Clip Metadata

## Goal

When generating clips from a Local MinIO video, optionally accept the original YouTube or Twitch URL, persist source context for the job, and reuse that context when generating clip titles, descriptions, hooks, and hashtags.

## User experience

- Keep `Local MinIO URL` as the primary video input.
- Add an optional `Original Source URL` field for the original YouTube or Twitch page.
- The field is available for both MinIO URL and local-file workflows.
- The source URL is not used to download the processing video. It is used only to enrich metadata and AI context.
- The UI explains that the original source URL improves creator, topic, event, and location accuracy.

## Source context pipeline

1. The dashboard posts the processing URL/file and optional `source_url` to `/api/process`.
2. The API validates the source URL as an HTTPS YouTube or Twitch URL, stores it with job attestation data, and passes it separately to the worker.
3. The worker processes the Local MinIO/local file as it does today.
4. When `source_url` is provided, the worker performs a metadata-only lookup using the preserved `yt-dlp` implementation with no media download. It extracts available platform, title, channel/uploader, description, upload date, categories, tags, view count, and canonical URL fields.
5. After transcription, the configured AI synthesizes a compact structured context from the source metadata and transcript:

   ```json
   {
     "who": [],
     "what": "",
     "where": "",
     "when": "",
     "entities": [],
     "source_summary": "",
     "confidence": "high|medium|low"
   }
   ```

   The synthesis prompt must preserve uncertainty and must not invent identities, locations, dates, or events.
6. The initial viral-clip planning prompt receives the source context so generated titles, descriptions, and hooks reflect the original source.
7. The generated metadata JSON persists `source_url`, `source_metadata`, `source_context`, and any source-context status/error. A compact copy is attached to each clip so project-library clips retain context independently.

## Context reuse

- Hashtag generation receives the persisted source context in addition to title, caption, and subtitle text.
- Future metadata-generation actions can reuse the same source-context contract without querying the source URL again.
- Raw metadata and transcripts remain persisted for auditability, while prompt payloads are bounded by truncating excessively long descriptions/transcripts.
- Job reload and S3/MinIO rehydration must return source URL and context with the clips.

## Failure behavior

- Missing or invalid `source_url` is rejected before the job starts with a clear validation error.
- Source metadata lookup failures, unavailable `yt-dlp`, and provider restrictions do not fail video generation. The job records a warning/status and continues with transcript-only context.
- AI context synthesis failures do not fail video generation. Raw metadata and transcript remain available, and downstream prompts use the available fallback context.
- The Local MinIO download path remains direct HTTP(S) ingestion and never routes through `yt-dlp`.

## Data and API contracts

- `/api/process` JSON requests add optional `source_url` while preserving `url` and `acknowledged`.
- The worker CLI receives a separate source URL argument; the existing `--direct-url` path remains the processing-video path, and the legacy `--url`/`download_youtube_video()` path remains available for non-frontend legacy use.
- `source_metadata` is a sanitized JSON object containing only serializable provider fields; secrets and unrelated extractor payloads are excluded.
- `source_context` is a small structured JSON object with the fields above and may include a status/error field outside the AI-generated object.

## Testing

- Frontend tests verify both URLs are submitted and the source field appears in both input modes.
- API tests verify source URL validation, job attestation, and worker command propagation.
- Worker tests mock `yt-dlp` metadata extraction and verify Twitch/YouTube metadata normalization, context synthesis, persistence, and fallback behavior.
- Prompt tests verify source context is included in initial clip planning and hashtag generation.
- Rehydration tests verify persisted context is exposed with historical clips.
- Existing Python tests, dashboard tests, lint, and production build must remain green.

## Scope boundaries

- No external web-search service is introduced in this iteration. Research is grounded in original platform metadata and the downloaded video's transcript, interpreted by the configured AI provider.
- No source video is downloaded from YouTube or Twitch by the Clip Generator frontend flow.
- No changes are made to MinIO storage authentication or the existing direct-video ingestion behavior.
