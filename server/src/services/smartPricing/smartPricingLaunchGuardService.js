/**
 * Running price test limits for Smart Pricing launch guardrails.
 */

const { getTestsByShop } = require('../../models/test');
const { getShopSmartPricingGuardrails } = require('./smartPricingGuardrailsService');

const PRICE_TEST_TYPES = new Set(['price', 'pricing', 'smart-pricing']);

async function countRunningPriceTests(shopDomain) {
  const running = await getTestsByShop(shopDomain, 'running');
  return running.filter(test =>
    PRICE_TEST_TYPES.has(
      String(test?.type || '')
        .trim()
        .toLowerCase()
    )
  ).length;
}

async function resolveLaunchCapacity(shopDomain, { requestedCount = 1, maxParallel } = {}) {
  const guardrails =
    maxParallel !== undefined && maxParallel !== null
      ? { max_parallel_tests: maxParallel }
      : await getShopSmartPricingGuardrails(shopDomain);
  const max = Math.max(1, Number(guardrails?.max_parallel_tests) || 5);
  const running = await countRunningPriceTests(shopDomain);
  const available = Math.max(0, max - running);
  const requested = Math.max(0, Number(requestedCount) || 0);

  return {
    running_count: running,
    max_parallel: max,
    available_slots: available,
    requested_count: requested,
    launchable_count: requested > 0 ? Math.min(requested, available) : available,
    blocked_count: Math.max(0, requested - available),
    can_launch_all: requested > 0 && requested <= available,
    can_launch_one: available >= 1,
    at_capacity: available === 0,
  };
}

async function assertCanLaunchPriceTests(
  shopDomain,
  { additionalCount = 1, maxParallel = 5 } = {}
) {
  const capacity = await resolveLaunchCapacity(shopDomain, {
    requestedCount: additionalCount,
    maxParallel,
  });
  if (capacity.blocked_count > 0) {
    const running = capacity.running_count;
    const max = capacity.max_parallel;
    const err = new Error(
      `You already have ${running} running price test${running === 1 ? '' : 's'}. Max parallel tests allowed: ${max}.`
    );
    err.isValidation = true;
    err.errors = [err.message];
    err.running_count = running;
    err.max_parallel = max;
    err.capacity = capacity;
    throw err;
  }
  return {
    running_count: capacity.running_count,
    max_parallel: capacity.max_parallel,
    capacity,
  };
}

module.exports = {
  countRunningPriceTests,
  resolveLaunchCapacity,
  assertCanLaunchPriceTests,
};
