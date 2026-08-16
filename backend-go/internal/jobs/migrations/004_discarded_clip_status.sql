ALTER TABLE clip_statuses
    DROP CONSTRAINT IF EXISTS clip_statuses_status_check;

ALTER TABLE clip_statuses
    ADD CONSTRAINT clip_statuses_status_check
    CHECK (status IN ('not_reviewed', 'reviewing', 'editing', 'edited', 'discarded', 'published'));
