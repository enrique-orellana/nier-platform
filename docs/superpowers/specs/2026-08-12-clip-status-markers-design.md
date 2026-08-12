# Clip Status Markers Design

## Goal

Allow users to track the workflow state of each generated clip independently from the project page.

## Fixed statuses

The status set is fixed and uses stable API values with human-readable labels:

| API value | Label | Visual tone |
| --- | --- | --- |
| `not_reviewed` | Not reviewed | Gray |
| `reviewing` | Reviewing | Amber |
| `editing` | Editing | Blue |
| `edited` | Edited | Green |
| `published` | Published | Violet |

Users can move a clip to any status at any time. The application will not automatically transition statuses when a clip is opened, edited, or published.

## Persistence

Statuses are stored in a project sidecar object in the same S3/MinIO namespace as the generated artifacts:

`<job_id>/clip_statuses.json`

The sidecar uses a versioned document so it can evolve without changing generated clip metadata:

```json
{
  "version": 1,
  "clips": {
    "0": {
      "status": "editing",
      "updated_at": "2026-08-12T18:30:00Z"
    }
  }
}
```

Clips without an entry default to `not_reviewed`. Existing projects require no migration. Project deletion already removes the complete `<job_id>/` prefix, which also removes the sidecar.

## API

### Read statuses

`GET /api/projects/{job_id}/statuses`

Returns the version and a normalized map of clip-index strings to status records. A missing sidecar returns an empty map rather than an error.

### Update one clip

`PATCH /api/projects/{job_id}/clips/{clip_index}/status`

Request body:

```json
{ "status": "edited" }
```

The backend validates both the status value and clip index before persisting. Invalid values return a `4xx` response and leave the sidecar unchanged. Updates use last-write-wins semantics because the sidecar is a small workflow document and the current UI has one active editor per clip.

## UI and data flow

1. `ProjectLibrary` loads the project clips and status map.
2. It passes each clip's status and index into `ResultCard`.
3. Each card displays a colored status badge and compact dropdown.
4. Selecting a status updates the card optimistically and sends the PATCH request.
5. A successful response keeps the new status and updates the project summary.
6. A failed response restores the previous status and shows an error on the project page.
7. The project header summarizes counts, for example `3 edited · 2 reviewing · 1 published`.

## Implementation boundaries

- Add sidecar read/write helpers to `s3_uploader.py`.
- Add validation and API routes to `app.py`.
- Add status loading, update handling, and summary display to `ProjectLibrary.jsx`.
- Add the per-clip badge and selector to `ResultCard.jsx`.
- Keep generated metadata, render manifests, version history, and automatic rendering behavior unchanged.

## Verification

Backend tests will cover missing sidecars, valid persistence, invalid statuses, and invalid clip indexes. Frontend tests will cover rendering all fixed statuses, selecting a status, reloading saved values, and rolling back an optimistic update after a failed request. The existing frontend and backend suites, lint, and production build must remain green.
