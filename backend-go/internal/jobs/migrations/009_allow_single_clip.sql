ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_clip_count_check;
ALTER TABLE jobs
    ADD CONSTRAINT jobs_clip_count_check CHECK (clip_count BETWEEN 1 AND 15);
