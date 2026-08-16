# Discarded Clip Status Design

## Goal

Add `Discarded` as a persisted clip workflow status without deleting or hiding the clip.

## Behavior

- The status value is `discarded` and the dashboard label is `Discarded`.
- It appears alongside Not reviewed, Reviewing, Editing, Edited, and Published in the clip status selector.
- The existing clip-status API persists it through the current sidecar/storage paths.
- Status summaries count discarded clips using the existing summary mechanism.
- Existing clips remain visible and can be moved back to another status.

## Implementation and validation

Update every status allowlist and database check constraint used by the FastAPI path and Go control-plane path. Add focused API, migration, dashboard selector, and project-library summary coverage before implementation. Existing status behavior and optimistic rollback behavior remain unchanged.
