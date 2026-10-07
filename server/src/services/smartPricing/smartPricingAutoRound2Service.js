/**
 * Optional auto-queue of follow-up learning rounds after winner apply.
 * Honours SMART_PRICING_AUTO_ROUND2 env, plan.launch_preferences.auto_round2,
 * and shop guardrails.auto_round2_default.
 */

const {
  maybeAutoQueueFollowUpPlan,
} = require('./smartPricingProductLifecycleService');

async function maybeAutoQueueRound2Plan(shopDomain, planId) {
  return maybeAutoQueueFollowUpPlan(shopDomain, planId);
}

module.exports = {
  maybeAutoQueueRound2Plan,
};
