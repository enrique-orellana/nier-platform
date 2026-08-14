# Native Highlights in OpenShorts

## Goal

OpenShorts will include the existing Highlights workflow as a native sidebar tab. A user selects one downloaded video from the shared MinIO source bucket, asks for a focused long-form cut with a 12-minute minimum and an approximately 20-minute ideal, and receives a rendered MP4 with a manifest explaining the selected moments.

## Scope

The migration includes source selection, one-at-a-time job creation, live progress/log polling, cancellation, AI transcription and moment ranking, FFmpeg concatenation, output playback/download, and persisted job history. It does not add a second service, second AI settings store, second queue, or second object-storage client.

The previous Clipkeeper iframe integration is unrelated to this design and will be removed from `video-automation`.

## Architecture

The OpenShorts React dashboard adds a `highlights` route and a Highlights tab component. The component reuses `MinioObjectPicker`, the existing API URL helper, and the existing Settings-selected AI provider. It sends the selected `{bucket, key}` and target durations to the Go control plane.

The Go control plane adds a `highlight-generation` job kind and `/api/highlights` endpoints. It uses the existing durable job store, scheduler, worker protocol, logs, output directory, and `/videos/{job}/{file}` static serving. The shared job runner gains cancellation support so a stop request cancels the worker process through context instead of adding a Highlights-specific executor.

The Python worker receives a `highlight_generation` operation. It stages a MinIO object through the existing source downloader, probes the source with FFmpeg, reuses OpenShorts’ `faster-whisper` transcription and configured `ai_client.chat_json` provider, ranks coherent transcript windows with a long-form highlight prompt, selects high-scoring non-overlapping windows toward the target, and concatenates them with FFmpeg. The result is written under the existing job output directory and returned through the existing job result channel.

## Data flow

1. The dashboard lists the shared MinIO source bucket through `/api/minio/objects`.
2. The user selects one video, confirms rights, and chooses minimum/ideal durations.
3. `POST /api/highlights` creates a queued `highlight-generation` job with the source object and target metadata.
4. The scheduler runs the job through the existing JSON-lines Python worker protocol.
5. The worker emits logs while staging, transcribing, analyzing, selecting, rendering, and finalizing.
6. The dashboard polls the existing status/log response and offers a Stop action while the job is active.
7. A completed result contains output URL, manifest URL, selected/output durations, provider/model, selection method, segments, transcript summary, and warnings.

## AI behavior

Transcription uses the existing local `faster-whisper` implementation. Ranking uses the provider already selected in OpenShorts Settings; no OpenRouter-only provider is introduced. The prompt asks for coherent, standalone windows with strong information density, emotional energy, and narrative value. Candidates are validated against source duration and bounded to safe FFmpeg ranges.

The selector prefers high-scoring non-overlapping candidates, restores chronological order, stops at the ideal duration when possible, and continues toward the minimum only with candidates that meet the quality threshold. If the minimum cannot be reached without weak filler, it returns the strongest available result and records a warning.

## Error and cancellation behavior

- Invalid source, missing MinIO object, invalid duration, or malformed AI output fails before rendering and is shown in the job log.
- AI/provider failures do not silently become non-AI results; fallback is explicit and visible if OpenShorts later enables a fallback mode for this job kind.
- Stop transitions a queued or processing Highlight job to cancelled and terminates the Python/FFmpeg child through the existing context cancellation path.
- Partial output files are removed when rendering or finalization fails.
- Only one active Highlight job is allowed at a time; other OpenShorts job kinds remain governed by the existing scheduler limit.

## Testing

- Go tests cover Highlight request validation, job creation, status/listing, one-active-job enforcement, cancellation, and result shape.
- Python tests cover candidate validation, target normalization, chronological non-overlapping selection, minimum/ideal behavior, and worker dispatch.
- React tests cover the new tab, MinIO selection, duration controls, polling/log display, cancellation, error display, and completed output links.
- Existing OpenShorts Go, Python, dashboard, and build checks must remain green.
