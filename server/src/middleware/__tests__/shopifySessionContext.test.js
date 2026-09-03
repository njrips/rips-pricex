const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  requireShopifySession,
  BYPASS_ENV,
  RETRY_HEADER,
} = require('../shopifySessionContext');

const SECRET = 'test-client-secret';
const CLIENT_ID = 'test-client-id';
const SHOP = 'example.myshopify.com';

function b64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function makeToken({ shop = SHOP, aud = CLIENT_ID, secret = SECRET } = {}) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const headerPart = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payloadPart = b64url(
    JSON.stringify({
      iss: `https://${shop}/admin`,
      dest: `https://${shop}`,
      aud,
      sub: '42',
      exp: nowSeconds + 60,
      nbf: nowSeconds - 5,
    })
  );
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${headerPart}.${payloadPart}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${headerPart}.${payloadPart}.${signature}`;
}

function makeReq({ token = null, headers = {}, query = {}, body = {} } = {}) {
  const all = { ...headers };
  if (token) all.authorization = `Bearer ${token}`;
  const lower = {};
  for (const [key, value] of Object.entries(all)) lower[key.toLowerCase()] = value;
  return {
    method: 'GET',
    originalUrl: '/api/smart-pricing/status',
    query,
    body,
    get(name) {
      return lower[String(name).toLowerCase()];
    },
  };
}

function makeRes() {
  return {
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
}

function run(req) {
  const res = makeRes();
  let nextCalled = false;
  requireShopifySession(req, res, () => {
    nextCalled = true;
  });
  return { res, nextCalled };
}

let previous;

beforeEach(() => {
  previous = {
    secret: process.env.SHOPIFY_API_SECRET,
    key: process.env.SHOPIFY_API_KEY,
    bypass: process.env[BYPASS_ENV],
  };
  process.env.SHOPIFY_API_SECRET = SECRET;
  process.env.SHOPIFY_API_KEY = CLIENT_ID;
  delete process.env[BYPASS_ENV];
});

afterEach(() => {
  for (const [name, value] of [
    ['SHOPIFY_API_SECRET', previous.secret],
    ['SHOPIFY_API_KEY', previous.key],
    [BYPASS_ENV, previous.bypass],
  ]) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('requireShopifySession', () => {
  it('derives the shop from the verified token, not the client header', () => {
    const req = makeReq({
      token: makeToken(),
      headers: { 'X-Shopify-Shop-Domain': SHOP },
    });
    const { res, nextCalled } = run(req);

    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, null);
    assert.equal(req.shopDomain, SHOP);
    assert.equal(req.shopSessionVerified, true);
  });

  it('rejects a request that only claims a shop domain', () => {
    const req = makeReq({ query: { shop: 'victim.myshopify.com' } });
    const { res, nextCalled } = run(req);

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    // Without the retry header App Bridge would not re-issue a token.
    assert.equal(res.headers[RETRY_HEADER], '1');
  });

  it('rejects a forged token and asks App Bridge to retry', () => {
    const req = makeReq({ token: makeToken({ secret: 'wrong-secret' }) });
    const { res, nextCalled } = run(req);

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.headers[RETRY_HEADER], '1');
  });

  it('refuses to act on a different shop than the token authenticates', () => {
    const req = makeReq({
      token: makeToken({ shop: 'attacker.myshopify.com' }),
      query: { shop: 'victim.myshopify.com' },
    });
    const { res, nextCalled } = run(req);

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
  });

  it('reports a configuration fault rather than letting requests through', () => {
    delete process.env.SHOPIFY_API_SECRET;
    const req = makeReq({ token: makeToken() });
    const { res, nextCalled } = run(req);

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 503);
  });

  it('allows an unverified claimed shop only when the bypass flag is set', () => {
    process.env[BYPASS_ENV] = 'true';
    const req = makeReq({ query: { shop: SHOP } });
    const { res, nextCalled } = run(req);

    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, null);
    assert.equal(req.shopDomain, SHOP);
    assert.equal(req.shopSessionVerified, false);
  });

  it('still requires a shop when the bypass flag is set', () => {
    process.env[BYPASS_ENV] = 'true';
    const { res, nextCalled } = run(makeReq());

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
  });

  it('verifies the token even when the bypass flag is set', () => {
    process.env[BYPASS_ENV] = 'true';
    const req = makeReq({ token: makeToken({ secret: 'wrong-secret' }) });
    const { res, nextCalled } = run(req);

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
  });

  it('carries an access token through for install sync flows', () => {
    const req = makeReq({
      token: makeToken(),
      headers: { 'X-Shopify-Access-Token': 'shpat_example' },
    });
    const { nextCalled } = run(req);

    assert.equal(nextCalled, true);
    assert.equal(req.shopifyAccessToken, 'shpat_example');
  });
});
