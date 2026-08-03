# Local Editor Overlay Controls

## Goal

Bring the standalone `/editor` tab to parity with the existing Viral Hook and subtitle-style workflows while keeping all editing local and separate from `ClipEditor`.

## Behavior

### Viral Hook

- A hook is optional and represented by `null` when absent.
- The empty state offers `Add Viral Hook`.
- The active hook inspector exposes text, timeline start/end, position (`top`, `center`, `bottom`), size (`S`, `M`, `L`), entrance (`spring`, `fade`, `slide-up`, `none`), text color, font size, and background color.
- The active state offers `Remove Hook`.
- Removing the hook clears it from the timeline, preview, and local video export.

### Subtitles

- A subtitle track is optional and represented by an empty cue list when absent.
- Imported `.srt` and `.vtt` cues remain directly editable on the timeline.
- The subtitle style inspector exposes font family, position (`top`, `middle`, `bottom`), font size, text color, highlight color, outline color/width, background color/opacity, and animation (`pop`, `word-highlight`, `karaoke`, `none`).
- The subtitle section offers `Remove Subtitles`, which clears the whole track after confirmation; individual cues remain removable from the cue inspector.
- Removing subtitles clears them from the timeline, preview, local video export, and subtitle download action.
- Imported formats have cue timing only, so word-oriented animations use cue-level timing in the local editor.

## Architecture

Changes stay within `dashboard/src/components/local-editor/`. The editor keeps `hook` nullable and `subtitleCues` empty when disabled. Preview and `renderLocalVideo` receive the current nullable/empty state, so removal has one source of truth. Shared local constants/helpers will keep inspector labels, defaults, and renderer behavior aligned without coupling the standalone editor to API-backed modal components.

## Error handling

- Removing a subtitle track prompts before clearing imported cues.
- Removing a hook is immediate because it is a single optional overlay.
- Existing timing validation remains in place; zero-duration VTT cues are normalized before the editor applies its minimum editable duration.

## Verification

- Add UI tests for hook control parity and hook removal.
- Add UI tests for subtitle style controls, individual cue removal, and whole-track removal.
- Preserve existing parser/export tests.
- Run the full test suite, lint, production build, and `git diff --check`.
