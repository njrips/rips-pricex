/**
 * Slim stub — Checkout Experience tests are out of scope for Classic Smart Pricing.
 */

function normalizeCheckoutPhase(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase() || null;
}

function normalizeCheckoutExperienceConfig(config = {}) {
  return config && typeof config === 'object' ? { ...config } : {};
}

function validateCheckoutExperienceConfig(_config = {}, _opts = {}) {
  return {
    isValid: false,
    errors: ['Checkout experience tests are not supported in Priceify Classic Smart Pricing.'],
  };
}

module.exports = {
  normalizeCheckoutPhase,
  normalizeCheckoutExperienceConfig,
  validateCheckoutExperienceConfig,
};
