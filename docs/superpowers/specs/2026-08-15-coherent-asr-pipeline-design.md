# Coherent Long-Form ASR Pipeline

**Date:** 2026-08-15

## Goal

Produce a coherent transcript for long videos while preserving global timestamps and allowing the transcription provider and model to be selected from the application settings.

## Design

The existing `transcribe_video_with_config` flow remains the single entry point. It reads the configured transcription provider and model, then processes long audio in bounded overlapping chunks. The model is never hardcoded in the worker.

For OpenRouter transcription:

- Target audio windows are approximately five minutes.
- Each window overlaps the previous one by 5–10 seconds so words at boundaries are not lost.
- Audio is extracted as mono compressed speech audio rather than large PCM WAV payloads.
- The worker sends the configured model and preserves the provider's verbose timestamps.
- Each returned segment is offset by the chunk's global start time.
- Adjacent chunk overlap is deduplicated deterministically from the segment text; no second LLM call is used to merge the transcript.

After ASR completes, the merged transcript is passed to the existing highlight-analysis pipeline. Text analysis may still use bounded text windows when the transcript is large, but it never re-transcribes the audio.

## Error handling

- The configured OpenRouter base URL is normalized to the API root.
- Provider HTTP failures and malformed responses are reported with status and bounded response detail.
- A failed chunk fails the job with the chunk number and provider error; the worker does not silently switch models or providers.
- Progress logs identify the current chunk and total chunk count.

## Testing

Tests will cover:

- Long-form chunk planning and overlap boundaries.
- Compressed OpenRouter extraction parameters.
- Global timestamp offsets.
- Removal of duplicate overlap text.
- Propagation of the configured provider/model.
- Failure messages for HTTP and malformed provider responses.

No UI, database schema, or provider-settings changes are required.
