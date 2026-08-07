# Visual Audio Reference Track Design

**Date:** 2026-08-07  
**Status:** Approved for implementation planning

## Goal

Add a real waveform reference lane to the standalone Local Editor at `/editor`. The lane will be the final element in the timeline so users can compare subtitle and hook cue boundaries against the source video's audio while manually adjusting cue timing.

## Existing context

`LocalEditorTab` already owns the loaded video URL, measured duration, playhead, and editable subtitle/hook state. `LocalEditorTimeline` currently renders the hook and subtitle lanes, supports horizontal seeking, and preserves drag/resize behavior for cues. The dashboard already depends on `@remotion/media-utils`, so waveform data can be decoded in the browser for both local object URLs and same-origin/proxied remote videos.

## User experience

- The timeline order is: `Viral Hook`, `Subtitles`, then `Audio` as the bottom-most and last-rendered lane.
- The audio lane spans the full loaded video duration and displays symmetrical waveform peaks aligned to the same horizontal time scale as the cue lanes.
- The waveform is a visual timing reference only. It does not change subtitle or hook timing, playback, persistence, or export behavior.
- Existing cue selection, dragging, resizing, seeking, playhead movement, and cue-table editing remain unchanged.
- The audio lane remains present while waveform data is loading or unavailable, with a low-contrast status message instead of blocking the editor.

## Technical design

### Waveform loading

Create a focused `AudioWaveform` component used by `LocalEditorTimeline`.

1. Receive the current `videoUrl` and a target sample count from the timeline.
2. Load audio data with `getAudioData(videoUrl)` from `@remotion/media-utils`.
3. Downsample the decoded channel data into a bounded number of peak bars suitable for the current timeline width. Use the same `durationMs` and lane width used by the cue tracks so every bar maps to the correct time position.
4. Cancel or ignore stale asynchronous results when the URL changes or the component unmounts. Cache successful results by URL during the editor session to avoid decoding the same video repeatedly.
5. Render the bars in a compact, accessible visual container. The waveform itself is not an interactive drag target.

`LocalEditorTab` passes its active `videoUrl` into `LocalEditorTimeline`; no manifest or backend change is needed.

### States and failure handling

- No URL: render the audio lane with a muted `No audio source` state.
- Loading: render the lane immediately with `Loading waveform…` while preserving its height and time alignment.
- Successful decode: render the peak bars with the existing dark timeline styling and a distinct audio accent color.
- Decode/network/unsupported-audio failure: keep the lane visible and render `Audio waveform unavailable`; the rest of the editor remains fully usable.

### Layout and interaction boundaries

The audio lane uses the existing track label width, computed timeline width, horizontal scroll container, and playhead overlay. It is rendered after the subtitle `Track` so it is structurally the last timeline element. Cue pointer handlers remain attached only to cue blocks; audio waveform bars have pointer events disabled and cannot intercept cue editing.

## Testing

- `LocalEditorTimeline` verifies the audio lane is rendered after the subtitle lane and remains present when the waveform is loading or unavailable.
- `AudioWaveform` tests mock `getAudioData` and verify deterministic peak-bar rendering for successful decoding and the fallback message for rejected decoding.
- A local-editor integration assertion verifies the active video URL is passed to the timeline/waveform path.
- Existing timeline tests continue to cover cue selection, movement, resizing, seeking, and playhead visibility.
- Run the dashboard test suite, lint, and production build before considering the change complete.

## Scope

Included: browser-side waveform decoding, the bottom audio reference lane, loading/error fallback states, and focused tests.

Excluded: audio trimming, volume editing, audio replacement, waveform persistence, backend waveform APIs, and changes to render/export contracts.

## Acceptance criteria

1. Opening `/editor` with a playable video shows an `Audio` lane below all cue lanes.
2. The lane displays real audio peaks aligned with the timeline duration and playhead.
3. A user can manually move subtitle or hook cues while using the waveform as a timing reference.
4. Local uploaded videos and remote/proxied project videos do not require separate waveform implementations.
5. Audio decode failures do not prevent cue editing or export.
