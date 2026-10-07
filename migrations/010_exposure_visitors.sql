-- Count a visitor once they have seen the tested price, not on any page view.
--
-- The storefront asks for every running test on every page, and the engine
-- only checks the product on a product page, so a visit to the home page or a
-- blog post assigned the shopper to every product test in the shop. Each
-- product's test then counted close to the whole store's traffic as visitors.
-- Both arms were diluted alike, so results were not biased, but tests needed
-- far more traffic to decide and the visitor numbers were not real.
--
-- exposed_at is stamped when the storefront first shows the shopper a price
-- from the test, or when an order proves they saw it. Tests launched before
-- this keep counting every assignment, so a running test's rates do not jump
-- partway through: they are the rows that take the 'assigned' default below.

ALTER TABLE test_assignments ADD COLUMN IF NOT EXISTS exposed_at TIMESTAMPTZ;

ALTER TABLE tests ADD COLUMN IF NOT EXISTS visitor_basis VARCHAR(16) NOT NULL DEFAULT 'assigned';
ALTER TABLE tests ALTER COLUMN visitor_basis SET DEFAULT 'exposed';

-- Not launched yet, so nothing has been counted the old way.
UPDATE tests
SET visitor_basis = 'exposed'
WHERE started_at IS NULL
  AND status IN ('draft', 'scheduled');

-- Only product price tests report exposure from the storefront; any other kind
-- keeps counting every assignment, or it would count no one.
CREATE OR REPLACE VIEW counted_test_assignments AS
SELECT ta.*
FROM test_assignments ta
JOIN tests t ON t.id = ta.test_id
WHERE t.visitor_basis <> 'exposed'
   OR ta.exposed_at IS NOT NULL
   OR NOT (LOWER(t.type) IN ('price', 'pricing') AND LOWER(COALESCE(t.target_type, '')) = 'product');
