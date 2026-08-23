# Clip Information Regeneration Design

## Goal

Add a local-editor action that regenerates and persists the publishing information for the currently selected clip. The action must use the editor's live caption context and trim range, because the user may have changed the clip timing since the original metadata was generated.

## Scope

The action regenerates these fields:

- `video_title_for_youtube_short`
- `video_description_for_tiktok`
- `video_description_for_instagram`
- `viral_hook_text`

`video_filename` is an existing media asset identifier and is preserved unchanged. Other clip fields are preserved unchanged.

## Design

`ClipMetadataPanel` will add a `Regenerate clip information` button beside the existing hashtag action. On click it sends a dedicated `POST /api/local-editor/clip-info` request. The request contains:

- the current title and captions;
- the current editor subtitle/caption text;
- the current trim start and end seconds;
- the source context;
- the current viral hook when present.

The current editor state is authoritative at request time. In particular, edited subtitle cues and the live trim range are passed through rather than reading only the original `clip.start`, `clip.end`, or generated captions.

The Python worker receives a new `clip_info` operation and returns JSON with the four generated fields. The worker prompt will instruct the model to stay grounded in the supplied caption/subtitle context, respect the source language, and return only the exact response shape. The Go handler validates the request context, delegates through the existing translation-worker boundary, validates the JSON result, and returns it.

After a successful response, the panel updates its displayed title/caption and forwards the generated fields to its parent. The full-screen editor persists them through the existing project clip metadata PATCH endpoint. That endpoint will accept optional metadata fields, merge only supplied fields into the selected clip, and retain the existing hashtags-only contract.

The standalone local editor remains usable without a persistence callback; it still updates its current panel state.

## Error handling

- Disable the regeneration button while the request is running and show a spinner.
- Preserve the previous information if the request fails.
- Show the server or worker error inline in the metadata panel.
- Reject empty or malformed worker results before updating or persisting the clip.
- Do not modify `video_filename` or unrelated clip fields.

## Testing

- Component tests verify the request includes current subtitles, trim range, existing metadata, and source context; successful responses replace the displayed information; and failures preserve the previous values.
- Go HTTP tests verify the new route delegates to the worker and returns its clip-info response, while the existing hashtag route remains compatible.
- Python worker tests verify the new operation's prompt/response normalization and required fields.
- Project metadata tests verify partial metadata updates merge into a clip without dropping hashtags or unrelated fields.
- Run the required dashboard format, format-check, lint, focused tests, backend tests, and a final change-impact review.
