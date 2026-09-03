const test = require('node:test');
const assert = require('node:assert/strict');

const { extractBaselineFromPublish } = require('../smartPricingProductLifecycleService');

test('baseline covers every applied variant, not just the display samples', () => {
  // publishWinnerPricesToShopify caps samples.updated at 40 rows for display.
  // Building the revert baseline from that list would leave variant 41+ stuck
  // at the new price while the plan reports a completed revert.
  const rows = Array.from({ length: 120 }, (_, i) => ({
    product_id: `gid://shopify/Product/${i}`,
    variant_id: `gid://shopify/ProductVariant/${i}`,
    previous_price: 10 + i,
    new_price: 20 + i,
  }));

  const publish = {
    samples: { updated: rows.slice(0, 40) },
    applied_variants: rows,
  };

  const baseline = extractBaselineFromPublish(publish);
  assert.equal(baseline.length, 120);
  assert.equal(baseline[119].variant_id, 'gid://shopify/ProductVariant/119');
  assert.equal(baseline[119].previous_price, 129);
});

test('falls back to samples when applied_variants is absent', () => {
  const publish = {
    samples: {
      updated: [
        {
          product_id: 'p1',
          variant_id: 'v1',
          previous_price: 10,
          new_price: 12,
        },
      ],
    },
  };
  const baseline = extractBaselineFromPublish(publish);
  assert.equal(baseline.length, 1);
  assert.equal(baseline[0].variant_id, 'v1');
});

test('drops rows without a usable price pair', () => {
  const publish = {
    applied_variants: [
      { product_id: 'p1', variant_id: 'v1', previous_price: null, new_price: 12 },
      { product_id: 'p2', variant_id: 'v2', previous_price: 10, new_price: 12 },
      { product_id: 'p3', variant_id: null, previous_price: 10, new_price: 12 },
    ],
  };
  const baseline = extractBaselineFromPublish(publish);
  assert.equal(baseline.length, 1);
  assert.equal(baseline[0].variant_id, 'v2');
});
