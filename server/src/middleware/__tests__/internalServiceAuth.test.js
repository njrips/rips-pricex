const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  INTERNAL_HEADER,
  internalServiceToken,
  isValidInternalServiceToken,
} = require('../../services/internalServiceAuth');
const { requireShopSessionOrInternal } = require('../shopifySessionContext');

const SECRET = 'test-client-secret';
const SHOP = 'example.myshopify.com';

function makeReq({ headers = {}, query = {}, body = {} } = {}) {
  const lower = {};
  for (const [key, value] of Object.entries(headers)) lower[key.toLowerCase()] = value;
  return {
    method: 'POST',
    originalUrl: '/api/shops/install',
    query,
    body,
    get(name) {
      return lower[String(name).toLowerCase()];
    },
  };
}

function run(req) {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  let nextCalled = false;
  requireShopSessionOrInternal(req, res, () => {
    nextCalled = true;
  });
  return { res, nextCalled };
}

let previous;

beforeEach(() => {
  previous = {
    secret: process.env.SHOPIFY_API_SECRET,
    key: process.env.SHOPIFY_API_KEY,
    bypass: process.env.RIPSPRICEX_ALLOW_UNVERIFIED_API,
  };
  process.env.SHOPIFY_API_SECRET = SECRET;
  process.env.SHOPIFY_API_KEY = 'test-client-id';
  delete process.env.RIPSPRICEX_ALLOW_UNVERIFIED_API;
});

afterEach(() => {
  for (const [name, value] of [
    ['SHOPIFY_API_SECRET', previous.secret],
    ['SHOPIFY_API_KEY', previous.key],
    ['RIPSPRICEX_ALLOW_UNVERIFIED_API', previous.bypass],
  ]) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('internalServiceToken', () => {
  it('is stable for a shop and differs between shops', () => {
    const a = internalServiceToken(SHOP);
    assert.equal(a, internalServiceToken(SHOP));
    assert.notEqual(a, internalServiceToken('other.myshopify.com'));
  });

  it('normalizes the shop so scheme and case cannot forge a mismatch', () => {
    assert.equal(internalServiceToken(`https://${SHOP.toUpperCase()}/`), internalServiceToken(SHOP));
  });

  it('produces nothing without a configured secret', () => {
    delete process.env.SHOPIFY_API_SECRET;
    assert.equal(internalServiceToken(SHOP), '');
    assert.equal(isValidInternalServiceToken(SHOP, 'anything'), false);
  });

  it('rejects a token minted for a different shop', () => {
    assert.equal(isValidInternalServiceToken(SHOP, internalServiceToken('other.myshopify.com')), false);
  });
});

describe('requireShopSessionOrInternal', () => {
  it('accepts our own server when it signs the shop domain', () => {
    const req = makeReq({
      query: { shop: SHOP },
      headers: { [INTERNAL_HEADER]: internalServiceToken(SHOP) },
    });
    const { res, nextCalled } = run(req);

    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, null);
    assert.equal(req.shopDomain, SHOP);
    assert.equal(req.internalServiceCall, true);
  });

  it('rejects a caller that only names a shop', () => {
    const { res, nextCalled } = run(makeReq({ query: { shop: SHOP } }));

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
  });

  it('rejects a forged internal proof', () => {
    const req = makeReq({
      query: { shop: SHOP },
      headers: { [INTERNAL_HEADER]: 'deadbeef'.repeat(8) },
    });
    const { res, nextCalled } = run(req);

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
  });

  it('rejects a valid proof replayed against a different shop', () => {
    const req = makeReq({
      query: { shop: 'victim.myshopify.com' },
      headers: { [INTERNAL_HEADER]: internalServiceToken(SHOP) },
    });
    const { res, nextCalled } = run(req);

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
  });

  it('carries the access token through for install sync', () => {
    const req = makeReq({
      query: { shop: SHOP },
      headers: { [INTERNAL_HEADER]: internalServiceToken(SHOP) },
      body: { access_token: 'shpat_example' },
    });
    const { nextCalled } = run(req);

    assert.equal(nextCalled, true);
    assert.equal(req.shopifyAccessToken, 'shpat_example');
  });
});
