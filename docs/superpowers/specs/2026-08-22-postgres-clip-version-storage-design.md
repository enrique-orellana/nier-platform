# PostgreSQL Clip Version Storage Design

## Status

Approved design. This change covers newly created clip versions. Existing JSON version files will not be read by the application after the change and will be migrated manually in a separate operation.

## Goal

Store clip-version manifests and version metadata in PostgreSQL, make PostgreSQL the source of truth when switching editor versions, and make exports render the exact persisted version selected for export.

## Current state

The dashboard sends a complete manifest to `POST /api/clip/{job_id}/{clip_index}/versions`. The Go API currently stores the manifest as `{version_id}.json` and maintains a JSON `index.json` under the clip output directory. The version render endpoint loads the saved manifest only to validate its revision, then forwards browser-generated render props to the renderer.

The repository already uses PostgreSQL for durable job/project state and has a `clip_versions` migration, but that table does not currently contain the manifest or a current-version head. The active version handlers use the file-backed `versions.Store` instead.

## Design

### Database model

Extend `clip_versions` with:

- `manifest JSONB NOT NULL`: the complete immutable editor snapshot;
- the existing `version_id`, `project_id`, `clip_index`, `parent_version_id`, `manifest_revision`, `status`, `output_url`, `error`, and `created_at` fields.

Add `clip_version_heads`:

- `project_id TEXT NOT NULL`;
- `clip_index INTEGER NOT NULL`;
- `current_version_id UUID NOT NULL REFERENCES clip_versions(version_id)`;
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`;
- primary key `(project_id, clip_index)`.

The version row is the immutable snapshot. The head row is the mutable pointer to the last successfully promoted version. Creating a pending version never changes the head.

The manifest remains document-shaped in `JSONB`; it is not split into subtitle, hook, effect, audio, and layout tables. This keeps the version snapshot atomic and allows the manifest schema to evolve without a database migration for every editor field.

### Create and branch

The create-version request remains `{manifest, parent_version_id}`. The database repository will:

1. Validate that the optional parent exists for the same project and clip.
2. Copy the manifest in memory.
3. Set `version_id`, `parent_version_id`, `render_status: "pending"`, and `master: null`.
4. Calculate and store `manifest_revision` from the canonical manifest.
5. Insert the version row in PostgreSQL.
6. Return the existing `{version, manifest}` response shape.

Branching follows the same path with the requested source version as the parent. It creates a new immutable row and does not modify the source version or the current head.

### Version switching in the UI

The version GET endpoint will return the database version record and its JSONB manifest using the existing `{version, manifest}` response shape.

When a version is selected, the editor will fully replace its state from that manifest:

- timeline source, trim range, and transcript;
- subtitle tracks, active track, cues, captions, language, and styling;
- hook text, timing, position, visual settings, and animation;
- effects and timing;
- audio;
- layout and export settings;
- publishing metadata, including hashtags;
- version history selection and preview/inspector state.

Unsaved state from the previously selected version is discarded. The editor’s existing hydration path will remain the UI entry point; the change is that its response is backed by PostgreSQL.

### Rendering and export

Export will create the new version before rendering it. The render endpoint will load the version by `version_id` from PostgreSQL and verify the stored manifest revision.

The persisted manifest, not browser-generated props, is authoritative for rendering. The backend will derive or forward render inputs from the loaded manifest, including source video, trim, subtitles, hook, effects, audio, layout, dimensions, frame rate, and duration. The renderer request will include the version ID and manifest revision.

The browser may request an export, but it cannot change the manifest used by an already-created version by sending different render props. The renderer will therefore render the exact database snapshot selected for export.

On successful completion, the backend will update the version status and output URL and atomically update `clip_version_heads`. Failed renders remain recorded as failed and never replace the current head.

### Deletion and activation

Deleting a version is rejected when another version references it as a parent, preserving the version graph. If the deleted version is the current head, the head is moved transactionally to the newest remaining completed version or cleared.

Activation updates `clip_version_heads` only for a completed version with a valid output URL.

### Storage boundary

The database stores version metadata and manifests. Source media and rendered MP4 files remain in their existing object/file storage. No video binary is placed in PostgreSQL.

There is no automatic import, JSON fallback, or temporary legacy read path in this change. Existing JSON files remain untouched until the separate manual migration is run.

## Error handling and consistency

- Missing or cross-clip parent versions return a client error.
- Missing versions return not found.
- Manifest revision mismatches prevent rendering.
- Status transitions and current-head promotion use database transactions.
- A successful render cannot become current unless its version is marked done and has an output URL.
- Database failures do not create partial version records.

## Testing

Backend tests will cover:

- creating a version stores the complete manifest in JSONB;
- generated IDs, parent IDs, pending status, `master: null`, and manifest revisions are persisted;
- branching preserves the parent and does not mutate the source;
- listing and loading return `{version, manifest}`;
- switching/current-head behavior is transactional;
- failed versions cannot become current;
- rendering uses the stored manifest rather than request-supplied browser props;
- activation and deletion update the head correctly.

Dashboard tests will cover:

- switching versions restores all manifest-backed editor state;
- publishing metadata and hashtags are restored;
- the selected version updates the preview, timeline, inspector, and history state.

Renderer tests will verify that version export input is derived from the persisted manifest and carries the expected version ID and revision.

## Non-goals

- Automatically migrating existing JSON files.
- Keeping legacy JSON files readable after the database implementation ships.
- Moving source videos or rendered MP4s into PostgreSQL.
- Normalizing every manifest field into separate relational tables.
