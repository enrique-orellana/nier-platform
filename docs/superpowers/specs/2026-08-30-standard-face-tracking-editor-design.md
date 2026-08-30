# Per-Section Standard Face Tracking in the Editor

## Goal

Allow a user to enable or disable face tracking independently for each
Standard layout section in the local editor. Face tracking is off by default,
and cached tracking data is reused automatically without exposing cache
management controls.

## Current context

The editor already stores contiguous layout segments and lets the user choose
Standard or Streamer for the selected segment. Standard currently renders a
centered/fitted source video in Remotion and does not consume the Python
tracking functions. The Python generation pipeline has the established
YOLO-person detection, speaker association, and smoothed camera behavior that
should be reused for editor tracking analysis.

The editor renders the original master source, so a tracking crop can be
computed against the same source used by both the interactive preview and the
final Remotion export. Existing generated `source_clip` files remain
non-editable baked outputs and are not a source for this feature.

## User experience

### Control

Each selected Standard layout segment exposes a compact `Face tracking`
On/Off control next to the existing Standard/Streamer controls. The control is
hidden or disabled for Streamer segments because Streamer has its own framing
behavior.

New and legacy Standard segments default to Off. A missing field is equivalent
to `face_tracking_enabled: false`, preserving existing editor behavior.

### Behavior

- Off: the Standard section uses the current fixed/fitted framing and does not
  request or apply face tracking.
- On: the editor looks for compatible cached tracking data for that exact
  source and section. A cache hit is used immediately.
- On with no compatible cache: the editor starts one backend analysis for the
  section, shows an unobtrusive analysis state, and applies the returned track
  when ready.
- Export waits for an in-flight analysis and fails with an actionable error if
  analysis cannot complete. It must not silently export a differently framed
  result while the option is On.
- Turning tracking Off leaves the cache intact so turning it back On can reuse
  it.

The preview and final export consume the same normalized crop keyframes. While
  a cache miss is being analyzed, the preview remains on the existing fixed
  framing and clearly indicates that tracking is being prepared.

## Data model

Layout segments gain an optional boolean:

```json
{
  "id": "layout-1",
  "startMs": 0,
  "endMs": 12000,
  "format": "standard",
  "face_tracking_enabled": true
}
```

The matching segment may also contain an internal cache payload:

```json
{
  "face_tracking_cache": {
    "schema_version": 1,
    "source_fingerprint": "...",
    "source_start_sec": 12.5,
    "source_end_sec": 24.5,
    "algorithm_version": "yolo-person-speaker-v1",
    "crop_track": {
      "scenes": [
        {
          "start_sec": 0,
          "end_sec": 12,
          "strategy": "TRACK",
          "keyframes": [
            {
              "time_sec": 0,
              "rect": { "x": 0.22, "y": 0, "width": 0.3164, "height": 1 }
            }
          ]
        }
      ]
    }
  }
}
```

The exact cache payload remains an implementation detail of the render
contract, but it must contain enough source identity, source time range,
algorithm version, and normalized crop keyframes to reject stale data. The
cache remains attached to the segment so saved versions and the editor preview
cannot disagree. It is retained when tracking is disabled and ignored unless
the segment is Standard with tracking enabled.

Segment normalization must preserve valid tracking fields, default the enable
flag to false, and remove or invalidate cache data when a split or time-range
change makes its coverage no longer exact. Splitting a segment must never copy
one segment's tracking cache into both new time ranges.

## Analysis and cache flow

1. The editor sends the job/clip identity, selected segment range, source trim,
   source dimensions, and current manifest revision to the backend.
2. The backend derives the local master source path using the existing project
   source handling. The client-provided source URL is not authoritative.
3. The backend checks the segment cache using source fingerprint, absolute
   source range, output dimensions, and algorithm version.
4. On a hit, the cached normalized crop track is returned without running the
   detector.
5. On a miss, the Python media worker analyzes only the requested section with
   the existing YOLO person detector, `SpeakerTracker`, fallback person
   detection, and smoothed camera crop logic. It returns normalized crop
   keyframes relative to the editor section.
6. The backend persists the cache with the manifest/version data and returns it
   to the editor.
7. The editor passes the enabled segment and its compatible track to both the
   Remotion preview and the version-render request.

Cache keys must change when the source identity, section source range, output
   dimensions/aspect, detector/camera algorithm version, or relevant tracking
   settings change. Changing only subtitles, hooks, or other non-video layers
   must not invalidate tracking data.

## Rendering behavior

The dashboard and root Remotion compositions must resolve tracking only for an
active Standard segment with `face_tracking_enabled === true` and a valid
cache. The track is evaluated at the current composition frame and converted
to the existing normalized crop CSS style. When no track is available, the
composition uses the current fixed Standard framing.

Streamer segments retain their existing gameplay/webcam regions, manual
framing, and transitions. Tracking data from a Standard segment must not alter
the Streamer gameplay or webcam panels. Subtitles, hooks, effects, audio, and
media-clock behavior remain unchanged.

During a crossfade, each Standard layer resolves its own tracking state and
track. A disabled or missing track falls back to that layer's fixed framing.

## Error handling

- Invalid or stale cache data is treated as a cache miss, not as a render
  failure.
- A missing master source, unsupported media, detector failure, or analysis
  timeout returns a clear error tied to the selected segment.
- The UI keeps the toggle state visible, reports the failure, and prevents
  export while tracking is enabled but unresolved.
- Retrying the action may recompute the same cache key; concurrent requests for
  the same key should coalesce or reuse the first successful result.

## Compatibility and migration

Existing manifests without the new fields continue to render exactly as they
do today. No existing Standard segment is silently changed to tracking On.
Existing center-only `timeline.crop_track` data is not treated as a valid
face-tracking cache unless it carries the new cache metadata and algorithm
version.

## Verification

Tests must cover:

- layout model defaulting tracking Off and preserving the fields;
- split/time-range edits invalidating affected cache data;
- the editor control appearing only for Standard sections and committing one
  segment at a time;
- cache-hit and cache-miss backend flows, including source/range/version
  invalidation and concurrent requests;
- Python analysis returning normalized, monotonic crop keyframes and reusing
  the existing detector/tracker behavior;
- Remotion preview and export applying the same per-frame Standard crop;
- disabled, missing, failed, and crossfade cases falling back safely;
- existing Standard, Streamer, subtitle, hook, and export tests remaining
  green.

## Non-goals

- Replacing YOLO with MediaPipe.
- Adding face tracking to Streamer webcam or gameplay panels.
- Making tracking a global project preference.
- Exposing cache deletion, cache editing, or detector tuning controls in the
  editor.
