const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  supportInternalToken,
  isValidSupportInternalToken,
} = require('../supportInternalAuth');

describe('supportInternalAuth', () => {
  const previous = process.env.SHOPIFY_API_SECRET;

  after(() => {
    if (previous === undefined) delete process.env.SHOPIFY_API_SECRET;
    else process.env.SHOPIFY_API_SECRET = previous;
  });

  it('binds the proof to the shop domain', () => {
    process.env.SHOPIFY_API_SECRET = 'shopify-secret';
    const shopA = supportInternalToken('Demo.myshopify.com');
    const shopB = supportInternalToken('other.myshopify.com');
    assert.equal(typeof shopA, 'string');
    assert.equal(shopA.length > 20, true);
    assert.notEqual(shopA, shopB);
    assert.equal(isValidSupportInternalToken('demo.myshopify.com', shopA), true);
    assert.equal(isValidSupportInternalToken('other.myshopify.com', shopA), false);
    assert.equal(isValidSupportInternalToken('demo.myshopify.com', 'nope'), false);
  });
});
