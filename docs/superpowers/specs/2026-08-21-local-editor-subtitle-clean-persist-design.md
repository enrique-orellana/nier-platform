# Local Editor Subtitle Cleanup and Master Persistence

## Goal

Give the local editor a one-click way to remove terminal periods from the current subtitle cues, and a separate guarded action to persist the edited subtitle track into the clip's master manifest.

## Behavior

- `Clean subtitle dots` updates every current cue immediately, including attached word captions, while preserving cue IDs, timestamps, word timings, line breaks, and non-period punctuation.
- `Persist on master` is available for project clips and sends only subtitle data to a dedicated backend endpoint.
- Persistence replaces or removes the active subtitle track in the master manifest, updates the subtitle layer/style, preserves unrelated layers, and marks the rendered master stale.
- Persistence requires a modal with an exact lowercase `confirm` entry. Cancel, closing, or any other value performs no request.

## Architecture

The frontend owns the pure cue cleanup and editor-state transaction. The Go control plane owns the dedicated persistence route used by the running Docker deployment; the Python API keeps the same route behavior for compatibility with the legacy backend. The endpoint merges subtitle data into the existing manifest instead of accepting a whole replacement manifest, preventing hook/effect/layout loss.

## Error handling and feedback

The editor disables cleanup/persistence while another operation is busy, displays a success notice after persistence, and keeps the draft intact when the request fails.

## Testing

- Vitest covers cue cleanup, the immediate preview/state update, modal confirmation, and request gating.
- Go tests cover merging subtitle data, removing the track, preserving unrelated layers, and invalid payload handling.
- Python API tests cover the compatibility route payload and manifest update.

