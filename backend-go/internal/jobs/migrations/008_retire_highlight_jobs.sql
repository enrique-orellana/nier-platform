UPDATE jobs
SET status = 'cancelled',
    error = 'Highlights generation was removed.',
    updated_at = now()
WHERE kind = 'highlight-generation'
  AND status IN ('queued', 'processing');
