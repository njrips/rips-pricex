-- Columns the winner rollout, personalization, and segment analytics paths
-- already write to. Without them those writes fail with 42703, which takes down
-- applying a winner. Migration 003 added winner_variant_id but stopped short of
-- the rollout set.

ALTER TABLE tests ADD COLUMN IF NOT EXISTS winner_variant_index INTEGER;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS rollout_percent NUMERIC;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS rollout_started_at TIMESTAMPTZ;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS rollout_schedule JSONB;

-- Segment breakdowns (device / country) are read all over analytics.js and
-- written by saveTestAssignment, which currently falls back to a segment-less
-- insert so the data was silently never captured.
ALTER TABLE test_assignments ADD COLUMN IF NOT EXISTS device VARCHAR(32);
ALTER TABLE test_assignments ADD COLUMN IF NOT EXISTS country VARCHAR(8);

CREATE INDEX IF NOT EXISTS idx_test_assignments_segment
  ON test_assignments (test_id, shop_domain)
  WHERE device IS NOT NULL OR country IS NOT NULL;

COMMENT ON COLUMN tests.rollout_percent IS
  'Percent of traffic receiving the winner during a staged rollout (0-100).';
COMMENT ON COLUMN tests.rollout_schedule IS
  'Staged rollout plan; null when the winner was applied to everyone at once.';
