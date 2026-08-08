-- Align shop_sessions with Express shopSession model (shop_domain PK)

ALTER TABLE shop_sessions ADD COLUMN IF NOT EXISTS shop_domain VARCHAR(255);
ALTER TABLE shop_sessions ADD COLUMN IF NOT EXISTS installed_at TIMESTAMPTZ DEFAULT NOW();

-- Backfill from legacy `shop` column when present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shop_sessions' AND column_name = 'shop'
  ) THEN
    UPDATE shop_sessions
    SET shop_domain = lower(shop)
    WHERE shop_domain IS NULL AND shop IS NOT NULL;
  END IF;
END $$;

-- Unique on shop_domain for upsert conflict target
CREATE UNIQUE INDEX IF NOT EXISTS idx_shop_sessions_shop_domain
  ON shop_sessions (shop_domain)
  WHERE shop_domain IS NOT NULL;
