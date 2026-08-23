# Optional Subtitle Display Mode

## Goal

Allow subtitle authors to choose between the existing phrase/block display and a single-word-at-a-time display, with the editor preview and exported video using the same setting.

## Behavior

- `phrase` is the backward-compatible default. It renders the current subtitle block and highlights the active timed word.
- `single-word` renders only the active timed word from the current subtitle block.
- The subtitle style inspector exposes a toggle named `One word at a time` and updates the preview immediately.
- The setting is stored in the existing subtitle style object, so it travels with subtitle tracks, manifests, versions, and exports.
- Legacy styles without the setting normalize to `phrase`.

## Implementation

- Add a `displayMode` field to the shared subtitle style types/schema and both preview/render defaults.
- Normalize invalid or missing values to `phrase`.
- Apply the mode in both copies of the Remotion subtitle composition.
- Add the toggle to `LocalEditorSubtitleStyleInspector`.
- Cover normalization, UI interaction, and both composition paths with regression tests.

## Verification

- Dashboard targeted tests, formatting checks, lint, and production build.
- Render-service tests and production build.
- GitNexus change detection before commit.
- Rebuild and health-check the frontend and renderer Docker services.
