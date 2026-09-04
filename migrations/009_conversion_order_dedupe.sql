-- One conversion per order, per test, per visitor.
--
-- The storefront stamps data-test-variant on every price node it paints, and on
-- the order pages trackCheckout() loops over all of them, posting the whole
-- order total once per node. Reloading the confirmation page posts it again.
-- Analytics counts conversions with COUNT(DISTINCT user_id) but sums revenue
-- with SUM(event_value), so those repeats left conversions correct and revenue
-- multiplied — inflating revenue per visitor, which is the metric winners are
-- judged on.
--
-- AnalyticsModel.trackEvent already carried an ON CONFLICT clause naming this
-- exact index, but the index was never created, so that path would have failed
-- with 42P10 had anything called it.

-- Collapse the duplicates already recorded, keeping the first row of each group.
-- Only rows that carry an order_id are touched: without one there is nothing to
-- prove two rows describe the same purchase.
DELETE FROM events e
USING events keep
WHERE e.event_type = 'conversion'
  AND keep.event_type = 'conversion'
  AND e.metadata ? 'order_id'
  AND keep.metadata ? 'order_id'
  AND e.metadata->>'order_id' <> ''
  AND keep.metadata->>'order_id' = e.metadata->>'order_id'
  AND keep.test_id = e.test_id
  AND keep.user_id = e.user_id
  -- created_at is nullable, and a NULL here would compare to NULL and leave both
  -- rows in place, which would then fail the unique index below. Falling back to
  -- epoch keeps the ordering total, and the primary key breaks any remaining tie,
  -- so exactly one row of each group survives.
  AND (COALESCE(keep.created_at, 'epoch'::timestamptz), keep.id)
      < (COALESCE(e.created_at, 'epoch'::timestamptz), e.id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_conversion_order
  ON events (test_id, user_id, (metadata->>'order_id'))
  WHERE event_type = 'conversion'
    AND metadata ? 'order_id'
    AND metadata->>'order_id' <> '';
