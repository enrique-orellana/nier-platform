ALTER TABLE render_performance_metrics
    ADD COLUMN IF NOT EXISTS acceleration_mode TEXT NOT NULL DEFAULT 'cpu'
    CHECK (acceleration_mode IN ('cpu', 'gpu'));
