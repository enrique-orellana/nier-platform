# Clip Information Regeneration Design

## Goal

Add a local-editor action that regenerates and persists the publishing information for the currently selected clip, and enrich the existing hashtag regeneration request with the same source facts. Both actions must use the editor's live caption context and trim range, because the user may have changed the clip timing since the original metadata was generated.

## Scope

The clip-information action regenerates these fields:

- `video_title_for_youtube_short`
- `video_description_for_tiktok`
- `video_description_for_instagram`
- `viral_hook_text`

`video_filename` is an existing media asset identifier and is preserved unchanged. Other clip fields are preserved unchanged.

The existing hashtag action keeps its response contract but also receives the same bounded `source_metadata` and `source_context` inputs.

## Design

`ClipMetadataPanel` will add a `Regenerate clip information` button beside the existing hashtag action. On click it sends a dedicated `POST /api/local-editor/clip-info` request. Both the new request and the existing hashtag request contain:

- the current title and captions;
- the current editor subtitle/caption text;
- the current trim start and end seconds;
- bounded, sanitized original `source_metadata`;
- the source context;
- the current viral hook when present.

The persisted, sanitized `source_metadata` copy will be made available on each project clip so the panel can send it for both actions. If source metadata is unavailable, the request sends an empty object and continues using the available source context and live clip content.

The current editor state is authoritative at request time. In particular, edited subtitle cues and the live trim range are passed through rather than reading only the original `clip.start`, `clip.end`, or generated captions.

The Python worker receives a new `clip_info` operation and returns JSON with the four generated fields. The hashtag operation keeps its flat hashtag response. Both worker prompts will stay simple and organized into four sections: current clip context, live selected content, original source metadata/context, and the exact JSON output contract. They will instruct the model to stay grounded in the supplied content, respect the source language, and return only the exact response shape. The Go handlers validate request context, delegate through the existing translation-worker boundary, validate the JSON result, and return it.

After a successful response, the panel updates its displayed title/caption and forwards the generated fields to its parent. The full-screen editor persists them through the existing project clip metadata PATCH endpoint. That endpoint will accept optional metadata fields, merge only supplied fields into the selected clip, and retain the existing hashtags-only contract.

The standalone local editor remains usable without a persistence callback; it still updates its current panel state.

## Error handling

- Disable the regeneration button while the request is running and show a spinner.
- Preserve the previous information if the request fails.
- Show the server or worker error inline in the metadata panel.
- Reject empty or malformed worker results before updating or persisting the clip.
- Do not modify `video_filename` or unrelated clip fields.

## Testing

- Component tests verify both requests include current subtitles, trim range, existing metadata, source metadata, and source context; successful clip-info responses replace the displayed information; and failures preserve the previous values.
- Go HTTP tests verify the new route delegates to the worker and returns its clip-info response, while the existing hashtag route remains compatible.
- Python worker tests verify the new operation's prompt/response normalization and required fields.
- Project metadata tests verify partial metadata updates merge into a clip without dropping hashtags or unrelated fields.
- Run the required dashboard format, format-check, lint, focused tests, backend tests, and a final change-impact review.
