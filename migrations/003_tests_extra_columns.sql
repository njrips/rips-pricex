-- Extra test columns used by RipX createTest / scheduling (safe no-ops if unused)

ALTER TABLE tests ADD COLUMN IF NOT EXISTS holdout_percent NUMERIC;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS auto_start BOOLEAN DEFAULT false;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS auto_stop BOOLEAN DEFAULT false;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS timezone VARCHAR(64) DEFAULT 'UTC';
ALTER TABLE tests ADD COLUMN IF NOT EXISTS personalization_mode VARCHAR(64);
ALTER TABLE tests ADD COLUMN IF NOT EXISTS winner_variant_id VARCHAR(255);
ALTER TABLE tests ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- Ensure shop_sessions.shop_domain is uniquely constrained for ON CONFLICT
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shop_sessions_shop_domain_key'
  ) THEN
    BEGIN
      ALTER TABLE shop_sessions ADD CONSTRAINT shop_sessions_shop_domain_key UNIQUE (shop_domain);
    EXCEPTION WHEN others THEN
      -- ignore if duplicates or already unique via index
      NULL;
    END;
  END IF;
END $$;
