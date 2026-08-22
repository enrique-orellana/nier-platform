# Version History Tree and Generated Clip Links

## Goal

Make the editor's Version History easier to understand by displaying versions as a parent/child tree and by providing a new-tab link to each completed version's generated clip.

## Current Context

The dashboard already receives `parent_version_id`, `status`, and `output_url` for each version from the existing version-history API. The existing `VersionHistory` component renders all versions as a flat list and supports selecting, branching, and deleting versions. The API and render pipeline do not need to change for this feature.

## Design

`VersionHistory` will transform the flat `versions` array into a hierarchy rooted at records without a `parent_version_id`. Each version will render as a tree node, with descendants nested beneath their parent using indentation and subtle connector styling. The existing version selection behavior remains attached to the version label, and current-version highlighting, status, Branch, and Delete controls remain available on each node.

Completed versions with a non-empty `output_url` will expose a separate external-link control labelled “Open generated clip”. The link will use the dashboard's existing API URL normalizer, open in a new browser tab, and set `rel="noreferrer"`. Versions that are pending, rendering, failed, or missing an output URL will not expose this control.

The displayed version identifier remains the existing compact identifier format; the change is structural rather than a change to version identity.

## Components and Data Flow

- `VersionHistory.jsx` will own the pure tree-building transformation and recursive tree-node rendering.
- A small recursive node component or local render helper will receive one version and its children, then render the existing controls plus the generated-clip link when eligible.
- `getApiUrl` will normalize relative generated-media paths while preserving absolute URLs.
- `parent_version_id` values that do not resolve to a version in the supplied list will not prevent rendering; those records will be treated as roots so history remains visible.

## Testing

Add focused component tests that verify:

1. A child version is rendered beneath its parent rather than as a sibling root.
2. A completed version with `output_url` renders an external link with the expected URL, `target="_blank"`, `rel="noreferrer"`, and accessible label.
3. A version without a completed output does not render a generated-clip link.

Run the focused VersionHistory test, then the dashboard formatting and lint commands required for files under `dashboard/src`.

## Scope and Non-Goals

- Do not change the version API, persistence model, render service, or routing.
- Do not change how selecting, branching, deleting, or activating versions works.
- Do not add a full graph canvas or SVG layout engine; the tree is an accessible nested DOM structure suitable for the existing panel.
