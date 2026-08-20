/**
 * Running Smart Pricing test counts for launch capacity.
 * Parallel launch is not capped — merchants can start as many tests as they need.
 */

const { getTestsByShop } = require('../../models/test');

const PRICE_TEST_TYPES = new Set(['price', 'pricing', 'smart-pricing', 'offer', 'offer_test']);

function isPreviewOnlyTest(test) {
  const meta = test?.metadata && typeof test.metadata === 'object' ? test.metadata : {};
  if (meta.smart_pricing_experiment_preview === true) return true;
  return /^Smart Pricing Preview\b/i.test(String(test?.name || ''));
}

function isCountableRunningTest(test) {
  if (isPreviewOnlyTest(test)) return false;
  return PRICE_TEST_TYPES.has(
    String(test?.type || '')
      .trim()
      .toLowerCase()
  );
}

async function countRunningPriceTests(shopDomain) {
  const running = await getTestsByShop(shopDomain, 'running');
  return (Array.isArray(running) ? running : []).filter(isCountableRunningTest).length;
}

async function resolveLaunchCapacity(shopDomain, { requestedCount = 1 } = {}) {
  const running = await countRunningPriceTests(shopDomain);
  const requested = Math.max(0, Number(requestedCount) || 0);

  return {
    running_count: running,
    max_parallel: null,
    unlimited: true,
    available_slots: null,
    requested_count: requested,
    launchable_count: requested,
    blocked_count: 0,
    can_launch_all: true,
    can_launch_one: true,
    can_launch: true,
    slots_remaining: null,
    at_capacity: false,
  };
}

async function assertCanLaunchPriceTests(_shopDomain, _opts = {}) {
  return {
    running_count: null,
    max_parallel: null,
    capacity: {
      unlimited: true,
      can_launch: true,
      can_launch_all: true,
      can_launch_one: true,
      at_capacity: false,
      blocked_count: 0,
    },
  };
}

module.exports = {
  countRunningPriceTests,
  resolveLaunchCapacity,
  assertCanLaunchPriceTests,
  isPreviewOnlyTest,
};
