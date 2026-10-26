-- Shopify Partner development stores use Priceify free. Shopify reports this as
-- shop.plan.partnerDevelopment; NULL means it has not been checked yet.

ALTER TABLE shops ADD COLUMN IF NOT EXISTS partner_development BOOLEAN;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS shop_plan_name TEXT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS shop_plan_checked_at TIMESTAMPTZ;
