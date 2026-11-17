# On-Demand Local Visual Analysis Design

## Goal

Let users choose the clip-analysis provider before each video job, including the existing configured provider (such as Codex) or a local Ollama vision model, and ensure local inference models load on demand and unload after a short idle timeout instead of remaining resident indefinitely.

## Current behavior

Clip discovery sends a transcript and detected audio events to the configured clip-selection provider. It does not include sampled video frames. The local audio-event service loads YAMNet during startup, and the Compose `speaches-model-init` service loads the configured speech model during startup. Speaches then keeps its model for the configured `STT_MODEL_TTL` (300 seconds by default).

## Approved approach

Use the existing native Ollama runtime on the Windows host. The backend reaches its API through a configurable local base URL, defaulting to `http://host.docker.internal:11434`. The dashboard's AI settings gain a separate **Local models** section with a base URL, installed vision-model picker, and a refresh/test action. Settings are saved in the browser. The generation screen adds a **Clip analysis** selector before the Generate action, offering the configured provider (for example, Codex) and the selected local Ollama model. The selector defaults to the provider configured in Settings and is included in each clip-generation request.

Use `qwen3-vl:8b-instruct-q4_K_M` as the editable recommended model value. If Ollama has no installed vision models, the settings section explains that model weights must first be installed with `ollama pull <model>` and shows the command for the selected model. Model discovery must not load a model into memory. If the local model is not configured or installed, the generation selector shows that state and points to Settings instead of submitting a failing job.

During clip discovery, sample up to eight timestamped frames per analysis window and scale each frame so its largest dimension is at most 768 pixels. When the user selected the local Ollama model, send the transcript, audio-event timeline, and sampled frames to that model; it returns clip candidates in the existing JSON shape, and current candidate validation remains unchanged. The existing configured provider retains its current transcript and audio-event behavior and does not receive frame images. Frame image data is transient and is not persisted. If the selected local endpoint or model fails, fail the job with a clear error and do not silently switch providers.

## Model lifecycle

- Keep Ollama's service process available, but keep the vision model loaded only during clip discovery. Requests use a short keep-alive to reuse the model across windows; an explicit unload request runs when analysis completes or fails. The runtime's idle timeout remains a safety net if the worker is interrupted.
- Remove `speaches-model-init` from the startup dependency chain. Speaches loads the configured speech model on its first transcription request, uses a 60-second idle TTL by default, and keeps downloaded weights in the persistent cache volume.
- Change the audio-event service to create YAMNet on its first request and discard its model instance after 60 seconds idle, then run garbage collection. The service health endpoint reports healthy while the configured detector is unloaded.

Model files remain cached on disk to avoid downloading them for every job; the idle unload behavior concerns runtime memory, not the persistent model cache.

## Request and settings flow

1. The dashboard reads and saves the local Ollama URL and selected vision model in local storage.
2. Model discovery/test requests go through the Go API to the configured Ollama `/api/tags` endpoint; these operations do not invoke inference. The endpoint validator accepts only local destinations such as loopback, `host.docker.internal`, or private-network addresses, and rejects credentials and non-HTTP(S) schemes.
3. Before clip-generation submission, the user selects either the configured clip-analysis provider or the selected local Ollama model. The dashboard sends that choice and, for local Ollama, the model ID and base URL in dedicated headers.
4. The Go API allowlists these headers for the Python worker. The worker maps them into per-job environment values without overwriting existing settings for the other provider.
5. The Python analysis pipeline reads the selected provider. For the existing provider, it follows the current path. For local Ollama, it extracts frames with the existing FFmpeg-based video decoder, calls Ollama's native multimodal chat API with the transcript and timeline prompt, validates returned clip candidates through the existing shared rules, and unloads the model in a `finally` path.

## Validation and failure behavior

- The Ollama endpoint must be a valid HTTP(S) base URL resolving to a local destination; configuration errors are shown in Settings or reported as a clear job error.
- Installed model discovery returns model IDs and sizes, and does not call an inference endpoint.
- Frame sampling is bounded by eight frames per analysis window and a 768-pixel maximum image dimension so large source videos cannot create unbounded request payloads.
- A failed vision request fails the clip-discovery job and still attempts model unload. No raw frame data is stored in job metadata or audit logs.
- Existing clip discovery remains unchanged when the user selects the configured provider.
- Speaches and YAMNet no longer initialize their inference models during service startup. Their first request may take longer while weights load; cached weights remain on disk for later requests.

## Out of scope

- Replacing the configured clip-selection provider with Ollama.
- Uploading raw video frames to cloud model providers.
- Managing Ollama installation, model downloads, or GPU driver configuration from OpenShorts.
- Removing the local model cache from disk.
