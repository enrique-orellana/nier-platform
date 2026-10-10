# Local Editor Transcription Language

## Summary

Let users choose the language spoken in a video before generating subtitles in
the Local Editor. This language is a transcription hint, not the desired
translation language.

## User experience

- Add an **Audio language** selector in the Subtitles → Track controls, next to
  **Generate subtitles**.
- Offer **Auto-detect** and the existing `SUBTITLE_LANGUAGES` choices.
- Initialize the selector from the existing `ai_transcription_language_v1`
  preference, defaulting to **Auto-detect**.
- Save changes to that same preference so the Local Editor and AI Settings use
  one shared value. Do not add a separate per-project setting.
- Disable the selector while subtitle generation is running.
- Keep the existing subtitle translation controls separate. Selecting an audio
  language only guides transcription; it does not translate generated captions.

## Data flow and boundaries

- Reuse `ai_transcription_language_v1` and `getLocalAiHeaders()`; add no new
  backend endpoint or persisted editor-project field.
- The selected language continues through the existing
  `X-AI-Transcription-Language` header for both direct video uploads and
  project-clip transcription.
- Use the existing language codes and labels from `SUBTITLE_LANGUAGES`, with
  `auto` as the default option.

## Validation

- Verify the selector defaults to Auto-detect when no preference is saved and
  reflects a saved language otherwise.
- Verify changing it updates the shared preference.
- Verify direct-upload and project-clip transcription requests send the chosen
  language header, including `auto`.
- Run dashboard formatting, formatter check, lint, tests, and production build.
- Smoke-check the Local Editor UI without submitting a user's video.

## Out of scope

- Translating generated subtitles automatically.
- Saving transcription language separately for each project or video.
- Changing transcription providers, models, or backend behavior.
