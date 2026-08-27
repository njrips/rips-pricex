const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { requireSupportInternal } = require('../supportInternalContext');
const { SUPPORT_INTERNAL_HEADER, supportInternalToken } = require('../../services/support/supportInternalAuth');

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe('requireSupportInternal', () => {
  const previous = process.env.SHOPIFY_API_SECRET;

  after(() => {
    if (previous === undefined) delete process.env.SHOPIFY_API_SECRET;
    else process.env.SHOPIFY_API_SECRET = previous;
  });

  it('returns 503 when the API secret is not configured', () => {
    delete process.env.SHOPIFY_API_SECRET;
    const res = mockRes();
    let nextCalled = false;
    requireSupportInternal({ shopDomain: 'demo.myshopify.com', get: () => '' }, res, () => {
      nextCalled = true;
    });
    assert.equal(res.statusCode, 503);
    assert.equal(nextCalled, false);
  });

  it('returns 401 without a matching shop proof', () => {
    process.env.SHOPIFY_API_SECRET = 'shopify-secret';
    const res = mockRes();
    requireSupportInternal({ shopDomain: 'demo.myshopify.com', get: () => '' }, res, () => {});
    assert.equal(res.statusCode, 401);
  });

  it('calls next with a matching shop proof', () => {
    process.env.SHOPIFY_API_SECRET = 'shopify-secret';
    const shop = 'demo.myshopify.com';
    const res = mockRes();
    let nextCalled = false;
    requireSupportInternal(
      {
        shopDomain: shop,
        get(name) {
          return name === SUPPORT_INTERNAL_HEADER ? supportInternalToken(shop) : '';
        },
      },
      res,
      () => {
        nextCalled = true;
      }
    );
    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, 200);
  });
});
