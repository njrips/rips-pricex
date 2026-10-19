const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isStorefrontEmbeddedTestType,
  normalizeTestTypeForStorefront,
  mapTestToStorefrontPayload,
  getStorefrontScriptCacheControl,
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

  it('flags tests that target countries so the storefront detects the visitor country', () => {
    assert.equal(mapTestToStorefrontPayload({ id: 't1', type: 'price' }).countryTargeting, false);
    assert.equal(
      mapTestToStorefrontPayload({ id: 't1', type: 'price', segments: { countries: ['US'] } })
        .countryTargeting,
      true
    );
    assert.equal(
      mapTestToStorefrontPayload({
        id: 't1',
        type: 'price',
        segments: { audience_rules: [{ type: 'exclude', field: 'country', value: ['BD'] }] },
      }).countryTargeting,
      true
    );
  });

  it('revalidates every page when merchant global snippets are active', () => {
    assert.equal(
      getStorefrontScriptCacheControl({ hasGlobalCustomAssets: true }),
      'public, max-age=0, must-revalidate'
    );
    assert.match(getStorefrontScriptCacheControl(), /max-age=\d+/);
  });
});
