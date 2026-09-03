const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildPriceTestPayloadFromPlan } = require('../planToPriceTestService');
const { buildOfferTestPayloadFromPlan } = require('../planToOfferTestService');

function plan(experimentType) {
  return {
    id: 'plan-1',
    title: 'Hoodie',
    product_id: 'gid://shopify/Product/1',
    current_price: 40,
    currency: 'USD',
    experiment_type: experimentType,
    price_arms: [
      { id: 'control', role: 'control', label: 'Control', price: 40, allocation_percent: 100 },
      {
        id: 'a',
        role: 'challenger',
        label: 'Variation A',
        price: 44,
        allocation_percent: 0,
        offer: { discount_type: 'percent', discount_value: 10 },
      },
    ],
  };
}

describe('Smart Pricing launch allocation validation', () => {
  it('rejects zero-traffic price-test arms', () => {
    assert.throws(() => buildPriceTestPayloadFromPlan(plan('price_test')), /more than 0% traffic/i);
  });

  it('rejects zero-traffic offer-test arms', () => {
    assert.throws(() => buildOfferTestPayloadFromPlan(plan('offer_test')), /more than 0% traffic/i);
  });
});
