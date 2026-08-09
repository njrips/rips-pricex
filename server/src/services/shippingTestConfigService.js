/**
 * Slim stub — shipping tests are out of scope for Classic Smart Pricing.
 * abTestEngine still imports these for validateTest; price tests must pass through unchanged.
 */

function isShippingTestPayload(payload = {}) {
  const testType = String(payload?.type || '')
    .trim()
    .toLowerCase();
  if (testType === 'shipping') return true;
  const templateKey = String(payload?.goal?.template_key || '')
    .trim()
    .toLowerCase();
  return templateKey === 'shipping';
}

function normalizeShippingTestPayload(payload = {}) {
  if (!isShippingTestPayload(payload)) {
    return payload;
  }
  // Shipping tests are not supported in RipsPriceX — leave payload as-is for validation to reject.
  return payload;
}

function validateShippingVariants(_variants = []) {
  return ['Shipping tests are not supported in RipsPriceX Classic Smart Pricing.'];
}

module.exports = {
  isShippingTestPayload,
  normalizeShippingTestPayload,
  validateShippingVariants,
};
