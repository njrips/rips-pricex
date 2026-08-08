/**
 * Batch orchestration — build multiple SmartPricingTestPlans from selected SKUs.
 */

const { buildSmartPricingTestPlan } = require('./testPlanService');
const { getOpportunityByVariantId } = require('./opportunityService');
const { getShopSmartPricingGuardrails } = require('./smartPricingGuardrailsService');
const {
  resolveLaunchCapacity,
  countRunningPriceTests,
} = require('./smartPricingLaunchGuardService');
const { resolveSmartPricingCheckoutReadiness } = require('./smartPricingCheckoutReadinessService');

async function createBatchFromSelection({
  shopDomain = '',
  accessToken = '',
  variantIds = [],
  scenarioPreset = 'recommended',
  variantCountBySku = {},
  scenarioPresetBySku = {},
} = {}) {
  const ids = Array.isArray(variantIds)
    ? variantIds.map(id => String(id).trim()).filter(Boolean)
    : [];
  const plans = [];
  const missing = [];
  const guardrails = await getShopSmartPricingGuardrails(shopDomain).catch(() => null);
  const runningPriceTests = await countRunningPriceTests(shopDomain).catch(() => 0);
  const checkoutReadiness = await resolveSmartPricingCheckoutReadiness(shopDomain, {
    runningPriceTests,
    accessToken,
  });
  const checkoutActive = checkoutReadiness.ready;

  for (let index = 0; index < ids.length; index += 1) {
    const variantId = ids[index];
    const opp = await getOpportunityByVariantId(variantId, { shopDomain, accessToken });
    if (!opp) {
      missing.push(variantId);
      continue;
    }
    const resolvedScenario =
      scenarioPresetBySku[variantId] ||
      (scenarioPreset === 'recommended' ? opp.recommended_scenario_preset : scenarioPreset) ||
      scenarioPreset;
    const variantCount = variantCountBySku[variantId] || (opp.daily_visitors < 60 ? 2 : 3);
    plans.push(
      buildSmartPricingTestPlan({
        shopDomain,
        productId: opp.product_id,
        variantId: opp.variant_id,
        title: opp.title,
        currentPrice: opp.current_price,
        currency: opp.currency,
        dailyVisitors: opp.daily_visitors,
        baselineConversionRate: opp.baseline_conversion_rate,
        baselinePpv: opp.baseline_ppv,
        trafficSource: opp.traffic_source,
        trafficConfidence: opp.traffic_confidence,
        scenarioPreset: resolvedScenario,
        variantCount,
        guardrails: guardrails
          ? {
              minMarginPercent: guardrails.min_margin_percent,
              maxChangePercent: guardrails.max_price_change_percent,
              marginPercent: opp.margin_percent ?? 100 - guardrails.default_cogs_percent,
            }
          : {},
        planId: `SP-${Date.now()}-${index}`,
        imageUrl: opp.image_url,
        handle: opp.handle || opp.product_handle || '',
        checkoutPriceFunctionActive: checkoutActive,
      })
    );
  }

  const underpowered = plans.filter(
    plan => plan.statistical_design?.power_rating === 'underpowered'
  ).length;
  const estimatedTraffic = plans.filter(plan => plan.traffic_confidence === 'estimated').length;

  const launchCapacity = await resolveLaunchCapacity(shopDomain, {
    requestedCount: plans.length,
  }).catch(() => null);

  return {
    batch_id: `batch-${Date.now()}`,
    shop_domain: shopDomain,
    plans,
    checkout_readiness: checkoutReadiness,
    summary: {
      total: plans.length,
      ready: plans.length - underpowered,
      underpowered,
      estimated_traffic: estimatedTraffic,
      stagger_recommended: underpowered > 0 && plans.length > 1,
    },
    missing_variant_ids: missing,
    guardrails,
    launch_capacity: launchCapacity,
  };
}

module.exports = {
  createBatchFromSelection,
};
