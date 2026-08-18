# Per-generation transcription language override

## Goal

Allow a user to choose the spoken language for one Generate Clips request without changing the saved global transcription setting.

## Design

- Add a source-language dropdown to the existing `MediaInput` Generate Clips form.
- Default the dropdown to `auto`, which means auto-detection for that request.
- Include the selected value in the object passed from `MediaInput` to `App.handleProcess`.
- In `App.handleProcess`, copy the normal AI headers and override `X-AI-Transcription-Language` only for this request. The global setting and local storage are unchanged.
- Keep the existing Go/Python header transport and OpenRouter payload behavior; no new API body field is required.

## Behavior

- Selecting Italian sends `X-AI-Transcription-Language: it` for that generation.
- Leaving Auto-detect selected sends `X-AI-Transcription-Language: auto`, explicitly avoiding a saved global language override for that job.
- Other AI settings and all subsequent jobs continue using the existing global configuration.

## Verification

- Add a `MediaInput` test that submits the selected source language.
- Add an `App` or request-flow assertion that the per-generation value overrides the global transcription header.
- Run the relevant frontend tests, full frontend tests, Python tests, Go tests, lint, and build.
