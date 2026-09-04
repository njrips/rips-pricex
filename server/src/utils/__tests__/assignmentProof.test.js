const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { withAssignmentProof, signAssignedVariants } = require('../assignmentProof');
const { verifyPriceAssignmentSignature } = require('../priceAssignmentSignature');

const SECRET_ENV = 'RIPX_PRICE_ASSIGNMENT_SIGNATURE_SECRET';
const SHOP = 'example.myshopify.com';
const USER = 'ripx_user_1';

let previousSecret;

beforeEach(() => {
  previousSecret = process.env[SECRET_ENV];
  process.env[SECRET_ENV] = 'assignment-signing-secret';
});

afterEach(() => {
  if (previousSecret === undefined) delete process.env[SECRET_ENV];
  else process.env[SECRET_ENV] = previousSecret;
});

describe('withAssignmentProof', () => {
  // Without these three fields the Cart Transform skips the line, so the
  // shopper sees the test price on the page and pays the catalog price.
  it('stamps the fields the checkout functions require', () => {
    const out = withAssignmentProof(
      { id: 'arm-1', name: 'Variation A' },
      { testId: 'test-1', userId: USER, shopDomain: SHOP }
    );

    assert.ok(out.assignment_sig);
    assert.ok(out.assignment_ts);
    assert.equal(out.assignment_user, USER);
    assert.equal(out.name, 'Variation A');
  });

  it('signs the arm so the signature verifies against the same assignment', () => {
    const out = withAssignmentProof(
      { id: 'arm-1' },
      { testId: 'test-1', userId: USER, shopDomain: SHOP }
    );

    const result = verifyPriceAssignmentSignature({
      testId: 'test-1',
      variantId: 'arm-1',
      userId: out.assignment_user,
      shopDomain: SHOP,
      signature: out.assignment_sig,
      issuedAtMs: out.assignment_ts,
    });
    assert.equal(result.ok, true);
  });

  it('does not verify against a different arm of the same test', () => {
    const out = withAssignmentProof(
      { id: 'arm-1' },
      { testId: 'test-1', userId: USER, shopDomain: SHOP }
    );

    const result = verifyPriceAssignmentSignature({
      testId: 'test-1',
      variantId: 'arm-2',
      userId: out.assignment_user,
      shopDomain: SHOP,
      signature: out.assignment_sig,
      issuedAtMs: out.assignment_ts,
    });
    assert.equal(result.ok, false);
  });

  it('does not verify against a different shop', () => {
    const out = withAssignmentProof(
      { id: 'arm-1' },
      { testId: 'test-1', userId: USER, shopDomain: SHOP }
    );

    const result = verifyPriceAssignmentSignature({
      testId: 'test-1',
      variantId: 'arm-1',
      userId: out.assignment_user,
      shopDomain: 'victim.myshopify.com',
      signature: out.assignment_sig,
      issuedAtMs: out.assignment_ts,
    });
    assert.equal(result.ok, false);
  });

  // The secret is optional hardening, and price tests have to keep working
  // without it — but the marker must not read as a verified signature.
  it('marks the proof as unsigned when no secret is configured', () => {
    delete process.env[SECRET_ENV];
    const out = withAssignmentProof(
      { id: 'arm-1' },
      { testId: 'test-1', userId: USER, shopDomain: SHOP }
    );

    assert.match(out.assignment_sig, /^unsigned:/);
    assert.equal(out.assignment_user, USER);
  });

  it('leaves an arm with no id alone rather than signing an empty assignment', () => {
    const variant = { name: 'Control' };
    assert.deepEqual(
      withAssignmentProof(variant, { testId: 'test-1', userId: USER, shopDomain: SHOP }),
      variant
    );
  });

  it('passes a missing assignment through', () => {
    assert.equal(
      withAssignmentProof(null, { testId: 'test-1', userId: USER, shopDomain: SHOP }),
      null
    );
  });
});

describe('signAssignedVariants', () => {
  it('signs each test with its own id, so one arm cannot be replayed onto another test', () => {
    const signed = signAssignedVariants(
      { 'test-1': { id: 'arm-1' }, 'test-2': { id: 'arm-1' } },
      { userId: USER, shopDomain: SHOP }
    );

    assert.notEqual(signed['test-1'].assignment_sig, signed['test-2'].assignment_sig);
    for (const testId of ['test-1', 'test-2']) {
      const out = signed[testId];
      assert.equal(
        verifyPriceAssignmentSignature({
          testId,
          variantId: 'arm-1',
          userId: out.assignment_user,
          shopDomain: SHOP,
          signature: out.assignment_sig,
          issuedAtMs: out.assignment_ts,
        }).ok,
        true
      );
    }
  });

  it('keeps a null assignment null instead of inventing one', () => {
    const signed = signAssignedVariants(
      { 'test-1': null },
      { userId: USER, shopDomain: SHOP }
    );
    assert.equal(signed['test-1'], null);
  });

  it('passes an empty batch through', () => {
    assert.deepEqual(signAssignedVariants({}, { userId: USER, shopDomain: SHOP }), {});
  });
});
