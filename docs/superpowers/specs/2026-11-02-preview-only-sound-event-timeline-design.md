# Preview-Only Sound Event Timeline

## Summary

Add timed sound-event cues to the clip editor timeline so users can review detections such as laughter and applause alongside the video. Users can show or hide the active event label in the editor preview. Sound-event labels are visual review aids only: they are never added to subtitle tracks, saved render manifests, or final video renders.

## Goals

- Show the selected clip's detected sound events on a dedicated timeline lane.
- Keep event timing aligned to the clip preview while preserving the source-video timestamps stored by analysis.
- Let users seek to an event by selecting its timeline cue.
- Display the active event label over the video preview when preview labels are enabled.
- Make preview labels optional and keep them out of final renders and subtitle exports.
- Reuse the sound events already stored in the clip-generation transcript metadata.

## Non-goals

- Running another audio-analysis pass or changing the configured providers.
- Editing, moving, relabeling, or deleting detected events.
- Turning sound events into subtitles, captions, or exported graphics.
- Changing which clips Codex selects or when a candidate is rendered.

## Design

### Data flow

The persisted transcript already contains absolute-time `events` records with `start`, `end`, `label`, `confidence`, and `source`. Extend the existing clip transcript response at `/api/clip/{job_id}/{clip_index}/transcript` with a `sound_events` array. Include only events overlapping the requested clip range and convert their bounds to seconds relative to that clip's start. Preserve each event's label, confidence, and source. An empty event list is a valid response; older projects with no event data remain editable.

The clip editor passes those records to the local editor as separate sound-event data. It does not merge them into subtitle cues or the render manifest.

### Timeline interaction

Add a `Sounds` lane to the existing clip editor timeline, alongside the speech/subtitle and layout tracks. Each event is a non-editable cue positioned by its clip-relative start and end. Selecting a cue seeks the preview to the event start and selects that event for inspection. The cue label and confidence remain available in its accessible name or tooltip.

Add a `Show sound labels in preview` toggle, enabled by default, in the timeline/preview controls. When enabled, the editor displays the label for the event active at the playhead. If events overlap, show the highest-confidence active event. When disabled, keep timeline cues visible but hide the preview overlay.

### Preview-only rendering boundary

Render the sound label as an editor-interface overlay outside the Remotion composition and outside the saved manifest. This keeps it visible while reviewing the clip but guarantees that final render/export output and subtitle files do not contain sound-event labels. The toggle affects only the current editor preview state.

### Failure behavior

If transcript metadata is missing, the transcript endpoint can continue returning its existing transcript error response; the editor treats unavailable sound-event data as an empty lane and keeps the rest of the editor usable. Invalid or out-of-range event records are omitted from the response. No new provider is called and no analysis fallback is introduced.

## Acceptance criteria

1. Opening a generated clip in Edit Timeline shows a separate Sounds lane when the transcript contains events.
2. Each event cue aligns with its time in the selected clip, not its time from the beginning of the source video.
3. Selecting a cue seeks the preview to its start; with the preview toggle enabled, its label appears while the playhead is inside its event interval.
4. Disabling the toggle hides event labels in the preview without removing timeline cues.
5. Event labels do not appear in saved versions, final video renders, subtitle tracks, or subtitle exports.
6. Projects without sound events continue to open and edit without errors.

## Verification plan

- Cover clip-range filtering and relative event timestamps in the Go transcript handler tests.
- Cover timeline cue rendering and selection, preview toggle behavior, and the absence of event data from render inputs in focused dashboard tests.
- Run the dashboard formatter, formatter check, and linter required by the repository instructions.
- Restart the local frontend and verify the feature in Brave against a project containing sound events.
