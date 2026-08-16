ALTER TABLE jobs ADD COLUMN IF NOT EXISTS parent_job_id UUID REFERENCES jobs(id) ON DELETE CASCADE;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS clip_index INTEGER NOT NULL DEFAULT 0 CHECK (clip_index >= 0);

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_status_check CHECK (status IN ('queued', 'processing', 'clips_ready', 'completed', 'failed', 'cancelled'));

CREATE INDEX IF NOT EXISTS jobs_parent_clip_idx ON jobs (parent_job_id, clip_index, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_active_clip_render_idx
    ON jobs (parent_job_id, clip_index)
    WHERE kind = 'clip-render' AND status IN ('queued', 'processing');
