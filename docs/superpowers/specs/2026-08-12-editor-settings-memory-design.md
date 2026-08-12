# Local Editor Settings Memory Design

## Goal

Remember the user’s latest subtitle and viral-hook configuration in the local editor so new clips can reuse the setup without copying previous clip content.

## Scope

This feature applies to the browser-based local editor. It does not change the backend, S3/MinIO, project database schema, generated videos, subtitle cues, hook text, or project history.

## Remembered preferences

Store a separate versioned browser preference record under:

`openshorts_local_editor_preferences_v1`

The record contains only reusable configuration:

```json
{
  "version": 1,
  "subtitleStyle": {
    "position": "bottom",
    "animation": "word",
    "fontFamily": "Arial",
    "fontSize": 48,
    "fontColor": "#ffffff",
    "highlightColor": "#ffff00",
    "borderColor": "#000000",
    "borderWidth": 2,
    "bgColor": "#000000",
    "bgOpacity": 0
  },
  "subtitleLanguage": "en",
  "hookDefaults": {
    "position": "top",
    "size": "M",
    "entranceAnimation": "spring",
    "durationMs": 2500,
    "color": "#ffffff",
    "fontSize": 48,
    "background": "#111111",
    "fontFamily": "Arial"
  }
}
```

The exact subtitle style values continue to come from the existing defaults and normalization helpers. The exact hook font family continues to come from the existing hook configuration. The example illustrates the contract, not a second source of defaults.

Never persist subtitle cues, cue text, word captions, hook text, hook id, or prior clip-specific selection state in this preference record.

## Initialization behavior

When the editor starts a new empty clip, it loads the remembered preferences and uses them as the initial subtitle style, subtitle language, and future-hook defaults. The new editor state has no subtitle cues and no hook.

When the editor opens an existing saved local project, that project’s stored editor history remains authoritative. Global remembered preferences must not overwrite the project’s saved subtitle style, language, or hook configuration.

When the user adds a hook to a new clip, the editor creates fresh hook content using the remembered hook defaults. The hook text remains the existing fresh placeholder until the user edits it. The remembered duration is clamped to the current clip duration.

If no preferences exist, or if the stored record is malformed, the editor uses the current built-in defaults. Storage failures are best-effort and must never block editing.

## Update behavior

Save preferences immediately after remembered settings change:

- Subtitle style controls update `subtitleStyle`.
- Subtitle source language updates `subtitleLanguage`.
- Hook position, size, entrance animation, duration, color, font size, background, and font family update `hookDefaults`.

Do not update global preferences when the user edits subtitle text, cue timing, word captions, hook text, undo/redo history, or clip-specific selection. Removing a hook also does not erase its remembered defaults; the next hook can reuse them.

Existing project saves continue to persist the complete project history separately through the current IndexedDB persistence flow.

## Implementation boundaries

- Add preference normalization and best-effort read/write helpers beside the existing local editor persistence helpers.
- Initialize only new editor state from the preference record.
- Extract only the allowlisted style and hook fields when saving preferences.
- Reuse existing `normalizeSubtitleStyle`, hook constants, `commitEdit`, and project-loading behavior.
- Add no API routes, migrations, S3 objects, or backend state.

## Verification

Unit tests will cover default preferences, persistence across reads, malformed data fallback, and exclusion of clip content. Component tests will cover new-hook creation from remembered defaults, immediate updates from subtitle and hook controls, and preservation of existing project state.

The existing local editor suite, full frontend tests, lint, and production build must remain green.
