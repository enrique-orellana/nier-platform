# Editor Hashtag Generation Design

## Goal

Add an inline AI hashtag generator to the existing left-side clip metadata panel. The generator uses the clip title, caption, and the editor's current subtitle text to replace the default hashtags with 8–12 relevant hashtags, then persists them with the saved editor version.

## User experience

- Keep the existing subtle bordered hashtag group in the left metadata sidebar.
- Add a `Generate hashtags` button beneath or beside the hashtag group.
- While generating, disable the button and show a compact loading state.
- On success, replace the existing `#shorts` and `#viral` values with the generated tags.
- Normalize every result to a single `#`-prefixed tag, remove duplicates, and display no more than 12 tags.
- Show generation failures inline in the sidebar without removing the current hashtags.
- Generated hashtags are stored when the user saves a new editor version and are restored when that version is reopened.

## Data flow

1. `LocalEditorTab` derives the current subtitle text from the live edited subtitle cues, so generated hashtags reflect edits made during the current session.
2. `ClipMetadataPanel` receives the title, caption, current hashtags, and subtitle cues, and owns the transient loading/error state for generation.
3. The panel posts title, caption, and subtitle text to a new backend endpoint, forwarding the existing local AI-provider headers.
4. The backend loads the configured provider through the shared `AIConfig`/`chat_json` path and requests a JSON array containing 8–12 hashtags in the clip's language.
5. The normalized tags return to the panel, which updates the editor metadata state through a callback.
6. `FullScreenEditor` includes the current hashtags in a `publishing_metadata.hashtags` field in the version manifest passed to “Save as new version”.
7. When a saved version is loaded, its manifest hashtags take precedence over the original clip defaults; the original `#shorts`/`#viral` values remain the fallback for older versions without saved hashtag metadata.

## Backend API

Add `POST /api/local-editor/hashtags`.

Request JSON:

```json
{
  "title": "Clip title",
  "caption": "Clip caption",
  "subtitle_text": "Current edited subtitle transcript"
}
```

The endpoint accepts the same `X-AI-*` headers already used by local-editor translation. It returns:

```json
{
  "hashtags": ["#example", "#shorts"]
}
```

The prompt must require relevant, non-generic tags in the source language, exclude prose, and return only JSON. The backend validates the response, normalizes tag formatting, deduplicates case-insensitively, and rejects an empty result with a clear HTTP error.

## Persistence model

The version manifest gains an optional field:

```json
{
  "publishing_metadata": {
    "hashtags": ["#example", "#shorts"]
  }
}
```

This is additive and keeps existing manifests compatible. The generated clip metadata passed from the project library remains the fallback source for title, caption, and default hashtags.

## Error handling

- Missing title, caption, and subtitle text: return a client error explaining that clip context is required.
- AI provider failure or malformed JSON: return a server error with a user-safe message; preserve the current hashtags in the UI.
- No hashtags after normalization: treat as a failed generation rather than saving an empty list.
- Existing saved versions without `publishing_metadata` continue to display the default hashtags.

## Testing

- Backend tests cover request validation, AI JSON parsing, hashtag normalization/deduplication, the 12-tag limit, and provider error handling.
- `ClipMetadataPanel` tests cover the generation button, loading state, successful replacement, and inline error preservation.
- `LocalEditorTab` integration tests verify that current subtitle cues are sent and generated hashtags are passed through the metadata callback.
- `FullScreenEditor` tests verify that saved manifests contain `publishing_metadata.hashtags` and that loaded version metadata is displayed.
- Run the focused tests, the full dashboard test suite, the production build, and touched-file lint before local-cluster deployment.

## Scope boundaries

- No hashtag editing UI beyond generation and display is added in this iteration.
- No changes are made to unrelated Thumbnail Studio or UGC hashtag generation.
- Hashtag generation does not re-upload or re-transcribe the video; it uses the current editor subtitle text.
