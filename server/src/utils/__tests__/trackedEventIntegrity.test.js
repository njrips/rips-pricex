const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { normalizeEventValue, assignmentProofFailure } = require('../trackedEventIntegrity');
const { signPriceAssignment } = require('../priceAssignmentSignature');

const SHOP = 'demo.myshopify.com';
const SECRET = 'test-assignment-secret';

describe('normalizeEventValue', () => {
  it('keeps a real order total', () => {
    assert.equal(normalizeEventValue(49.99), 49.99);
    assert.equal(normalizeEventValue('149.50'), 149.5);
  });

  it('refuses what cannot be revenue', () => {
    // `Number(x) || 0` let all of these through into a sum that decides winners.
    assert.equal(normalizeEventValue(Infinity), 0);
    assert.equal(normalizeEventValue(-Infinity), 0);
    assert.equal(normalizeEventValue(NaN), 0);
    assert.equal(normalizeEventValue('not a number'), 0);
    assert.equal(normalizeEventValue(-100), 0);
    assert.equal(normalizeEventValue(null), 0);
    assert.equal(normalizeEventValue(undefined), 0);
  });

  it('caps a single event so one post cannot outweigh a shop', () => {
    assert.equal(normalizeEventValue(1e308), 1000000);
    assert.equal(normalizeEventValue(999999999), 1000000);
  });
});

describe('assignmentProofFailure', () => {
  const originalSecret = process.env.RIPX_PRICE_ASSIGNMENT_SIGNATURE_SECRET;

  before(() => {
    process.env.RIPX_PRICE_ASSIGNMENT_SIGNATURE_SECRET = SECRET;
  });

  after(() => {
    if (originalSecret === undefined) {
      delete process.env.RIPX_PRICE_ASSIGNMENT_SIGNATURE_SECRET;
    } else {
      process.env.RIPX_PRICE_ASSIGNMENT_SIGNATURE_SECRET = originalSecret;
    }
  });

  function signedBody(overrides = {}) {
    const issuedAtMs = Date.now();
    const base = {
      test_id: 'test-1',
      variant_id: 'v-up',
      user_id: 'visitor-1',
      assignment_ts: String(issuedAtMs),
      assignment_user: 'visitor-1',
    };
    const body = { ...base, ...overrides };
    return {
      ...body,
      assignment_sig: signPriceAssignment({
        testId: body.test_id,
        variantId: body.variant_id,
        userId: body.assignment_user,
        shopDomain: SHOP,
        issuedAtMs: Number(body.assignment_ts),
      }),
      ...(overrides.assignment_sig ? { assignment_sig: overrides.assignment_sig } : {}),
    };
  }

  it('accepts an event carrying the proof the server issued', () => {
    assert.equal(assignmentProofFailure(SHOP, signedBody()), null);
  });

  it('refuses an event whose arm was swapped after signing', () => {
    // The whole attack: take a real assignment and re-point it at the arm you
    // want credited.
    const body = signedBody();
    body.variant_id = 'v-control';
    assert.equal(assignmentProofFailure(SHOP, body), 'invalid_assignment_signature');
  });

  it('refuses a proof minted for another shop', () => {
    assert.equal(
      assignmentProofFailure('other.myshopify.com', signedBody()),
      'invalid_assignment_signature'
    );
  });

  it('refuses an invented signature', () => {
    const body = signedBody({ assignment_sig: 'a'.repeat(64) });
    assert.equal(assignmentProofFailure(SHOP, body), 'invalid_assignment_signature');
  });

  it('accepts an event with no proof at all', () => {
    // A browser running a cached older script sends none. Dropping those would
    // lose the shop's conversion history, which is worse than an unvouched row.
    assert.equal(assignmentProofFailure(SHOP, { test_id: 'test-1', variant_id: 'v-up' }), null);
  });

  it('accepts the marker the server stamps when signing is not configured', () => {
    assert.equal(
      assignmentProofFailure(SHOP, {
        test_id: 'test-1',
        variant_id: 'v-up',
        assignment_sig: `unsigned:${Date.now()}`,
      }),
      null
    );
  });

  it('refuses a proof that has outlived its window', () => {
    const longAgo = Date.now() - 400 * 24 * 60 * 60 * 1000;
    const body = {
      test_id: 'test-1',
      variant_id: 'v-up',
      assignment_user: 'visitor-1',
      assignment_ts: String(longAgo),
      assignment_sig: signPriceAssignment({
        testId: 'test-1',
        variantId: 'v-up',
        userId: 'visitor-1',
        shopDomain: SHOP,
        issuedAtMs: longAgo,
      }),
    };
    assert.equal(assignmentProofFailure(SHOP, body), 'assignment_signature_expired');
  });
});
