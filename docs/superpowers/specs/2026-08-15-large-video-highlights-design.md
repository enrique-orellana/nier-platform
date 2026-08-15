# Large-video Highlights transcription design

## Goal

Process multi-hour Highlights source videos without exhausting the backend container memory or taking the API offline.

## Root cause

The Highlights worker currently calls the existing `main.transcribe_video` implementation once for the complete source. That function creates a `large-v3` Faster-Whisper model and retains the complete transcription, including word timestamps, in one operation. A 12.3 GB, 3h20m source caused the backend pod to exceed its 8 GiB limit and enter `CrashLoopBackOff`.

## Design

Highlights will use a dedicated bounded transcription path. The path will:

1. Reuse one `WhisperModel` instance for the whole job.
2. Extract one temporary mono, 16 kHz WAV chunk at a time with FFmpeg.
3. Transcribe each chunk independently using a fixed default chunk size of 600 seconds and a 10-second overlap.
4. Offset each returned segment timestamp back into source-video seconds.
5. Retain transcript text and segment boundaries for AI ranking, without retaining per-word timestamps for every chunk.
6. Delete each temporary chunk in a `finally` block before continuing.
7. Emit `Transcribing chunk N/M` logs so the persisted job status shows progress.

For sources shorter than one chunk, the same path runs once, preserving the current behavior. The existing AI ranking, selection, rendering, provider headers, and output format remain unchanged.

## Error handling

FFmpeg or Whisper failures abort the job with the existing worker error path. Temporary chunk files are removed on success and failure. A malformed or empty chunk produces a clear transcription error rather than an empty successful result.

## Testing

Unit tests will verify chunk planning, timestamp offsets, model reuse, FFmpeg invocation, cleanup, and progress logs using injected/mocked transcription and subprocess boundaries. Existing short-video Highlights tests must continue to pass. Deployment verification will run a live short source and confirm the backend remains ready while the job processes.
