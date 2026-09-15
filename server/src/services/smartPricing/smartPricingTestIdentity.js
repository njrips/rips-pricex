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

/**
 * Test types that decide what a shopper pays, and therefore compete for a
 * product.
 *
 * Offer tests belong here with price tests. An offer discounts the product at
 * checkout, so a product carrying both is shown one test's price and charged
 * another test's discount on top of it -- and both tests then count the order.
 *
 * Both spellings of the offer type are listed. The plan builder writes
 * `offer`, but `offer_test` is the wizard's name for the same thing and it
 * reaches `tests.type` by other routes; the storefront runtime and the
 * analytics service already accept either. This set lived in two files that
 * had drifted apart, and the copy the enrollment guard used was the one
 * missing `offer_test` -- so a test stored under that name held no product at
 * all, and a second test could be launched straight over the top of it.
 */
const PRICING_TEST_TYPES = new Set(['price', 'pricing', 'smart-pricing', 'offer', 'offer_test']);

/** Whether this test competes with others for the products it names. */
function isPricingTestType(type) {
  return PRICING_TEST_TYPES.has(
    String(type || '')
      .trim()
      .toLowerCase()
  );
}

module.exports = {
  descriptionLooksLikeSmartPricing,
  isSmartPricingTest,
  isPriceLikeTestType,
  isPricingTestType,
  PRICING_TEST_TYPES,
};
