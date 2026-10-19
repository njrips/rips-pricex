const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  getDevStorefrontPasswordDefault,
  resolveStorefrontPasswordForPreviewRequest,
} = require('../storefrontPasswordPreview');

const saved = {};

beforeEach(() => {
  saved.single = process.env.RIPX_DEV_STOREFRONT_PASSWORD;
  saved.perShop = process.env.RIPX_DEV_STOREFRONT_PASSWORDS;
  process.env.RIPX_DEV_STOREFRONT_PASSWORD = 'shared';
  process.env.RIPX_DEV_STOREFRONT_PASSWORDS =
    'store-a.myshopify.com=alpha, store-b = beta=2 ,broken,=nopass';
});

afterEach(() => {
  for (const [key, value] of [
    ['RIPX_DEV_STOREFRONT_PASSWORD', saved.single],
    ['RIPX_DEV_STOREFRONT_PASSWORDS', saved.perShop],
  ]) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('dev storefront password per shop', () => {
  it("uses the shop's own password", () => {
    assert.equal(getDevStorefrontPasswordDefault('store-a.myshopify.com'), 'alpha');
    assert.equal(getDevStorefrontPasswordDefault('https://STORE-A.myshopify.com/'), 'alpha');
  });

  it('accepts a bare store handle and keeps "=" inside the password', () => {
    assert.equal(getDevStorefrontPasswordDefault('store-b.myshopify.com'), 'beta=2');
  });

  it('falls back to the single password for shops without an entry', () => {
    assert.equal(getDevStorefrontPasswordDefault('other.myshopify.com'), 'shared');
    assert.equal(getDevStorefrontPasswordDefault(''), 'shared');
  });

  it('still prefers a password sent with the request', () => {
    assert.equal(
      resolveStorefrontPasswordForPreviewRequest('typed', 'store-a.myshopify.com'),
      'typed'
    );
    assert.equal(resolveStorefrontPasswordForPreviewRequest('', 'store-a.myshopify.com'), 'alpha');
  });
});
