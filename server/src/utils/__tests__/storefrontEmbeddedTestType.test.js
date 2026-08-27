const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isStorefrontEmbeddedTestType,
  normalizeTestTypeForStorefront,
  mapTestToStorefrontPayload,
} = require('../storefrontScriptRuntime');

describe('storefront embedded test types', () => {
  it('embeds price, offer, and shipping tests in the storefront script', () => {
    assert.equal(isStorefrontEmbeddedTestType('price'), true);
    assert.equal(isStorefrontEmbeddedTestType('pricing'), true);
    assert.equal(isStorefrontEmbeddedTestType('offer'), true);
    assert.equal(isStorefrontEmbeddedTestType('offer_test'), true);
    assert.equal(isStorefrontEmbeddedTestType('shipping'), true);
    assert.equal(isStorefrontEmbeddedTestType('theme'), false);
    assert.equal(isStorefrontEmbeddedTestType('ab'), false);
  });

  it('normalizes offer_test to offer in the browser payload', () => {
    assert.equal(normalizeTestTypeForStorefront('offer_test'), 'offer');
    assert.equal(mapTestToStorefrontPayload({ id: 't1', type: 'offer_test' }).type, 'offer');
  });
});
