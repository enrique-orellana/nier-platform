# Editor Cross-Clip Defaults Design

## Goal

Use the last saved subtitle and viral-hook configuration as browser-local defaults when opening another clip in the project editor, while keeping settings already stored on that clip authoritative.

## Architecture

The existing `openshorts_local_editor_preferences_v1` `localStorage` record remains the single source of cross-clip preferences. `LocalEditorTab` already updates it when subtitle settings or hook settings change. The project editor will read those preferences during manifest-to-draft hydration and use them only as fallbacks.

No backend or manifest schema changes are needed. Subtitle cues, hook text, hook timing, and other clip content remain clip-specific and are never copied into browser defaults.

## Data flow

1. Load the clip manifest and read the existing editor preferences.
2. When a saved subtitle track/style exists, use it unchanged; otherwise use the remembered subtitle style and language.
3. When a saved hook exists, use it unchanged. When the clip has generated `viral_hook_text` but no saved hook, create the hook with that text and the remembered hook visual defaults.
4. When a clip has no hook text, keep the hook absent; the existing “Add Viral Hook” action continues to create one from remembered hook defaults.
5. Any later editor change continues to update the same browser preferences through the existing `LocalEditorTab` logic.

## Testing

- Unit-test manifest hydration with remembered subtitle and hook defaults.
- Verify saved clip subtitle style and hook fields override remembered defaults.
- Verify existing standalone editor preference behavior remains unchanged.
- Run the focused editor tests, dashboard formatting, format check, lint, and the production dashboard build.

