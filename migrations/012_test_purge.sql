-- Deleted tests are purged for good once a grace period has passed.
--
-- Delete only ever set a test's status to `archived`, so every assignment and
-- event of every deleted test stayed in the database forever: on a busy store
-- that is most of the two largest tables. `deleted_at` starts the clock, and the
-- purge job removes the test and everything recorded against it once the grace
-- period is over. Until then the delete can still be undone by support.

ALTER TABLE tests ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Tests deleted before this column existed: the last update is when they were
-- archived, which is as close as the database can say.
UPDATE tests
   SET deleted_at = COALESCE(updated_at, created_at, NOW())
 WHERE status = 'archived'
   AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tests_purge_due
  ON tests (deleted_at)
  WHERE status = 'archived' AND deleted_at IS NOT NULL;

-- A purged test whose winner was published leaves real prices changed in the
-- merchant's catalogue. What changed, from what, and when is kept here beside
-- the deletion record, so "why is this price different" still has an answer.
ALTER TABLE smart_pricing_deletions ADD COLUMN IF NOT EXISTS details JSONB;
