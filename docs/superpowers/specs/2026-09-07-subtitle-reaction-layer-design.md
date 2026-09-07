# AI Subtitle Reaction Layer Design

**Date:** 2026-09-07

## Goal

Add a second, AI-generated emoji reaction layer to the local editor so a user can suggest reactions for an entire active subtitle track, review and edit the suggestions, and apply them to the clip without changing the original subtitle text.

## User experience

The existing subtitle controls gain a clip-level `Suggest reactions` action. The action is available when the active subtitle track has at least one non-empty cue. While the request is running, the action is disabled and communicates that suggestions are being generated.

The request analyzes the full active subtitle track in one batch. It does not upload or inspect the video; only subtitle text and cue timings are sent to the existing configured AI provider through a new local-editor API endpoint.

When the response arrives, a review panel opens. Each row contains:

- the cue time range and subtitle text;
- the AI-suggested emoji string, editable by the user;
- an enabled/removed state;
- a remove control.

The panel also exposes shared styling for the approved reactions:

- position: above, left, or right of the subtitle;
- animation: pop burst, shake, or fade;
- size.

The user can retry generation, edit or remove individual suggestions, and apply the approved batch. Applying creates one editor history action. Until the user applies the panel, the current editor state and reaction layer remain unchanged.

## Architecture

### Frontend request

The local editor sends a `POST` request to `/api/local-editor/subtitle-reactions` with the active track identifier and normalized cue data:

```json
{
  "track_id": "original",
  "cues": [
    { "index": 0, "text": "That was way too close!", "startMs": 2100, "endMs": 3400 }
  ]
}
```

The request uses the existing `getLocalAiHeaders()` helper so provider, model, base URL, API key, and reasoning settings behave exactly like the other local-editor AI actions.

### Backend request

The new handler validates that the request contains a supported track identifier and at least one non-empty cue with a positive duration. It forwards the cue text and timings to the existing AI client/provider boundary with a constrained structured-output prompt.

The model must return an array of objects with this shape:

```json
[
  { "cueIndex": 0, "emojis": ["😱"] },
  { "cueIndex": 1, "emojis": ["😂", "💥"] }
]
```

The backend validates every returned cue index against the submitted batch, limits each suggestion to two emoji strings, drops empty suggestions, and rejects malformed output. It returns only validated suggestions and does not persist anything server-side.

AI instructions should ask for expressive but readable reactions, preserve cue order, avoid repeating the same emoji on every cue, and return no more than two emojis per cue. The endpoint should report provider failures with an actionable error while avoiding provider credentials or raw model output in the response.

### Reaction layer data

Reactions are stored separately from subtitle text and are scoped to the active subtitle track. The editor state contains a reaction layer with approved overlays:

```ts
interface SubtitleReaction {
  id: string;
  cueIndex: number;
  startMs: number;
  endMs: number;
  emojis: string[];
  enabled: boolean;
}

interface SubtitleReactionStyle {
  position: "above" | "left" | "right";
  animation: "pop" | "shake" | "fade";
  scale: number;
}
```

The canonical manifest location is `subtitle_tracks[].reactions` and `subtitle_tracks[].reactionStyle` on the active track. When the active track is the legacy original subtitle layer, both editor serialization paths also mirror those fields into `layers.subtitles.reactions` and `layers.subtitles.reactionStyle` for older composition consumers. Projects without these fields continue to normalize to an empty layer and render exactly as before.

## Preview and export rendering

The Remotion subtitle composition receives the optional reaction layer and renders enabled reactions against the same cue start/end times used by subtitles. Reactions are positioned relative to the subtitle block, use the shared reaction style, and are pointer-transparent in the preview.

Rendering must work in both modes already supported by the composition:

- frame-driven Remotion sequences during export;
- media-time-driven preview playback.

The reaction renderer should remain a separate component or clearly separated branch from `WordSpan`, so emoji rendering does not alter word highlighting, karaoke, single-word mode, or subtitle styling.

## Persistence and history

The local editor’s manifest conversion must round-trip the reaction layer without dropping it when saving, loading, exporting, or switching between editor surfaces. Applying, replacing, or removing the reaction layer is one `commitEdit` operation, making the entire batch removable with one Undo.

Regenerating suggestions changes only the pending review state. It does not replace an already-applied layer until the user confirms Apply.

## Error and empty states

- No subtitle cues: disable the action and explain that subtitles are required.
- AI request in progress: disable duplicate requests and show progress text.
- Provider/API failure: keep the current editor state unchanged and show a retryable inline error.
- Invalid model response: reject it as an AI-format error and leave the editor unchanged.
- No usable suggestions: show an empty review state with the option to retry.
- Existing reaction layer: show the pending suggestions as a replacement preview and require explicit Apply before replacing it.

## Testing

Frontend tests cover:

- the request payload and AI headers for the active subtitle track;
- loading, success, retry, and error states;
- editing and removing individual suggestions;
- shared style controls;
- applying all approved reactions as one history action;
- one-step Undo removing the applied batch;
- manifest round-tripping with and without reactions.

Remotion tests cover:

- reaction visibility within cue timing and absence outside it;
- preview media-time behavior;
- shared position, size, and animation styles;
- rendering with an empty or absent reaction layer.

Backend tests cover:

- valid structured AI output;
- malformed JSON, invalid cue indexes, and oversized emoji arrays;
- missing cues and invalid timings;
- provider failure propagation without leaking sensitive details.

The dashboard formatting, format check, lint, focused tests, and production build are required before the implementation is considered ready.

## Scope boundaries

This version intentionally does not add manual drag handles, per-emoji keyframes, custom image stickers, automatic local-rule fallback, or reactions across multiple subtitle tracks in one request. The active-track boundary keeps the first version predictable and prevents duplicate overlays when translated tracks exist.
