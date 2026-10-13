-- Archive, restore and delete belong in a test's lifecycle log. They were only
-- written to the plan's own activity list, which a browser rewrites on every
-- save and keeps to the last 40 entries.

ALTER TABLE smart_pricing_product_events
  DROP CONSTRAINT IF EXISTS smart_pricing_product_events_type_check;

ALTER TABLE smart_pricing_product_events
  ADD CONSTRAINT smart_pricing_product_events_type_check CHECK (
    event_type IN (
      'launched',
      'stopped',
      'resumed',
      'winner_applied',
      'reverted',
      'finished_control',
      'rerun_queued',
      'guardrail_stopped',
      'auto_applied',
      'archived',
      'restored',
      'deleted'
    )
  );

COMMENT ON TABLE smart_pricing_product_events IS
  'Authoritative per-SKU Smart Pricing lifecycle log (stop, apply, revert, re-run, archive, restore, delete).';
