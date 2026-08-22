CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY,
    kind TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'clips_ready', 'completed', 'failed', 'cancelled')),
    source_url TEXT,
    clip_count INTEGER NOT NULL DEFAULT 6 CHECK (clip_count BETWEEN 3 AND 15),
    output_dir TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    result JSONB,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_status_check CHECK (status IN ('queued', 'processing', 'clips_ready', 'completed', 'failed', 'cancelled'));

CREATE INDEX IF NOT EXISTS jobs_status_updated_at_idx ON jobs (status, updated_at);

CREATE TABLE IF NOT EXISTS job_logs (
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    message TEXT NOT NULL,
    PRIMARY KEY (job_id, sequence)
);

CREATE TABLE IF NOT EXISTS job_results (
    job_id UUID PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
    result JSONB NOT NULL,
    artifact_prefix TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clip_versions (
    version_id UUID PRIMARY KEY,
    project_id TEXT NOT NULL,
    clip_index INTEGER NOT NULL CHECK (clip_index >= 0),
    parent_version_id UUID,
    manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
    manifest_revision TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'rendering', 'done', 'failed')),
    output_url TEXT,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, clip_index, version_id)
);

ALTER TABLE clip_versions
    ADD COLUMN IF NOT EXISTS manifest JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE clip_versions
    DROP CONSTRAINT IF EXISTS clip_versions_parent_version_id_fkey;

ALTER TABLE clip_versions
    DROP CONSTRAINT IF EXISTS clip_versions_parent_scope_fkey;

ALTER TABLE clip_versions
    ADD CONSTRAINT clip_versions_parent_scope_fkey
    FOREIGN KEY (project_id, clip_index, parent_version_id)
    REFERENCES clip_versions (project_id, clip_index, version_id);

CREATE INDEX IF NOT EXISTS clip_versions_project_idx ON clip_versions (project_id, clip_index, created_at);

CREATE TABLE IF NOT EXISTS clip_version_heads (
    project_id TEXT NOT NULL,
    clip_index INTEGER NOT NULL CHECK (clip_index >= 0),
    current_version_id UUID NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, clip_index),
    CONSTRAINT clip_version_heads_current_scope_fkey
        FOREIGN KEY (project_id, clip_index, current_version_id)
        REFERENCES clip_versions (project_id, clip_index, version_id)
);

CREATE INDEX IF NOT EXISTS clip_version_heads_current_idx
    ON clip_version_heads (current_version_id);

CREATE TABLE IF NOT EXISTS clip_statuses (
    project_id TEXT NOT NULL,
    clip_index INTEGER NOT NULL CHECK (clip_index >= 0),
    status TEXT NOT NULL CHECK (status IN ('not_reviewed', 'reviewing', 'editing', 'edited', 'discarded', 'published')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, clip_index)
);

CREATE TABLE IF NOT EXISTS publish_jobs (
    id UUID PRIMARY KEY,
    project_id TEXT,
    status TEXT NOT NULL,
    result JSONB,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
