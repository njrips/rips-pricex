/**
 * Optional auto-queue of Round 2 plans after winner apply (SMART_PRICING_AUTO_ROUND2=true).
 */

const { listInboxPlans, saveInboxPlans } = require('../../models/smartPricingInboxStore');
const { buildSmartPricingTestPlan } = require('./testPlanService');
const { getShopSmartPricingGuardrails } = require('./smartPricingGuardrailsService');

function isAutoRound2Enabled() {
  return (
    String(process.env.SMART_PRICING_AUTO_ROUND2 || '')
      .trim()
      .toLowerCase() === 'true'
  );
}

function inferRound2BasePrice(plan = {}) {
  const learningRound2 = Array.isArray(plan.learning_path)
    ? plan.learning_path.find(row => row.round === 2)
    : null;
  const previewPrices = learningRound2?.candidate_arms_preview;
  if (Array.isArray(previewPrices) && previewPrices.length > 0) {
    const mid = previewPrices[Math.floor(previewPrices.length / 2)];
    if (Number.isFinite(Number(mid))) {
      return Number(mid);
    }
  }

  const arms = Array.isArray(plan.price_arms) ? plan.price_arms : [];
  const nonControl = arms.filter(arm => arm.role !== 'control');
  const pool = nonControl.length ? nonControl : arms;
  if (!pool.length) {
    return Number(plan.current_price) || 0;
  }
  return pool.reduce((best, arm) => (Number(arm.price) > Number(best.price) ? arm : best), pool[0])
    .price;
}

async function maybeAutoQueueRound2Plan(shopDomain, planId) {
  if (!isAutoRound2Enabled()) {
    return { queued: false, reason: 'disabled' };
  }
  const id = String(planId || '').trim();
  if (!id) {
    return { queued: false, reason: 'missing_plan_id' };
  }

  const stored = await listInboxPlans(shopDomain);
  const plan = (stored.plans || []).find(row => row.id === id);
  if (!plan) {
    return { queued: false, reason: 'plan_not_found' };
  }
  if (plan.status !== 'applied') {
    return { queued: false, reason: 'plan_not_applied' };
  }
  if (plan.learning_round === 2) {
    return { queued: false, reason: 'already_round_2' };
  }

  const existingRound2 = (stored.plans || []).find(
    row => row.parent_plan_id === id && row.learning_round === 2
  );
  if (existingRound2) {
    return { queued: false, reason: 'round_2_exists', round2_plan_id: existingRound2.id };
  }

  const guardrails = await getShopSmartPricingGuardrails(shopDomain).catch(() => ({}));
  const round2Base = inferRound2BasePrice(plan);
  const statsInput = plan.statistical_design || {};
  const rebuilt = buildSmartPricingTestPlan({
    shopDomain,
    productId: plan.product_id,
    variantId: plan.variant_id,
    title: `${plan.title} · Round 2`,
    currentPrice: round2Base,
    currency: plan.currency,
    scenarioPreset: 'conservative',
    variantCount: 2,
    dailyVisitors: plan.daily_visitors,
    baselineConversionRate: statsInput.baseline_conversion_rate,
    baselinePpv: statsInput.baseline_ppv,
    mdePercent: statsInput.mde_percent,
    confidenceLevel: statsInput.confidence_level,
    power: statsInput.statistical_power,
    guardrails,
    imageUrl: plan.image_url,
  });

  const round2Plan = {
    ...rebuilt,
    status: 'queued',
    parent_plan_id: plan.id,
    learning_round: 2,
    image_url: plan.image_url || rebuilt.image_url,
    auto_queued: true,
  };

  await saveInboxPlans(shopDomain, [...stored.plans, round2Plan]);
  return { queued: true, round2_plan_id: round2Plan.id, parent_plan_id: plan.id };
}

module.exports = {
  isAutoRound2Enabled,
  inferRound2BasePrice,
  maybeAutoQueueRound2Plan,
};
