const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { verifyShopifyIdToken } = require('../shopifyIdToken');

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

function sign(headerPart, payloadPart, secret = SECRET) {
  return crypto
    .createHmac('sha256', secret)
    .update(`${headerPart}.${payloadPart}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function makeToken({ header, payload, secret = SECRET } = {}) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const fullHeader = { alg: 'HS256', typ: 'JWT', ...(header || {}) };
  const fullPayload = {
    iss: `https://${SHOP}/admin`,
    dest: `https://${SHOP}`,
    aud: CLIENT_ID,
    sub: '42',
    exp: nowSeconds + 60,
    nbf: nowSeconds - 5,
    iat: nowSeconds - 5,
    jti: 'f8912129-1af6-4cad-9ca3-76b0f7621087',
    sid: 'session-id',
    ...(payload || {}),
  };
  const headerPart = b64url(JSON.stringify(fullHeader));
  const payloadPart = b64url(JSON.stringify(fullPayload));
  return `${headerPart}.${payloadPart}.${sign(headerPart, payloadPart, secret)}`;
}

function rejectsWith(reason, token, options) {
  assert.throws(
    () => verifyShopifyIdToken(token, options),
    err => {
      assert.equal(err.reason, reason, `expected reason "${reason}", got "${err.reason}"`);
      return true;
    }
  );
}

let previousSecret;
let previousKey;

beforeEach(() => {
  previousSecret = process.env.SHOPIFY_API_SECRET;
  previousKey = process.env.SHOPIFY_API_KEY;
  process.env.SHOPIFY_API_SECRET = SECRET;
  process.env.SHOPIFY_API_KEY = CLIENT_ID;
});

afterEach(() => {
  if (previousSecret === undefined) delete process.env.SHOPIFY_API_SECRET;
  else process.env.SHOPIFY_API_SECRET = previousSecret;
  if (previousKey === undefined) delete process.env.SHOPIFY_API_KEY;
  else process.env.SHOPIFY_API_KEY = previousKey;
});

describe('verifyShopifyIdToken', () => {
  it('accepts a well formed token and reports the shop from dest', () => {
    const payload = verifyShopifyIdToken(makeToken());
    assert.equal(payload.shopDomain, SHOP);
    assert.equal(payload.sub, '42');
    assert.equal(payload.sid, 'session-id');
  });

  it('rejects a token signed with the wrong secret', () => {
    rejectsWith('bad_signature', makeToken({ secret: 'not-the-secret' }));
  });

  it('rejects a token whose payload was altered after signing', () => {
    const token = makeToken();
    const [headerPart, , signaturePart] = token.split('.');
    const tampered = b64url(
      JSON.stringify({
        iss: 'https://attacker.myshopify.com/admin',
        dest: 'https://attacker.myshopify.com',
        aud: CLIENT_ID,
        exp: Math.floor(Date.now() / 1000) + 60,
      })
    );
    rejectsWith('bad_signature', `${headerPart}.${tampered}.${signaturePart}`);
  });

  it('refuses the alg:none downgrade even with a matching payload', () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const headerPart = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
    const payloadPart = b64url(
      JSON.stringify({
        iss: `https://${SHOP}/admin`,
        dest: `https://${SHOP}`,
        aud: CLIENT_ID,
        exp: nowSeconds + 60,
      })
    );
    rejectsWith('bad_algorithm', `${headerPart}.${payloadPart}.`);
  });

  it('rejects an expired token', () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    rejectsWith('expired', makeToken({ payload: { exp: nowSeconds - 120 } }));
  });

  it('rejects a token that is not valid yet', () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    rejectsWith('not_yet_valid', makeToken({ payload: { nbf: nowSeconds + 120 } }));
  });

  it('tolerates small clock skew rather than failing a fresh token', () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const token = makeToken({ payload: { exp: nowSeconds, nbf: nowSeconds + 5 } });
    const payload = verifyShopifyIdToken(token);
    assert.equal(payload.shopDomain, SHOP);
  });

  it('rejects a token minted for a different app', () => {
    rejectsWith('bad_audience', makeToken({ payload: { aud: 'someone-elses-client-id' } }));
  });

  it('rejects a token whose issuer and destination disagree', () => {
    rejectsWith(
      'bad_destination',
      makeToken({ payload: { iss: 'https://attacker.myshopify.com/admin' } })
    );
  });

  it('rejects tokens with an unusable destination', () => {
    rejectsWith('bad_destination', makeToken({ payload: { dest: 'not-a-url' } }));
  });

  it('rejects missing and malformed tokens', () => {
    rejectsWith('missing', '');
    rejectsWith('missing', null);
    rejectsWith('malformed', 'not-a-jwt');
    rejectsWith('malformed', 'only.two');
    rejectsWith('malformed', 'a.b.c');
  });

  it('reports a configuration fault when the client secret is absent', () => {
    delete process.env.SHOPIFY_API_SECRET;
    rejectsWith('not_configured', makeToken());
  });
});
