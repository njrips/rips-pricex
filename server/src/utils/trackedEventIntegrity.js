/**
 * Sanity checks on the events the storefront reports.
 *
 * These arrive on open endpoints and always will: the storefront script runs on
 * a public page, so it cannot hold a secret, and a shopper's browser is the only
 * thing that knows a purchase happened. So nothing here can make a reported
 * event trustworthy. What it can do is refuse the two shapes that are either
 * clearly forged or clearly impossible, and keep one bad post from deciding a
 * test on its own.
 *
 * The authoritative fix is to take conversions from Shopify's order webhooks
 * rather than from the browser. That is a feature, not a guard, and it is not
 * built yet.
 */

const { verifyPriceAssignmentSignature } = require('./priceAssignmentSignature');

/**
 * The largest value one tracked event may carry.
 *
 * Analytics sums `event_value` into revenue per visitor, which is what decides
 * winners, and nothing downstream re-checks the total. The previous coercion
 * was `Number(x) || 0`, which accepted `Infinity` and `1e308` — either of them
 * enough to settle any test forever.
 */
const MAX_EVENT_VALUE = 1000000;

/** More live tests than one shop runs, so a real page is never truncated. */
const MAX_BATCH_TEST_IDS = 100;

/**
 * Coerces a tracked event's value, refusing what cannot be revenue.
 *
 * @param {unknown} raw
 * @returns {number} a finite, non-negative amount within the ceiling
 */
function normalizeEventValue(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(value, MAX_EVENT_VALUE);
}

/**
 * Says why a tracked event's assignment proof should be refused, if it should.
 *
 * Only a proof that is present and wrong is refused. A missing one passes,
 * because the alternative is dropping every conversion from a browser still
 * running a cached copy of an older script, and losing a shop's conversion
 * history is worse than storing a row nobody vouched for. So this catches
 * tampering with a real assignment, not the absence of one.
 *
 * @param {string} shop
 * @param {Record<string, any>} body
 * @returns {string|null} the reason to refuse, or null to accept
 */
function assignmentProofFailure(shop, body) {
  const signature = String(body?.assignment_sig || body?.assignmentSig || '').trim();
  // `unsigned:<ts>` is what the server itself stamps on when no signing secret
  // is configured, so it is a marker rather than a claim, and refusing it would
  // reject the shop's own traffic.
  if (!signature || signature.startsWith('unsigned:')) {
    return null;
  }
  const verdict = verifyPriceAssignmentSignature({
    testId: body.test_id || body.testId,
    variantId: body.variant_id || body.variantId,
    userId: body.assignment_user || body.assignmentUser || body.user_id || body.userId,
    shopDomain: shop,
    signature,
    issuedAtMs: body.assignment_ts || body.assignmentTs,
  });
  return verdict.ok ? null : verdict.reason || 'invalid_assignment_signature';
}

module.exports = {
  normalizeEventValue,
  assignmentProofFailure,
  MAX_EVENT_VALUE,
  MAX_BATCH_TEST_IDS,
};
