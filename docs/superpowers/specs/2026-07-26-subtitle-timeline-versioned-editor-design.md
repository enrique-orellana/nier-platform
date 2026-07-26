# Versioned Subtitle Timeline Editor Design

**Date:** 2026-07-26  
**Status:** Approved for implementation planning

## Goal

Add a full video editor for each generated clip with frame-accurate hook and subtitle timeline controls, automatic text-only subtitle translation, selectable original/translated subtitle tracks, and immutable composable render versions that can branch from any previous version without losing history.

## Scope

### In scope

- Full editor layout with large preview, version bar, and multi-track timeline.
- Hook timing, text, style, and animation editing.
- Subtitle cue text and start/end timing editing.
- Automatic subtitle translation using the configured AI text provider.
- Original subtitle track plus any number of translated tracks.
- Active subtitle-track selection for rendering.
- Immutable version manifests and immutable rendered MP4 outputs.
- Branching from any historical version.
- Migration of existing clips without deleting current files.
- Backend, renderer, dashboard, and regression tests.

### Out of scope

- Automatic audio dubbing as part of subtitle translation. The existing ElevenLabs Dub Voice workflow remains separate.
- Editing arbitrary source video pixels, transitions, music, or audio mixing in this editor.
- Overwriting or recycling a previous rendered MP4.

## User experience

The editor opens from a generated clip and shows:

1. A large 9:16 video preview with a frame-accurate playhead.
2. A version bar listing the current branch and all reachable versions.
3. A timeline below the preview with separate Hook, Original Subtitles, and translated subtitle tracks.
4. A properties panel for the selected hook or subtitle cue.
5. Actions for Translate Subtitles, Add Track, Save as New Version, and Branch from Version.

Timeline changes edit a draft only. Save as New Version creates a new child manifest and automatically queues its render; the version becomes current only after that render validates successfully. Branch from Version loads any historical version as the draft parent, so Version 3 can produce Version 5 even when Version 4 already exists.

## Version and manifest model

The canonical editable state is a manifest derived from the existing `render_manifest.py` model. A clip has an immutable version graph:

```text
v0 original
  └─ v1 hook added
       └─ v2 Spanish track added
            └─ v3 hook timing adjusted
```

Each version contains:

- `version_id`: UUID generated once when the version is saved;
- `manifest_revision`: SHA-256 revision calculated from canonical manifest content;
- `parent_version_id`: nullable for the initial version;
- `branch_name`: human-readable branch label;
- `created_at` and `created_by` metadata;
- immutable source asset references and checksums;
- source trim, dimensions, authoritative FPS, and duration;
- `subtitle_tracks`: original plus translated tracks;
- `active_subtitle_track_id`;
- hook text, style, animation, `start_ms`, and `end_ms`;
- effects and other existing render layers;
- fixed master export policy;
- render status, output path, checksum, and validation summary.

Version manifests are stored separately from a small atomic version index/current pointer. A rendered output uses a unique version-specific filename. A failed version remains recorded as failed and never replaces the previous current version.

The renderer always reads immutable source assets and the requested manifest revision. It never uses a prior MP4 as the source for another edit.

## Subtitle tracks and translation

The original subtitle track is immutable. A translation request:

1. Detects or reads the source language from the transcript.
2. Accepts a target language selected by the user.
3. Sends cue text and minimal timing context to the configured AI text provider.
4. Creates a new translated track without changing the original.
5. Initially preserves each source cue's `start_ms` and `end_ms`.
6. Distributes translated word-level highlighting proportionally across each cue interval.

The user can select which track is active, edit translated cue text, split or merge cues, and drag cue boundaries before saving a new version. Audio remains unchanged. Translation failures identify failed cues and leave the current version untouched.

## Backend and renderer flow

Extend the existing manifest API with version-aware operations:

- list versions and branches;
- load a version manifest;
- create a draft from a version;
- translate subtitle cues into a new track;
- save a new immutable version;
- request a validated render for a version;
- poll render status and activate a successful version.

The backend validates source checksums, timing bounds, subtitle-track references, and manifest revisions before rendering. The renderer emits a unique H.264/MP4 output using the existing master policy. The backend promotes the output only after validation confirms that the rendered revision matches the requested version.

## Migration and compatibility

For existing clips without version manifests:

- preserve the existing source and current output files;
- create a legacy Version 0 manifest pointing at the preserved source/current state;
- create the version index/current pointer atomically;
- keep existing URLs readable during migration;
- route all new edits through the versioned editor.

No migration step deletes or renames an existing user output.

## Error handling and safety

- Draft edits are isolated from saved versions.
- Translation and render failures do not mutate the current pointer.
- Invalid version IDs, path traversal, missing assets, checksum mismatches, and stale revisions return explicit errors.
- Downloads and publishing require a successfully validated output for the selected current revision.
- UI state identifies the active branch, selected version, active subtitle language, and whether the preview is a draft or validated render.

## Testing strategy

### Backend

- version creation, parent links, and branching;
- atomic index/current-pointer updates;
- manifest immutability and checksum verification;
- subtitle-track selection and timing validation;
- translation cue mapping and proportional word timing;
- migration of existing clips;
- failed translation/render rollback;
- API path/version validation.

### Dashboard

- timeline playhead and cue drag behavior;
- hook edits and subtitle cue edits;
- original/translated track selection;
- branch creation from a historical version;
- version history rendering and current-pointer updates;
- translation progress and error states.

### Renderer integration

- render hook plus selected translated subtitles from the manifest;
- preserve source FPS and frame-accurate timing;
- validate unique output paths and revision matching;
- verify H.264/MP4 output metadata and playable audio/video.

## Acceptance criteria

1. A user can add a hook, translate subtitles, and adjust both on one timeline.
2. Original subtitles remain available after translation.
3. Every successful render is a distinct immutable version.
4. A new version can be branched from any older version without altering later branches.
5. Existing outputs remain downloadable and visible after migration.
6. A failed edit or render never replaces the last successful version.
7. Final renders preserve the existing master-quality H.264/MP4 policy.
