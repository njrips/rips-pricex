-- Durable per-product lifecycle events for Smart Pricing experiments.
-- Source of truth for stopped / applied / reverted / re-run history.

CREATE TABLE IF NOT EXISTS smart_pricing_product_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_domain VARCHAR(255) NOT NULL,
  plan_id VARCHAR(128) NOT NULL,
  test_id VARCHAR(255),
  product_id VARCHAR(255),
  variant_id VARCHAR(255),
  event_type VARCHAR(48) NOT NULL,
  actor VARCHAR(32) NOT NULL DEFAULT 'system',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT smart_pricing_product_events_type_check CHECK (
    event_type IN (
      'launched',
      'stopped',
      'resumed',
      'winner_applied',
      'reverted',
      'finished_control',
      'rerun_queued',
      'guardrail_stopped',
      'auto_applied'
    )
  ),
  CONSTRAINT smart_pricing_product_events_actor_check CHECK (
    actor IN ('merchant', 'system', 'auto_winner', 'guardrail')
  )
);

CREATE INDEX IF NOT EXISTS idx_sp_product_events_shop_plan
  ON smart_pricing_product_events (shop_domain, plan_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sp_product_events_shop_test
  ON smart_pricing_product_events (shop_domain, test_id, created_at DESC)
  WHERE test_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sp_product_events_shop_type
  ON smart_pricing_product_events (shop_domain, event_type, created_at DESC);

COMMENT ON TABLE smart_pricing_product_events IS
  'Authoritative per-SKU Smart Pricing lifecycle log (stop, apply, revert, re-run).';
COMMENT ON COLUMN smart_pricing_product_events.payload IS
  'Event-specific data, e.g. previous/new prices for winner_applied and reverted.';
