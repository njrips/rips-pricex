const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  descriptionLooksLikeSmartPricing,
  isSmartPricingTest,
  isPriceLikeTestType,
} = require('../smartPricingTestIdentity');

describe('smartPricingTestIdentity', () => {
  it('recognizes launch name and description when tests.metadata is missing', () => {
    assert.equal(
      descriptionLooksLikeSmartPricing({ name: 'Smart Pricing · Hoodie', description: '' }),
      true
    );
    assert.equal(
      descriptionLooksLikeSmartPricing({
        name: 'Price test',
        description: 'Created from Smart Pricing plan SP-1',
      }),
      true
    );
    assert.equal(
      descriptionLooksLikeSmartPricing({
        name: 'Price test',
        description: 'Created from Smart Pricing offer plan SP-9',
      }),
      true
    );
    assert.equal(descriptionLooksLikeSmartPricing({ name: 'Price test', description: '' }), false);
  });

  it('treats metadata, name, or description as Smart Pricing', () => {
    assert.equal(isSmartPricingTest({ metadata: { smart_pricing_plan_id: 'SP-1' } }), true);
    assert.equal(
      isSmartPricingTest({ metadata: { smart_pricing_source: 'smart_pricing' } }),
      true
    );
    assert.equal(isSmartPricingTest({ name: 'Smart Pricing · Hoodie' }), true);
    assert.equal(isSmartPricingTest({ type: 'price', metadata: {} }), false);
  });

  it('only treats price/pricing as catalog-writable types', () => {
    assert.equal(isPriceLikeTestType('price'), true);
    assert.equal(isPriceLikeTestType('pricing'), true);
    assert.equal(isPriceLikeTestType('offer'), false);
  });
});
