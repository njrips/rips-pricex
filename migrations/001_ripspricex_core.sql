-- RipsPriceX consolidated core schema (Smart Pricing + price tests)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Shop registry + entitlement cache (Shopify identity)
CREATE TABLE IF NOT EXISTS shops (
  shop_domain VARCHAR(255) PRIMARY KEY,
  plan_handle VARCHAR(128),
  entitlement_status VARCHAR(64) NOT NULL DEFAULT 'none',
  entitlement_checked_at TIMESTAMPTZ,
  installed_at TIMESTAMPTZ DEFAULT NOW(),
  uninstalled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shop_sessions (
  id SERIAL PRIMARY KEY,
  shop VARCHAR(255) NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  scope TEXT,
  is_online BOOLEAN DEFAULT false,
  expires TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id VARCHAR(255) NOT NULL,
  topic VARCHAR(255) NOT NULL,
  shop_domain VARCHAR(255),
  processed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (webhook_id)
);

CREATE TABLE IF NOT EXISTS key_value_store (
  key VARCHAR(255) PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shop_settings (
  shop_domain VARCHAR(255) PRIMARY KEY,
  price_surface_mappings JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Price tests
CREATE TABLE IF NOT EXISTS tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_domain VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  type VARCHAR(50) NOT NULL,
  source VARCHAR(64) DEFAULT 'smart_pricing',
  target_type VARCHAR(50),
  target_id VARCHAR(255),
  target_ids JSONB,
  status VARCHAR(50) DEFAULT 'draft',
  goal JSONB NOT NULL,
  variants JSONB NOT NULL,
  segments JSONB,
  guardrail_config JSONB,
  custom_rules JSONB,
  scheduled_start_at TIMESTAMPTZ,
  scheduled_stop_at TIMESTAMPTZ,
  personalization_mode VARCHAR(64),
  winner_variant_id VARCHAR(255),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  stopped_at TIMESTAMPTZ,
  CONSTRAINT tests_valid_status CHECK (
    status IN ('draft', 'running', 'stopped', 'completed', 'paused', 'archived', 'scheduled')
  )
);

CREATE INDEX IF NOT EXISTS idx_tests_shop_domain ON tests (shop_domain);
CREATE INDEX IF NOT EXISTS idx_tests_shop_status ON tests (shop_domain, status);
CREATE INDEX IF NOT EXISTS idx_tests_source ON tests (shop_domain, source);

CREATE TABLE IF NOT EXISTS test_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  user_id VARCHAR(255) NOT NULL,
  shop_domain VARCHAR(255) NOT NULL,
  variant_id VARCHAR(255) NOT NULL,
  variant_name VARCHAR(255) NOT NULL,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (test_id, user_id, shop_domain)
);

CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  variant_id VARCHAR(255) NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  shop_domain VARCHAR(255) NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  event_name VARCHAR(255),
  event_value DECIMAL(12, 2) DEFAULT 0,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_test_id ON events (test_id);
CREATE INDEX IF NOT EXISTS idx_events_shop ON events (shop_domain, created_at);

CREATE TABLE IF NOT EXISTS analytics_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  shop_domain VARCHAR(255) NOT NULL,
  variant_id VARCHAR(255) NOT NULL,
  day DATE NOT NULL,
  visitors INT DEFAULT 0,
  conversions INT DEFAULT 0,
  revenue DECIMAL(14, 2) DEFAULT 0,
  UNIQUE (test_id, variant_id, day)
);

-- Smart Pricing inbox
CREATE TABLE IF NOT EXISTS smart_pricing_inbox_plans (
  shop_domain VARCHAR(255) NOT NULL,
  plan_id VARCHAR(64) NOT NULL,
  plan_json JSONB NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'queued',
  test_id UUID NULL,
  archived BOOLEAN NOT NULL DEFAULT false,
  archived_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (shop_domain, plan_id)
);

CREATE INDEX IF NOT EXISTS idx_sp_inbox_shop_status
  ON smart_pricing_inbox_plans (shop_domain, status);
CREATE INDEX IF NOT EXISTS idx_sp_inbox_shop_archived_status
  ON smart_pricing_inbox_plans (shop_domain, archived, status);
CREATE INDEX IF NOT EXISTS idx_sp_inbox_test
  ON smart_pricing_inbox_plans (shop_domain, test_id)
  WHERE test_id IS NOT NULL;

-- Catalog view rollups (opportunity traffic)
CREATE TABLE IF NOT EXISTS catalog_product_view_daily (
  shop_domain VARCHAR(255) NOT NULL,
  product_id VARCHAR(255) NOT NULL,
  day DATE NOT NULL,
  views INT NOT NULL DEFAULT 0,
  sessions INT NOT NULL DEFAULT 0,
  PRIMARY KEY (shop_domain, product_id, day)
);

CREATE TABLE IF NOT EXISTS catalog_product_view_sessions (
  shop_domain VARCHAR(255) NOT NULL,
  product_id VARCHAR(255) NOT NULL,
  session_key VARCHAR(255) NOT NULL,
  day DATE NOT NULL,
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (shop_domain, product_id, session_key, day)
);

CREATE TABLE IF NOT EXISTS catalog_collection_view_daily (
  shop_domain VARCHAR(255) NOT NULL,
  collection_id VARCHAR(255) NOT NULL,
  day DATE NOT NULL,
  views INT NOT NULL DEFAULT 0,
  sessions INT NOT NULL DEFAULT 0,
  PRIMARY KEY (shop_domain, collection_id, day)
);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_tests_updated_at ON tests;
CREATE TRIGGER update_tests_updated_at
  BEFORE UPDATE ON tests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
