/**
 * Smart Pricing tests usually have no tests.metadata column.
 * Identify them from inbox linkage, launch name, or description.
 */

function descriptionLooksLikeSmartPricing(test = {}) {
  const description = String(test.description || '');
  const name = String(test.name || '');
  return (
    /Created from Smart Pricing(?: offer)? plan/i.test(description) ||
    /^Smart Pricing\s*·/i.test(name) ||
    /smart[_ ]pricing/i.test(description)
  );
}

function isSmartPricingTest(test = {}) {
  const metadata = test.metadata && typeof test.metadata === 'object' ? test.metadata : {};
  return (
    metadata.smart_pricing_source === 'smart_pricing' ||
    Boolean(metadata.smart_pricing_plan_id) ||
    descriptionLooksLikeSmartPricing(test)
  );
}

function isPriceLikeTestType(type) {
  const t = String(type || '')
    .trim()
    .toLowerCase();
  return t === 'price' || t === 'pricing';
}

module.exports = {
  descriptionLooksLikeSmartPricing,
  isSmartPricingTest,
  isPriceLikeTestType,
};
