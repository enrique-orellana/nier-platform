# Local Editor Render Completion Badge

## Goal

Make background completion of a newly rendered clip version visible in the local editor. When a version render finishes successfully, the existing Versions/Version History control shows a small ready badge. Opening that control clears the badge.

Deployment is explicitly out of scope for this change.

## Current context

`FullScreenEditor` owns immutable version state and calls `saveAndRenderVersion`, which creates a version, starts the render, polls `/api/render/:id`, and completes the version. The local editor receives `VersionHistory` as its side panel. There is no need for a second render tracker or a new navigation tab.

## Behavior

- While a render is active, existing rendering/busy behavior remains unchanged.
- When `saveAndRenderVersion` returns `done`, the editor refreshes or appends the completed version in the existing version list and sets a completion-notice state.
- The Versions/Version History control displays a compact success badge such as `Ready`.
- Opening the Versions/Version History control clears the badge. Selecting a version also follows the existing selection behavior.
- Failed renders do not show a success badge; the existing error message remains the failure feedback.
- The badge is session-local and does not persist across editor reloads.

## Data flow

```text
saveAndRenderVersion
        |
        v
FullScreenEditor receives done
        |
        +--> update versions/current version
        |
        +--> set render-complete notice
                         |
                         v
              Version History badge
                         |
                  open Versions
                         |
                         v
                 clear notice state
```

The notification state stays in `FullScreenEditor`, because that component owns render completion and passes the presentation state plus the clear callback to the existing Version History UI. `VersionHistory` remains presentational.

## Error handling

Render failures do not set the success notice. Existing render errors continue to be shown in the editor footer. A completion notice is only set after the version has an output URL and the completion API call succeeds.

## Testing

- Add a `VersionHistory` test proving the ready badge is rendered and its open callback is invoked.
- Add a `FullScreenEditor` test proving a successful render marks the version area as ready.
- Preserve existing `renderVersion` success and failure coverage.
- Run dashboard formatting, format check, lint, and full test suite.

## Scope

Included: completion state, badge presentation, clear-on-open behavior, and tests.

Excluded: browser notifications, audio alerts, persistent notifications, backend API changes, new navigation tabs, and Docker deployment.
