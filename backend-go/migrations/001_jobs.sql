CREATE TABLE jobs (
    id UUID PRIMARY KEY,
    kind TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
    source_url TEXT,
    clip_count INTEGER NOT NULL DEFAULT 6 CHECK (clip_count BETWEEN 3 AND 15),
    output_dir TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    result JSONB,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX jobs_status_updated_at_idx ON jobs (status, updated_at);

CREATE TABLE job_logs (
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    message TEXT NOT NULL,
    PRIMARY KEY (job_id, sequence)
);

CREATE TABLE job_results (
    job_id UUID PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
    result JSONB NOT NULL,
    artifact_prefix TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE clip_versions (
    version_id UUID PRIMARY KEY,
    project_id TEXT NOT NULL,
    clip_index INTEGER NOT NULL CHECK (clip_index >= 0),
    parent_version_id UUID REFERENCES clip_versions(version_id),
    manifest_revision TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'rendering', 'done', 'failed')),
    output_url TEXT,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, clip_index, version_id)
);

CREATE INDEX clip_versions_project_idx ON clip_versions (project_id, clip_index, created_at);

CREATE TABLE clip_statuses (
    project_id TEXT NOT NULL,
    clip_index INTEGER NOT NULL CHECK (clip_index >= 0),
    status TEXT NOT NULL CHECK (status IN ('not_reviewed', 'reviewing', 'editing', 'edited', 'discarded', 'published')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, clip_index)
);

CREATE TABLE publish_jobs (
    id UUID PRIMARY KEY,
    project_id TEXT,
    status TEXT NOT NULL,
    result JSONB,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
