# Standalone Local Editor Design

**Date:** 2026-08-03

## Goal

Add a standalone `/editor` tab where users can upload a local video, import `.srt` or `.vtt` subtitles, edit subtitle timing/text on a timeline, add and edit a viral hook overlay, and export the result locally without using the backend or the existing project `ClipEditor`.

## Scope

In scope:

- A new navigation item and route at `/editor`.
- Local video upload through a file picker and drag-and-drop.
- Browser-native video preview and playback controls.
- Subtitle import for `.srt` and `.vtt` only.
- Subtitle cue editing: text, start time, end time, selection, dragging, resizing, and deletion.
- Viral hook editing: text, start time, end time, position, color, font size, and background.
- A local timeline with separate Viral Hook and subtitles tracks.
- Local video export with subtitle and hook overlays burned into the rendered output where browser capture APIs are supported.
- Local `.srt` export of the edited subtitle track.
- Resetting the local editor state.
- Unit and component tests for parsing, editing, and route-level behavior.

Out of scope:

- `.txt` subtitle import.
- Automatic subtitle generation or transcription.
- Backend/API calls.
- Saving to Projects, server-side persistence, immutable versions, or server rendering.
- Changes to the existing backend-powered `ClipEditor` behavior.

## User experience

### Empty state

The `/editor` tab opens with a dark OpenShorts upload surface. Users can choose a local video file or drag one onto the surface. The UI explains that the editor runs locally and does not upload the video. Unsupported or unplayable files produce an inline error.

### Editing state

After a video loads, the tab shows:

- A native video preview with play/pause, seek, and current-time/duration controls.
- An import control accepting `.srt` and `.vtt` files.
- A subtitle track and a Viral Hook track on the timeline.
- Cue blocks that can be selected, moved, and resized.
- A side inspector for the selected subtitle cue or hook.
- Export Video, Export Subtitles, and Reset actions.

Importing a subtitle file replaces the current subtitle track only after confirmation when existing cues are present. Malformed files show a readable error and leave the existing track unchanged.

### Subtitle editing

SRT and VTT timestamps are converted to a common millisecond-based cue model:

```js
{
  id: 'subtitle-1',
  text: 'Caption text',
  startMs: 1200,
  endMs: 3400,
}
```

VTT headers, cue identifiers, and cue settings are ignored except for timing and text. Cue text preserves line breaks for preview and export. SRT export writes sequential numeric identifiers and normalized `HH:MM:SS,mmm` timestamps.

### Viral hook editing

The hook is a separate optional item:

```js
{
  id: 'hook',
  text: 'Wait until you see this',
  startMs: 0,
  endMs: 2500,
  position: 'top',
  color: '#ffffff',
  fontSize: 48,
  background: '#111111',
}
```

The hook appears in the preview only during its time range. The inspector edits its text, timing, vertical position, text color, font size, and background color. Hook timeline movement and resizing use the same millisecond timeline model as subtitle cues.

## Architecture

The new tab is isolated in `dashboard/src/components/local-editor/`:

- `LocalEditorTab.jsx` owns the local file, object URL lifecycle, video metadata, preview state, timeline state, inspector state, import flow, hook state, and export actions.
- `subtitleFormats.js` contains pure SRT/VTT parsers and SRT serialization helpers.
- `subtitleFormats.test.js` tests parser and serializer behavior without React or browser APIs.
- `LocalEditorTab.test.jsx` tests the user-facing editor states and interactions.

`dashboard/src/App.jsx` will only import the new tab, add its sidebar navigation button, and render it for `activeTab === 'editor'`. `dashboard/src/routing.js` will map `editor` to `/editor`. The existing `ClipEditor` remains untouched and is not used by the new tab.

The tab may reuse low-level timeline primitives such as `TimelineTrack` and `TimelineCue` when their props are sufficient, but it will own its own state and will not depend on backend manifests, version history, job IDs, or render endpoints.

## Local export

Export Video will draw the current video frame and active overlays onto a canvas, capture the canvas stream, combine it with the source video's audio stream when available, and record through `MediaRecorder`. The preferred output MIME type will be selected from browser-supported options, preferring WebM when available. The resulting local Blob will download through a temporary object URL.

If the browser cannot provide the required capture or recording APIs, the UI will show an inline error and keep the editor state intact. Export Subtitles will always remain available when subtitle cues exist and will download the current track as an `.srt` file.

## Error handling

- Reject non-video uploads with an inline message.
- Revoke previous video object URLs when a new file is loaded or the editor is reset.
- Reject malformed or empty SRT/VTT files without mutating the current cues.
- Clamp cue times to the video duration and prevent end times before start times.
- Disable export actions while no video is loaded or while an export is running.
- Surface MediaRecorder/canvas failures without losing local edits.

## Verification

Tests will cover:

- SRT parsing with sequential identifiers and multiline text.
- VTT parsing with headers, cue identifiers, and cue settings.
- Invalid timestamp and empty-file errors.
- SRT serialization round trips.
- Route mapping for `/editor`.
- Rendering the empty state and editing state.
- Importing a subtitle file into the timeline.
- Editing subtitle and hook fields.
- Export button availability and reset behavior.

The dashboard test suite and production build will be run after implementation.
