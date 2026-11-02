# Configurable, Provider-Agnostic Audio and Clip Analysis

## Summary

Improve generated clip choices by building a canonical, multi-track timeline and analyzing it through configurable model APIs. The pipeline must be agnostic to whether a selected service is local or remote, including OpenRouter, Codex, Ollama, or another compatible endpoint. Provider-specific request and response details stay behind adapters; the timeline, candidate validation, and rendering logic use the same contracts for every provider. Audio-event labels are analysis metadata only; they must not become subtitles or be attributed to a speaker.

## Goals

- Represent speech, sound events, and any future analysis signals as independent, timestamped timeline tracks.
- Allow a configured service to provide one track or several tracks, including a complete transcript plus sound-event labels.
- Let a configured clip-analysis model select moments using the normalized tracks while preserving existing clip-count, duration, and source-timestamp contracts.
- Select endpoints, models, credentials, and resource limits through environment configuration.
- Keep orchestration provider-agnostic; changing between compatible local and remote services requires configuration changes only.
- Never silently switch providers. If the selected service fails or violates the shared contract, fail clearly without trying another service.
- Bound local resource use and serialize analysis jobs so local inference does not compete unnecessarily with video rendering.

## Non-goals

- Adding sound-effect labels to subtitle text, SRT, or burned captions.
- Bundling one mandatory provider or model into the timeline/selection orchestration.
- Adding video-frame understanding to clip selection.
- Automatically falling back between configured providers.

## Proposed architecture

### 1. Configurable model services and provider adapters

Keep model calls behind provider adapters and separate from the clip-selection rules. A configured timeline service may return speech, sound events, and other supported tracks together, or dedicated services may fill those tracks independently. A separate configured analysis service receives the normalized timeline and returns clip candidates. Each endpoint can be local or remote. Switching endpoints must not require changes to timeline construction, prompts' data schema, candidate validation, persistence, or rendering.

Use reusable, typed provider components with shallow inheritance and composition. A common provider base owns configuration validation and shared HTTP/error handling; focused interfaces define transcription, sound-event detection, and clip analysis. Concrete adapters implement only their protocol, and a registry/factory selects them by configured provider name. Pipelines receive these interfaces through dependency injection and operate only on normalized records. Adding an endpoint that follows an existing protocol is configuration-only; adding a proprietary protocol means implementing and registering one adapter without editing the pipeline. Keep provider implementations replaceable and independently testable; do not build a deep inheritance tree or make plugins mutate shared pipeline state.

Third-party adapters are installable Python packages that expose a registration function through the `openshorts.analysis_providers` entry-point group. Registration is explicit, ordered, and capability-scoped. The package entry-point value is a `module:function` reference; OpenShorts calls that function with the registry, and it registers stable provider IDs with capability-specific factories. A factory receives a typed config object and returns a subclass of `TranscriptionProvider`, `AudioEventProvider`, or `ClipAnalysisProvider`. The three stage-specific environment variables select built-in or installed plugin IDs. Custom provider IDs are accepted by config parsing and fail clearly at provider creation if no installed plugin registered that ID. `AI_PROVIDER` continues to select the existing chat protocol behind the `chat-json` clip adapter.

Example package metadata:

```toml
[project.entry-points."openshorts.analysis_providers"]
my-local-models = "my_package.openshorts_plugin:register"
```

The `register(registry)` function calls `registry.register("transcription", "my-asr", factory)` (and similarly for `audio_events` or `clip_analysis`). Plugin IDs can then be selected with `AI_TRANSCRIPTION_PROVIDER=my-asr`. Each plugin owns protocol-specific validation and transport while returning the shared normalized records.

For local deployments, services can run as separate Docker Compose services or as host processes; Docker is a deployment choice, not a requirement. When a service runs on the Windows host and the backend runs in Docker Desktop, configure the local endpoint using `host.docker.internal`. When services run in Compose, use their internal service names and do not publish their ports outside the local machine unless needed. `faster-whisper`/Speaches, YAMNet, Ollama, and the existing Codex or OpenRouter adapters are provider examples, not hard-coded pipeline dependencies.

Define a versioned canonical contract for provider outputs. Adapters normalize timestamps to absolute source-video seconds, assign stable IDs, preserve confidence and provenance, and reject malformed data. The core pipeline must not branch on whether a record came from a local or external provider.

### 2. Speech and sound-event tracks

Speech providers must supply timestamped transcript segments and, where supported, word-level timestamps. If a provider only returns segments, the canonical speech track records segment-level timing and the analyzer uses segment IDs. Local `faster-whisper` with a multilingual `small` model, CPU `int8`, bounded threads, and word timestamps is one configurable option. A service may return both speech and event tracks in one response, or the event track may be provided by a separate configured detector.

Sound-event providers may report laughter, gasps, applause, cheering, coughs, or salient music/sound changes. Normalize detections into absolute start/end times, a label, confidence, source, and stable event ID. Local YAMNet is one option; a configured external service may return the same track. Events remain separate from transcript words and subtitle cues. If event analysis is explicitly disabled, the speech-only selector remains usable; a selected event provider that fails ends the job without switching providers.

### 3. Shared timeline and provider-agnostic clip selection

Keep existing transcript fields for compatibility and expose a canonical `tracks` collection. Each track has a type and independently timestamped items. For example:

```json
{
  "tracks": [
    {
      "type": "speech",
      "items": [{
        "id": "word-0001",
        "start": 11.9,
        "end": 12.3,
        "text": "Bueno"
      }]
    },
    {
      "type": "sound_events",
      "items": [{
        "id": "event-0001",
        "start": 12.4,
        "end": 13.3,
        "label": "Laughter",
        "confidence": 0.82,
        "source": "configured-event-provider"
      }]
    }
  ]
}
```

Provider adapters emit validated domain records, and a timeline builder composes them into the canonical track collection. The clip-discovery coordinator accepts provider interfaces and the timeline builder as dependencies, then validates returned candidate IDs and times through the existing shared rules. Provider registry and environment parsing stay at the application boundary; `main.py` does not contain endpoint-specific branches.

Speech and sound events remain separate tracks. A combined service response and multiple separate provider responses normalize to this same structure. Both existing transcript-analysis paths—overlapping windows and complete-file analysis—must pass relevant tracks to the selector with absolute timestamps.

The configured analysis provider receives the normalized timeline and returns candidates in a provider-independent JSON schema. It must treat events as evidence rather than speech; use salient localized events to find or strengthen candidates; preserve enough setup and payoff around an event; and never invent IDs, event labels, or timestamps. Candidates reference canonical word/segment IDs when available and include absolute bounds. Validate results locally before persistence. Existing 15–60 second bounds and target clip count remain unchanged.

## Environment configuration

Providers, endpoints, models, credentials, and resource controls are configured through `.env` / container environment, not new UI controls. Each stage can point to a different service, or the transcription and event stages can point to a combined service. Initial configuration shape:

| Variable | Initial value | Meaning |
| --- | --- | --- |
| `AI_TRANSCRIPTION_PROVIDER` | `openrouter-json` | Adapter: `openrouter-json`, `openai-compatible`, or an installed plugin ID. |
| `AI_TRANSCRIPTION_BASE_URL` | Explicitly configured | Local or external transcription service endpoint. |
| `AI_TRANSCRIPTION_MODEL` | Explicitly configured | Model identifier understood by that endpoint. |
| `AI_TRANSCRIPTION_API_KEY` | Optional | Credential required by the selected endpoint; never log its value. |
| `AI_TRANSCRIPTION_LANGUAGE` | `auto` | Optional language hint passed to the selected transcription service. |
| `AUDIO_EVENT_PROVIDER` | `none` | Provider/adapter name for the sound-event track. |
| `AUDIO_EVENT_BASE_URL` | Explicitly configured | Local or external event-analysis endpoint. |
| `AUDIO_EVENT_MODEL` | Explicitly configured | Model identifier understood by that endpoint. |
| `AUDIO_EVENT_API_KEY` | Optional | Credential required by the selected endpoint; never log its value. |
| `AI_PROVIDER` | Explicitly configured | Existing provider selector for timeline analysis (for example, `openai-compatible` with Ollama, Codex, or OpenRouter). |
| `AI_CLIP_ANALYSIS_PROVIDER` | `chat-json` | Selects the clip-analysis adapter; installed plugin IDs are supported. |
| `AI_BASE_URL` | Explicitly configured | Local or external clip-analysis endpoint. |
| `AI_ANALYZE_MODEL` | Explicitly configured | Model identifier understood by that endpoint. |
| `AI_API_KEY` | Optional | Credential required by the selected analysis endpoint; never log its value. |
| `LOCAL_ASR_CPU_THREADS` | `2` | Set in the local ASR service environment; OpenShorts does not control threads inside an independently managed service. |
| `LOCAL_LLM_CPU_THREADS` | `2` | Set in the local analysis service environment when that runtime supports a thread limit. |
| `AI_ANALYSIS_CONCURRENCY` | `1` | Maximum concurrent clip-discovery AI pipelines; applies to provider calls only, not rendering. |
| `LOCAL_AUDIO_ANALYSIS_LOCK_DIR` | `/app/output/.openshorts/audio-analysis-locks` | Shared cross-process lock directory on the backend's persistent work volume. |
| `LOCAL_MODEL_SERVICE_CPUS` | `2` | Docker CPU ceiling in the Compose configuration that launches a local model service. |
| `AUDIO_EVENT_MIN_CONFIDENCE` | `0.35` | Starting event threshold, calibrated against validation clips. |
| `LOCAL_MODEL_CACHE_DIR` | Persistent service volume | Cache for locally hosted model files. |

The stage selectors are independent: `AI_PROVIDER` selects chat transport only and does not change transcription or event detection. For fully local processing, point every enabled stage at its local endpoint. A transcription key is stage-specific; `AI_API_KEY` is reused for OpenRouter transcription only when chat is also configured for OpenRouter.

Provider names select adapters, while URLs, models, and credentials are data-driven configuration. A provider that implements the configured common protocol can be selected without changing orchestration code. A provider with a different protocol needs one adapter that maps it to the shared input/output contract; after that adapter exists, switching to it remains configuration-only. Remote services are allowed when explicitly selected. A failed configured provider fails the job; it never triggers another provider or heuristic clip selection.

`AI_ANALYSIS_CONCURRENCY=1` is enforced across worker processes with a queue/lock around the complete clip-discovery AI pipeline, preventing simultaneous videos from overloading configured services. This lock covers transcription, event analysis, and clip selection, then releases before rendering. Local resource limits apply only to local services. Invalid configuration, missing credentials, service errors, and schema violations fail clearly and do not trigger provider fallback.

## Data flow

1. Probe the source and stage the audio through the existing media path.
2. Send audio to the explicitly configured transcription service, in bounded chunks if required by its protocol; normalize word/segment times to absolute source timestamps and deduplicate overlap.
3. Send audio to the explicitly configured event service when enabled, or accept event tracks from a combined timeline service; normalize event intervals and confidence.
4. Merge provider outputs into the canonical timeline without merging event labels into speech text.
5. Send the normalized timeline to the explicitly configured clip-analysis service, validate candidate IDs/times/durations, deduplicate overlapping candidates, and persist the discovered clip plan.
6. Render only after the user selects a discovered clip, as in the current deferred-render workflow.

## Failure and privacy behavior

- Data is sent only to the explicitly configured service for each stage. A remote endpoint receives the inputs required by its configured operation; local endpoints keep that operation on the machine.
- A selected ASR, sound-event, or clip-analysis service failure ends the job with a service-specific error; no alternate endpoint or provider fallback is attempted.
- `AUDIO_EVENT_PROVIDER=none` skips sound-event analysis without selecting another detector.
- Invalid provider responses fail contract validation; the pipeline does not guess at missing timestamps or silently reinterpret event labels as speech.
- Do not write event labels into subtitle segments, subtitle tracks, SRT files, or burned captions.

## Validation

- Unit-test provider selection, environment validation, timestamp offsets across transcription chunks, normalization of word/segment/event tracks, event smoothing/deduplication, confidence filtering, and source-range clipping.
- Run equivalent fixture outputs through local and external adapters and verify they produce the same canonical timeline and candidate-validation behavior.
- Prove strict failure semantics: missing services/models, authentication errors, inference failures, and schema violations fail without invoking another endpoint.
- Test both windowed and complete-file prompts with audio events, and verify provider selection does not alter timeline semantics or serialize event labels as speech/subtitles.
- Add a small manually annotated validation set with Italian speech plus laughter, gasp, applause/cheering, and music/sound transitions. Compare local transcript quality and clip choices against previously captured baseline results; report event precision/recall and timestamp tolerance separately from candidate context quality.
- Measure one representative 10-minute source with a local configuration. Confirm configured CPU limits, analysis concurrency, and persistent model caches for local services.
- Verify only configured endpoints receive requests and that switching compatible endpoints requires no code changes.

## Out of scope for this design

- Changing subtitle generation or export behavior.
- Automatic provider retries, cascading providers, or hidden fallbacks.
- Always-loaded models while no analysis job is running, or user-facing model controls.
- Visual event detection or audiovisual embedding models.
