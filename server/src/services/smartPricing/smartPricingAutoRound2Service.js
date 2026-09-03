/**
 * Optional auto-queue of follow-up learning rounds after winner apply.
 * Honours SMART_PRICING_AUTO_ROUND2 env, plan.launch_preferences.auto_round2,
 * and shop guardrails.auto_round2_default.
 */

const {
  maybeAutoQueueFollowUpPlan,
  inferFollowUpBasePrice,
  shouldAutoQueueFollowUp,
} = require('./smartPricingProductLifecycleService');

function isAutoRound2Enabled() {
  return (
    String(process.env.SMART_PRICING_AUTO_ROUND2 || '')
      .trim()
      .toLowerCase() === 'true'
  );
}

/** @deprecated Prefer inferFollowUpBasePrice — kept for existing callers/tests. */
function inferRound2BasePrice(plan = {}) {
  return inferFollowUpBasePrice(plan);
}

async function maybeAutoQueueRound2Plan(shopDomain, planId) {
  return maybeAutoQueueFollowUpPlan(shopDomain, planId);
}

module.exports = {
  isAutoRound2Enabled,
  inferRound2BasePrice,
  maybeAutoQueueRound2Plan,
  shouldAutoQueueFollowUp,
};
