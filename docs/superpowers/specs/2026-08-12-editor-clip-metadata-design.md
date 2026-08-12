# Editor Clip Metadata Panel

## Goal

When a generated project clip is opened in the full-screen editor, keep the generated publishing metadata visible on the editor's left/main side instead of requiring the user to return to the results card.

## Approved layout

Use a compact metadata panel on the left of the editor's main workspace. The video preview and timeline remain immediately to its right. The panel displays:

- the generated clip title;
- the clip duration, formatted in seconds/minutes as appropriate;
- `#shorts` and `#viral` tags;
- the generated YouTube title;
- the generated social caption.

The panel is informational only in this change. It does not edit or persist metadata, and it is not shown when the editor has no generated clip metadata, such as a standalone local upload.

## Architecture and data flow

`ProjectLibrary` already normalizes the API clip payload and passes the clip into `ResultCard`, which opens `FullScreenEditor`. `FullScreenEditor` will pass the relevant clip metadata into `LocalEditorTab` as a dedicated prop. `LocalEditorTab` will render a focused metadata component in the left/main column above the video preview.

The component will prefer the existing generated fields:

- `video_title_for_youtube_short` for the title and YouTube title;
- `video_description_for_tiktok`, falling back to `video_description_for_instagram`, for the caption;
- `end - start`, falling back to `duration`, for duration.

This keeps the editor consistent with the existing result-card presentation without duplicating API fetching or changing the backend contract.

## Error and responsive behavior

Missing fields use safe fallbacks and do not break the editor. If no title, caption, or usable timing is present, the metadata panel is omitted. On narrow screens, the metadata panel stacks above the preview rather than forcing a fixed two-column layout.

## Testing

Add a focused component test covering the generated metadata panel: title, duration, hashtags, YouTube title, and caption render from a representative clip payload. Add a second assertion that the panel is omitted when no clip metadata is supplied. Run the focused dashboard test and the existing dashboard test suite/build relevant to the touched files.
