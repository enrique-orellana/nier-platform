# DesignCombo Full-Screen Video Editor

## Goal

Replace the current lightweight cue-editing modal with a full-screen, multi-track video editor while preserving OpenShorts' immutable versions, subtitle translation tracks, high-quality H.264/MP4 rendering, and existing AI workflows.

## Context

The current `ClipEditor` provides a minimal timeline for hook and subtitle cues. It does not provide the editor workspace users expect from a non-linear editor: media pool, transport controls, stacked video/audio/text tracks, trimming and splitting, snapping, zoom, track controls, or a persistent inspector.

The DesignCombo SDK exposes modular React packages for state, timeline rendering, and types. The public editor application has evolved toward an OpenVideo/WebCodecs/Pixi stack, so OpenShorts will integrate the modular timeline/state packages into its existing Vite dashboard instead of adopting the separate Next.js application or browser export path.

## User experience

Opening “Edit Timeline” launches a dedicated full-screen editor route for one clip. The editor is divided into four persistent regions:

1. Media Pool: source media, generated clip versions, translated subtitle tracks, and imported assets.
2. Viewer: Remotion Player preview with play/pause, frame-step, timecode, fit/zoom, and playhead synchronization.
3. Timeline: stacked tracks with a time ruler, zoom, snapping, draggable/resizable/splittable items, selection, and track controls.
4. Inspector and version history: properties for the selected item plus immutable version selection and branching.

The editor has explicit `Cancel`, `Save as New Version`, and `Render Master` actions. The existing current output remains active until the new version is rendered and validated.

## Timeline model

The editor state is a serializable adapter around the existing manifest. DesignCombo state owns interaction state (selection, drag, snapping, undo/redo, zoom, and playhead); the adapter owns OpenShorts semantics and persistence.

Track mapping:

| Track | Manifest source | Editable items |
| --- | --- | --- |
| V1 | `timeline.source_video_url` and trim | source clip trim/split |
| A1 | source media audio | mute/solo/volume and trim |
| Hook | `layers.hook` | text, position, style, start/end |
| S1 | original subtitle track | cue text and timing |
| S2+ | translated subtitle tracks | language selection, cue text and timing |
| FX | `layers.effects` | effect segments and timing |

The normalized timeline item has an id, track id, start time, end time, label, media type, and a manifest reference. Timing is frame-based internally using the clip's source frame rate; UI display may use milliseconds/timecode.

## Preview and export

Remotion Player remains the preview implementation so existing subtitle styling, hook animation, emoji/font fallback, and effect rendering remain consistent with exported output. The playhead seeks the Player to the selected frame.

The browser never becomes the source of truth for final output. Saving creates a new immutable manifest version with the selected parent version. Rendering calls the version render API with the complete normalized props. The render worker produces H.264/MP4 at the source/output frame rate, validates the result, and only then promotes the version and updates the clip pointer.

## Media pool

The media pool is initially populated from the clip manifest and version history. Each item includes a stable asset id, preview URL, type, duration, and source version. Existing generated outputs remain downloadable and selectable; selecting an older version loads its manifest without mutating newer versions.

Uploads and external stock-media providers are intentionally deferred until the core editor is stable. The media-pool component will expose an adapter interface so those providers can be added without changing timeline state.

## Inspectors

The inspector is context-sensitive:

- Source video: trim, split, fit mode, and source metadata.
- Audio: volume, mute, solo, and timing.
- Hook: text, start/end, position, size, entrance animation, and style.
- Subtitle cue: active language track, text, start/end, and style override.
- Effects: segment timing and supported effect parameters.

Every inspector edit produces a new draft object and is undoable. It never writes a saved version directly.

## Translation behavior

The original subtitle track is retained. Translation creates a selectable additional text-only track, preserving the source cue timings and leaving audio unchanged. English is available when the source language is not English; same-language translation is disabled with an explanatory label.

## Versioning and failure handling

- Every save creates a new UUID version with a parent id.
- Branching from any historical version clones that manifest into a new draft, even when a newer version exists.
- Failed renders remain visible in version history with the error and never replace the current output.
- A render timeout, validation failure, or renderer error leaves the previous current version active.
- Cancel discards the draft and reloads the selected immutable manifest.

## Integration boundaries

New frontend boundaries:

- `editor/designcomboAdapter`: manifest ↔ DesignCombo state conversion.
- `components/editor/FullScreenEditor`: route-level workspace shell.
- `components/editor/MediaPool`, `TransportControls`, `TrackControls`, and `InspectorPanel`.
- `editor/renderVersion`: version create/render/poll/complete workflow.

Existing backend version APIs and renderer contracts remain the persistence/export boundary. No new rendering service is introduced.

## Testing

Tests must cover:

- manifest ↔ timeline conversion without mutation;
- frame-accurate move/trim/split/snap operations;
- playhead synchronization with Remotion Player;
- media pool loading and historical-version selection;
- inspector updates for hook, audio, subtitles, translations, and effects;
- save-as-new-version and branch-from-history flows;
- failed render preservation of the current output;
- dashboard lint/build and renderer/backend regression suites.

## Out of scope for this iteration

- Multi-clip project assembly across separate generated clips.
- Browser-side final MP4 export.
- Stock media provider search and cloud asset upload.
- Advanced color grading, multicam editing, or keyframe graph editing beyond the existing effect segment model.

