const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildPriceTestPayloadFromPlan } = require('../planToPriceTestService');
const { buildOfferTestPayloadFromPlan } = require('../planToOfferTestService');

const pricePlan = {
  id: 'SP-1042',
  title: 'Classic Hoodie M',
  product_id: 'gid://shopify/Product/101',
  variant_id: 'gid://shopify/ProductVariant/1001',
  current_price: 59,
  price_arms: [
    { id: 'arm_1', label: 'Lower', role: 'challenger', price: 54, allocation_percent: 50 },
    { id: 'arm_2', label: 'Control', role: 'control', price: 59, allocation_percent: 50 },
  ],
};

const offerPlan = {
  id: 'plan-1',
  title: 'Growth tee',
  product_id: 'gid://shopify/Product/1',
  current_price: 40,
  currency: 'USD',
  experiment_type: 'offer_test',
  metadata: { experiment_title: 'Summer offer', experiment_type: 'offer_test' },
  price_arms: [
    { id: 'control', role: 'control', label: 'Control', allocation_percent: 50 },
    {
      id: 'var_a',
      role: 'challenger',
      label: 'Variation A',
      allocation_percent: 50,
      offer: { discount_type: 'percent', discount_value: 10 },
    },
  ],
};

describe('min sample size on launch payloads', () => {
  it('copies launch preference sample size onto the price test goal', () => {
    const payload = buildPriceTestPayloadFromPlan({
      ...pricePlan,
      launch_preferences: { min_sample_size: 2500 },
    });
    assert.equal(payload.goal.min_sample_size, 2500);
  });

  it('copies audience_ui sample size onto the price test goal', () => {
    const payload = buildPriceTestPayloadFromPlan({
      ...pricePlan,
      metadata: { audience_ui: { minSampleSize: '4000' } },
    });
    assert.equal(payload.goal.min_sample_size, 4000);
  });

  it('copies goal sample size onto the offer test', () => {
    const payload = buildOfferTestPayloadFromPlan({
      ...offerPlan,
      goal: { min_sample_size: 1800 },
    });
    assert.equal(payload.goal.min_sample_size, 1800);
  });

  it('persists sequential analysis as confidence 0.9, not alpha 0.1', () => {
    const payload = buildPriceTestPayloadFromPlan({
      ...pricePlan,
      goal: {
        min_sample_size: 2500,
        analysis_method: 'sequential',
        significance_level: 0.9,
        visitors_per_variant_recommended: 12000,
      },
    });
    assert.equal(payload.goal.analysis_method, 'sequential');
    assert.equal(payload.goal.significance_level, 0.9);
    assert.equal(payload.goal.visitors_per_variant_recommended, 12000);
  });

  it('uses shop 95% confidence and min sample when the plan omits them', () => {
    const payload = buildPriceTestPayloadFromPlan(pricePlan, {
      guardrails: {
        confidence_level: 95,
        mde_percent: 8,
        min_sample_size_per_variation: 2200,
      },
    });
    assert.equal(payload.goal.significance_level, 0.95);
    assert.equal(payload.goal.mde_percent, 8);
    assert.equal(payload.goal.min_sample_size, 2200);
  });
});
