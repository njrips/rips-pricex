-- Priceify Console: named team members with their own sessions, the latest
-- Shopify billing details per store with a history of every change, and
-- time-limited support access that sits beside Shopify's status instead of
-- overwriting it.

CREATE TABLE IF NOT EXISTS team_members (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  role VARCHAR(16) NOT NULL DEFAULT 'support' CHECK (role IN ('support', 'owner')),
  disabled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  last_sign_in_at TIMESTAMPTZ,
  CHECK (email = lower(email))
);

CREATE TABLE IF NOT EXISTS team_sessions (
  id BIGSERIAL PRIMARY KEY,
  member_id BIGINT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  user_agent TEXT,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS team_sessions_member_idx ON team_sessions (member_id);

-- Wrong guesses are counted on the code itself, so the limit survives restarts
-- and does not depend on a client-supplied X-Forwarded-For.
ALTER TABLE staff_login_otp_codes
  ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS console_audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL,
  shop_domain TEXT,
  target_id TEXT,
  detail JSONB,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS console_audit_log_shop_idx
  ON console_audit_log (shop_domain, created_at DESC);
CREATE INDEX IF NOT EXISTS console_audit_log_created_idx
  ON console_audit_log (created_at DESC);

ALTER TABLE support_ticket_messages ADD COLUMN IF NOT EXISTS author_email TEXT;

ALTER TABLE shops
  ADD COLUMN IF NOT EXISTS shopify_shop_gid TEXT,
  ADD COLUMN IF NOT EXISTS subscription_gid TEXT,
  ADD COLUMN IF NOT EXISTS subscription_name TEXT,
  ADD COLUMN IF NOT EXISTS subscription_test BOOLEAN,
  ADD COLUMN IF NOT EXISTS subscription_created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS billing_interval TEXT,
  ADD COLUMN IF NOT EXISTS price_amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS price_currency CHAR(3),
  ADD COLUMN IF NOT EXISTS subscription_ended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS billing_source TEXT,
  ADD COLUMN IF NOT EXISTS partner_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS partner_has_contract BOOLEAN,
  ADD COLUMN IF NOT EXISTS last_app_open_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS shop_billing_events (
  id BIGSERIAL PRIMARY KEY,
  shop_domain TEXT NOT NULL,
  status TEXT,
  plan_handle TEXT,
  subscription_gid TEXT,
  source TEXT NOT NULL,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS shop_billing_events_shop_idx
  ON shop_billing_events (shop_domain, created_at DESC);

CREATE TABLE IF NOT EXISTS support_access_grants (
  id BIGSERIAL PRIMARY KEY,
  shop_domain TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) >= 10),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  granted_by TEXT NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_by TEXT,
  revoke_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (expires_at > starts_at),
  CHECK (expires_at <= starts_at + INTERVAL '31 days')
);
CREATE INDEX IF NOT EXISTS support_access_grants_current_idx
  ON support_access_grants (shop_domain, expires_at) WHERE revoked_at IS NULL;

-- The hidden "dev" plan is retired in the same release. Installed shops that
-- rely on it get 30 days of support access so none of them locks on the first
-- page load after deploy.
INSERT INTO support_access_grants (shop_domain, reason, starts_at, expires_at, granted_by)
SELECT s.shop_domain,
       'Pre-launch store, moved from the dev plan',
       NOW(),
       NOW() + INTERVAL '30 days',
       'system:migration'
FROM shops s
WHERE lower(trim(coalesce(s.plan_handle, ''))) = 'dev'
  AND s.uninstalled_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM support_access_grants g
    WHERE g.shop_domain = s.shop_domain AND g.revoked_at IS NULL AND g.expires_at > NOW()
  );

INSERT INTO console_audit_log (actor_email, action, shop_domain, detail)
SELECT 'system:migration', 'grant.create', g.shop_domain,
       jsonb_build_object('grant_id', g.id, 'days', 30, 'reason', g.reason)
FROM support_access_grants g
WHERE g.granted_by = 'system:migration'
  AND NOT EXISTS (
    SELECT 1 FROM console_audit_log a
    WHERE a.action = 'grant.create' AND a.detail->>'grant_id' = g.id::text
  );
