# Local Editor Saved Projects

## Goal

Allow the browser-only local editor to persist multiple independent projects
so a user can return to saved videos and continue editing after refreshes or
later visits in the same browser.

## Approved user flow

- The local editor header exposes `Save Project` and `Projects` actions.
- The first save prompts for a project name and defaults to the uploaded video
  filename.
- After the first explicit save, edits auto-save to the active project with a
  short debounce.
- The Projects panel lists saved projects with name, source filename, duration,
  and last-updated time.
- Opening a project loads its video and editor history into the current editor.
- A new upload can be saved as a new project without overwriting the current
  project.
- Reset clears only the active editor session. Delete is explicit and requires
  confirmation.
- Existing single-draft persistence is migrated once into a recoverable project.

## Storage design

Use a new IndexedDB database, `openshorts-local-editor-v2`, with two stores:

- `projects`: metadata and normalized editor history/state.
- `videos`: the original video Blob keyed by project ID.

Each project record contains `id`, `name`, `videoName`, `videoType`,
`videoLastModified`, `durationMs`, `history`, `createdAt`, and `updatedAt`.
The active project ID is stored separately so the last project can be reopened
after refresh. Project state and video data are saved together where possible.

The existing `openshorts_local_editor_state_v1` localStorage entry and
`current` IndexedDB video are migrated once into a project record. Storage
errors or quota failures do not break editing; the editor remains usable in
memory and shows a non-blocking warning.

## Component boundaries

- `localEditorPersistence.js` owns IndexedDB schema, project CRUD, active
  project tracking, normalization, and legacy migration.
- `LocalEditorProjects.jsx` renders the project modal and emits create/open/
  rename/delete actions without accessing storage directly.
- `LocalEditorTab.jsx` owns active-project state, invokes the persistence API,
  triggers debounced auto-save after an explicit save, and supplies project
  data to the modal.

The existing editor controls, subtitle/hook state shape, export behavior, and
browser-only video processing remain unchanged.

## Failure handling

- Invalid or incomplete project records are normalized and skipped or repaired
  with safe defaults.
- Opening a project whose video Blob is unavailable shows an error and leaves
  the current project loaded.
- Deletion removes both metadata and video data; a failed delete leaves the
  project visible and reports the error.
- Auto-save failures show a warning but never replace the in-memory editor
  state.

## Testing

- Persistence tests cover project normalization, create/list/load/rename/delete,
  active-project tracking, and legacy migration.
- Local editor tests cover first-save naming, auto-save after explicit save,
  opening a different project, creating a new project from a new upload, and
  delete confirmation.
- Run the complete dashboard test suite and production build before commit.
