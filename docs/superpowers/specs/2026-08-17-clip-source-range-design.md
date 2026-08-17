# Clip Source Range Design

## Goal

Show each generated clip’s source start and end times alongside the master video duration on its result card.

## Design

The result card will render one compact metadata row using the exact format `Start MM:SS · End MM:SS · Master MM:SS`. Start and end come from the clip’s existing source `start` and `end` fields. The backend result payload will expose the source asset’s probed duration as `source_duration_seconds`, which the dashboard passes to the card. If unavailable, the card will omit the master value rather than display a fabricated duration.

The formatting logic will stay local to the result-card content component. The additive result field preserves the existing API contract and does not change the video processing pipeline.

## Validation

Add a component regression test that renders a clip with a 176-second start, 204-second end, and 3577-second master duration and verifies the visible row reads `Start 02:56 · End 03:24 · Master 59:37`.
