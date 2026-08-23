CREATE TABLE IF NOT EXISTS render_performance_metrics (
    render_id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    version_id TEXT,
    clip_index INTEGER NOT NULL CHECK (clip_index >= 0),
    status TEXT NOT NULL CHECK (status IN ('done', 'error')),
    started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ NOT NULL,
    total_duration_ms BIGINT NOT NULL CHECK (total_duration_ms >= 0),
    stage_durations_ms JSONB NOT NULL DEFAULT '{}'::jsonb,
    render_concurrency INTEGER NOT NULL DEFAULT 0 CHECK (render_concurrency >= 0),
    worker_count INTEGER NOT NULL DEFAULT 0 CHECK (worker_count >= 0),
    output_bytes BIGINT NOT NULL DEFAULT 0 CHECK (output_bytes >= 0),
    error TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS render_performance_metrics_created_at_idx
    ON render_performance_metrics (created_at DESC);
CREATE INDEX IF NOT EXISTS render_performance_metrics_job_id_idx
    ON render_performance_metrics (job_id);
CREATE INDEX IF NOT EXISTS render_performance_metrics_status_idx
    ON render_performance_metrics (status);
CREATE INDEX IF NOT EXISTS render_performance_metrics_version_id_idx
    ON render_performance_metrics (version_id);
