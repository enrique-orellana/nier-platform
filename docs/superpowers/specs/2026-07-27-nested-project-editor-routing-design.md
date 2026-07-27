# Nested Project and Editor Routing

## Goal

Persist project detail and clip timeline editor context in the browser URL so hard reloads, browser history, and shareable links restore the same view.

## URL contract

- `/projects` — project library.
- `/projects/:projectId` — project detail.
- `/projects/:projectId/clips/:clipIndex/editor` — clip timeline editor.
- `?version=:versionId` optionally selects an editor version.

Project IDs and version IDs are encoded as URL path/query components. Clip indexes remain numeric.

## Behavior

- The URL is the source of truth for project/detail/editor view state.
- Selecting a project, opening a clip editor, selecting an editor version, closing the editor, and returning to the library update browser history with `pushState`.
- Browser back/forward rehydrates the corresponding view.
- On reload, project data and clip data are fetched from the existing APIs using the route parameters.
- Invalid or unavailable route parameters show the existing project-library error/fallback behavior rather than crashing.
- Existing top-level dashboard routes remain unchanged.

## Implementation boundaries

- Extend the existing lightweight history-based routing helpers; do not add a router dependency.
- Keep editor editing state local to the editor; only route identity and selected version are URL state.
- Preserve the existing `#app` and `#legal` landing-page hash behavior.

## Verification

- Add route parser/builder tests for project detail and editor URLs, including encoded IDs and version query parameters.
- Run the complete dashboard test suite, lint, and production build.
