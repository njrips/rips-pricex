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

function statisticalInputsFromGuardrails(guardrails) {
  const g = guardrails && typeof guardrails === 'object' ? guardrails : {};
  const minSample = Number(g.min_sample_size_per_variation);
  return {
    mdePercent: Number(g.mde_percent) || 10,
    confidenceLevel: Number(g.confidence_level) === 95 ? 95 : 90,
    power: Number(g.statistical_power) || 80,
    ...(Number.isFinite(minSample) && minSample >= 1
      ? { minSampleSize: Math.round(minSample) }
      : {}),
  };
}

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
    const baselineSource = String(opp.baseline_source || '').toLowerCase();
    const qualifiedBaseline =
      !baselineSource ||
      ['experiment_conversion', 'converting_sessions', 'unique_purchasers_per_session'].includes(
        baselineSource
      );
    plans.push(
      buildSmartPricingTestPlan({
        shopDomain,
        productId: opp.product_id,
        variantId: opp.variant_id,
        title: opp.title,
        currentPrice: opp.current_price,
        currency: opp.currency,
        dailyVisitors: opp.daily_visitors,
        baselineConversionRate: qualifiedBaseline ? opp.baseline_conversion_rate : null,
        baselineSource: opp.baseline_source || null,
        baselinePpv: opp.baseline_ppv,
        trafficSource: opp.traffic_source,
        trafficConfidence: opp.traffic_confidence,
        scenarioPreset: resolvedScenario,
        variantCount,
        ...statisticalInputsFromGuardrails(guardrails),
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
    plan =>
      (plan.statistical_design?.timeline_rating || plan.statistical_design?.power_rating) ===
      'underpowered'
  ).length;
  const notFeasible = plans.filter(
    plan => plan.statistical_design?.duration_feasibility === 'not_feasible'
  ).length;
  const insufficientData = plans.filter(
    plan => plan.statistical_design?.duration_feasibility === 'insufficient_data'
  ).length;
  const planningReady = plans.filter(
    plan =>
      plan.statistical_design?.duration_feasibility === 'practical' &&
      (plan.statistical_design?.timeline_rating || plan.statistical_design?.power_rating) ===
        'adequate'
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
      ready: planningReady,
      underpowered,
      not_feasible: notFeasible,
      insufficient_data: insufficientData,
      estimated_traffic: estimatedTraffic,
      stagger_recommended: planningReady < plans.length && plans.length > 1,
    },
    missing_variant_ids: missing,
    guardrails,
    launch_capacity: launchCapacity,
  };
}

module.exports = {
  createBatchFromSelection,
};
