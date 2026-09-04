/**
 * Stamps a storefront assignment with the proof the checkout functions look for.
 *
 * The storefront only writes `_ripx_assignment_*` cart line properties when the
 * assignment it received carries them, and the Cart Transform refuses any line
 * that arrives without them. So an assignment served without these fields is an
 * assignment that shows a test price on the page and charges the catalog price
 * at checkout.
 *
 * Signing belongs here, on the response to a real assignment request, because
 * the arm has to be the one the engine chose. That is what separates an
 * assignment from a shopper naming the cheapest arm themselves.
 */

const { signPriceAssignment } = require('./priceAssignmentSignature');

/**
 * @param {Record<string, unknown> | null | undefined} variant
 * @param {{ testId: string, userId: string, shopDomain: string, issuedAtMs?: number }} context
 */
function withAssignmentProof(variant, { testId, userId, shopDomain, issuedAtMs = Date.now() }) {
  if (!variant || typeof variant !== 'object') {
    return variant;
  }
  const variantId = variant.id === undefined || variant.id === null ? '' : String(variant.id).trim();
  if (!variantId) {
    return variant;
  }
  const sig = signPriceAssignment({ testId, variantId, userId, shopDomain, issuedAtMs });
  return {
    ...variant,
    // The HMAC is optional hardening: the assignment secret may be unset, and
    // the checkout functions can only check that these fields are present
    // anyway. So an unsigned assignment still carries a marker and still
    // reaches checkout — withholding it would disable price tests on every shop
    // that never configured a secret. `unsigned:` names it for what it is, so
    // nothing downstream mistakes it for verified.
    assignment_sig: sig || `unsigned:${issuedAtMs}`,
    assignment_ts: String(issuedAtMs),
    assignment_user: String(userId),
  };
}

/** Signs every arm the engine assigned in a batch response. */
function signAssignedVariants(variants, { userId, shopDomain }) {
  if (!variants || typeof variants !== 'object') {
    return variants;
  }
  const issuedAtMs = Date.now();
  const out = {};
  for (const [testId, variant] of Object.entries(variants)) {
    out[testId] = withAssignmentProof(variant, { testId, userId, shopDomain, issuedAtMs });
  }
  return out;
}

module.exports = {
  withAssignmentProof,
  signAssignedVariants,
};
