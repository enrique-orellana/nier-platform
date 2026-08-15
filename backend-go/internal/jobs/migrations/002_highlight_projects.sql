CREATE TABLE IF NOT EXISTS highlight_projects (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    source_bucket TEXT NOT NULL,
    source_key TEXT NOT NULL,
    min_duration_seconds INTEGER NOT NULL CHECK (min_duration_seconds >= 1),
    ideal_duration_seconds INTEGER NOT NULL CHECK (ideal_duration_seconds >= min_duration_seconds),
    latest_job_id UUID NULL REFERENCES jobs(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES highlight_projects(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS highlight_projects_updated_at_idx ON highlight_projects (updated_at DESC, id);
CREATE INDEX IF NOT EXISTS jobs_project_id_idx ON jobs (project_id, created_at DESC, id);
