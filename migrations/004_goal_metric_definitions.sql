-- Store-scoped reusable goal and metric definitions for Classic Smart Pricing picker.
-- Tracked data still lands in events.event_name.

CREATE TABLE IF NOT EXISTS goal_metric_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_domain VARCHAR(255) NOT NULL,
  name VARCHAR(120) NOT NULL,
  event_name VARCHAR(100) NOT NULL,
  description TEXT,
  category VARCHAR(50) NOT NULL DEFAULT 'custom',
  aggregation VARCHAR(20) NOT NULL DEFAULT 'count',
  direction VARCHAR(20) NOT NULL DEFAULT 'increase',
  metric_role VARCHAR(20) NOT NULL DEFAULT 'secondary',
  trigger_type VARCHAR(30) NOT NULL DEFAULT 'custom_event',
  trigger_config JSONB NOT NULL DEFAULT '{}',
  tags JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (shop_domain, event_name)
);

CREATE INDEX IF NOT EXISTS idx_goal_metric_definitions_shop
  ON goal_metric_definitions (shop_domain);

CREATE INDEX IF NOT EXISTS idx_goal_metric_definitions_shop_category
  ON goal_metric_definitions (shop_domain, category);

COMMENT ON TABLE goal_metric_definitions IS 'Reusable per-store goals and metrics attachable to Classic price tests.';
COMMENT ON COLUMN goal_metric_definitions.event_name IS 'Canonical event_name for RipX.trackEvent / secondary metrics.';
