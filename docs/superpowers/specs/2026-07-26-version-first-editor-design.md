# Version-first editor architecture

## Problem

Editor actions currently render through the result-card workflow and update the clip URL directly. The editor draft manifest therefore does not contain every edit, so later saves can lose hooks, effects, subtitle tracks, or audio changes and can render subtitles against a stale base.

## Design

- Treat the selected immutable version manifest as the only editable source of truth.
- Load the current version on editor open and clone it into the draft state. Every action mutates that draft state instead of directly replacing the clip URL.
- Keep the original source media URL in the manifest and accumulate Remotion layers (`effects`, `hook`, optional subtitle tracks, and audio metadata) across edits. Render props are derived from the same draft manifest and frame clock.
- Persist only through `saveAndRenderVersion`: create a child version with the current version as parent, render the full manifest, complete the version, and promote its output URL.
- Subtitles are optional. The manifest may contain zero tracks. When a track is selected, only that track is passed as the active subtitle track to preview and render; all tracks remain stored and selectable.
- Add a version-aware download action in the editor that downloads the promoted output URL and names the file with the immutable version ID.
- Preserve card actions as entry points, but route editor-open actions into the draft-manifest callbacks so they cannot bypass version history.

## Failure handling

- A failed render marks only the new child version failed; the parent/current version and its output remain usable.
- A draft with no subtitles renders normally with `subtitles: null`, an empty subtitle track list, and no active track.
- Download is disabled until the selected version has a completed output URL; errors fall back to opening that exact output URL.

## Testing

- Add adapter tests proving optional subtitles and active-track selection produce correct render props.
- Add editor tests proving effects, hooks, subtitle tracks, and audio metadata accumulate before save and that save uses the current manifest as its parent.
- Add download tests proving the exact completed version URL and version-based filename are used.
