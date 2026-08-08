const CHECKOUT_PHASES = Object.freeze(['experience', 'payment_method', 'delivery_method']);

function normalizeCheckoutPhaseValue(rawValue) {
  const value = String(rawValue || 'experience')
    .trim()
    .toLowerCase();
  return CHECKOUT_PHASES.includes(value) ? value : 'experience';
}

function getCheckoutPhaseFromTest(test = {}) {
  return normalizeCheckoutPhaseValue(test?.goal?.checkout_phase);
}

module.exports = {
  CHECKOUT_PHASES,
  getCheckoutPhaseFromTest,
  normalizeCheckoutPhaseValue,
};
