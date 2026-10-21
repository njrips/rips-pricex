/**
 * Builds SmartPricingTestPlan artifacts from SKU metrics + merchant choices.
 */

const { applyScenarioPreset, buildGuardrailBand, roundPrice } = require('./priceBandService');
const { buildStatisticalDesign, buildVariantCountOptions } = require('./statisticalDesignService');

function buildGuardrailChecks(currentPrice, priceArms = [], guardrails = {}, options = {}) {
  const maxChange = guardrails.maxChangePercent ?? guardrails.max_price_change_percent ?? 15;
  const { checkoutPriceFunctionActive = null } = options;
  const band = buildGuardrailBand(currentPrice, guardrails);
  // AI prices come from the merchant's band, which max price change does not limit.
  const capped = priceArms.filter(a => a.price_source !== 'ai');

  const checkoutActive = checkoutPriceFunctionActive;
  const checkoutActual =
    checkoutActive === true
      ? 'Active'
      : checkoutActive === false
        ? 'Not verified — check Setup'
        : 'Verify at launch';

  const checks = [
    {
      id: 'price_floor',
      label: 'Price floor',
      threshold: `≥ $${band.floor}`,
      actual: `$${Math.min(...priceArms.map(a => a.price))}`,
      passed: capped.every(a => a.price >= band.floor),
    },
    {
      id: 'price_ceiling',
      label: 'Price ceiling',
      threshold: `≤ $${band.ceiling}`,
      actual: `$${Math.max(...priceArms.map(a => a.price))}`,
      passed: capped.every(a => a.price <= band.ceiling),
    },
    {
      id: 'max_change',
      label: 'Max price change',
      threshold: `±${maxChange}%`,
      actual: `${Math.max(...priceArms.map(a => Math.abs(a.delta_percent)))}%`,
      passed: capped.every(a => Math.abs(a.delta_percent) <= maxChange),
    },
    {
      id: 'allocation_total',
      label: 'Traffic allocation',
      threshold: '100%',
      actual: `${priceArms.reduce((s, a) => s + a.allocation_percent, 0)}%`,
      passed: priceArms.reduce((s, a) => s + a.allocation_percent, 0) === 100,
    },
    {
      id: 'variant_count',
      label: 'Variant count',
      threshold: '2–4 arms',
      actual: String(priceArms.length),
      passed: priceArms.length >= 2 && priceArms.length <= 4,
    },
    {
      id: 'checkout_alignment',
      label: 'Checkout price function',
      threshold: 'Checkout price override active',
      actual: checkoutActual,
      passed: checkoutActive !== false,
    },
  ];
  return checks;
}

function buildArmProjections(priceArms = [], baselinePpv = 0) {
  const control = priceArms.find(a => a.role === 'control') || priceArms[0];
  const controlPpv = Number(baselinePpv) || 1.84;
  return priceArms.map(arm => {
    const priceRatio = control?.price ? arm.price / control.price : 1;
    const convElasticity = -0.8;
    const convDelta = (priceRatio - 1) * convElasticity * 100;
    const projectedPpv = roundPrice(controlPpv * priceRatio * (1 + convDelta / 100));
    const monthlyDelta = roundPrice((projectedPpv - controlPpv) * 4200);
    const revenueTrap = convDelta > 2 && projectedPpv < controlPpv;
    return {
      arm_id: arm.id,
      price: arm.price,
      projected_ppv: projectedPpv,
      projected_monthly_profit_delta: monthlyDelta,
      projected_conversion_delta_percent: roundPrice(convDelta),
      revenue_trap_risk: revenueTrap,
    };
  });
}

function buildLearningPath(currentPrice, scenarioPreset = 'recommended') {
  const round1 = applyScenarioPreset(currentPrice, scenarioPreset);
  const winner = round1.price_arms.reduce(
    (best, arm) => (arm.price > best.price ? arm : best),
    round1.price_arms[0]
  );
  const round2 = applyScenarioPreset(winner.price, 'conservative');
  const round3Prices = [winner.price - 1, winner.price, winner.price + 1].map(p =>
    roundPrice(Math.max(0, p))
  );
  return [
    {
      round: 1,
      status: 'planned',
      price_band: round1.guardrail_band,
      candidate_arms_preview: round1.candidate_prices,
      trigger: 'Initial plan',
    },
    {
      round: 2,
      status: 'planned',
      price_band: round2.guardrail_band,
      candidate_arms_preview: round2.candidate_prices,
      trigger: `If $${winner.price} wins Round 1`,
    },
    {
      round: 3,
      status: 'planned',
      price_band: { floor: roundPrice(winner.price - 2), ceiling: roundPrice(winner.price + 2) },
      candidate_arms_preview: round3Prices,
      trigger: 'Fine-tune after Round 2',
    },
  ];
}

function buildSmartPricingTestPlan(input = {}) {
  const {
    shopDomain = '',
    productId = '',
    variantId = '',
    title = 'Product',
    currentPrice = 0,
    currency = 'USD',
    scenarioPreset = 'recommended',
    variantCount,
    dailyVisitors = 140,
    baselineConversionRate = 0.024,
    baselineSource = null,
    baselinePpv = 1.84,
    trafficSource = 'orders_estimated',
    trafficConfidence = 'medium',
    mdePercent = 10,
    confidenceLevel = 90,
    power = 80,
    minSampleSize,
    minConversionsPerVariation,
    guardrails = {},
    planId,
    planVersion = 1,
    imageUrl = '',
    handle = '',
    unitCost = null,
    marginPercent = null,
    marginSource = null,
    checkoutPriceFunctionActive = null,
  } = input;
  const productHandle = String(handle || input.product_handle || '').trim();
  const explicitUnitCost = Number(unitCost);
  const recordedMargin = Number(marginPercent);
  const resolvedUnitCost =
    unitCost !== null &&
    unitCost !== undefined &&
    Number.isFinite(explicitUnitCost) &&
    explicitUnitCost >= 0
      ? explicitUnitCost
      : marginPercent !== null &&
          marginPercent !== undefined &&
          Number.isFinite(recordedMargin) &&
          recordedMargin >= 0 &&
          recordedMargin <= 100
        ? Number(currentPrice) * (1 - recordedMargin / 100)
        : null;

  const preset = applyScenarioPreset(currentPrice, scenarioPreset, guardrails);
  const resolvedCount = variantCount || preset.variant_count;
  const candidates = preset.candidate_prices.slice(0, resolvedCount);
  while (candidates.length < resolvedCount && candidates.length > 0) {
    candidates.push(candidates[candidates.length - 1]);
  }
  const priceArms = preset.price_arms.slice(0, resolvedCount);
  const variantCountOptions = buildVariantCountOptions({
    dailyVisitors,
    baselineConversionRate,
    mdePercent,
    confidenceLevel,
    power,
  });
  const merchantMin = Number(minSampleSize ?? guardrails.min_sample_size_per_variation);
  const sampleFloor = Number.isFinite(merchantMin) && merchantMin >= 1 ? Math.round(merchantMin) : null;
  const merchantConversions = Number(
    minConversionsPerVariation ?? guardrails.min_conversions_per_variation
  );
  const conversionFloor =
    Number.isFinite(merchantConversions) && merchantConversions >= 1
      ? Math.round(merchantConversions)
      : null;
  const configuredConfidence = Number(confidenceLevel);
  const confidenceFraction = [80, 90, 95].includes(configuredConfidence)
    ? configuredConfidence / 100
    : 0.9;
  const statisticalDesign = {
    ...buildStatisticalDesign({
      variantCount: resolvedCount,
      dailyVisitors,
      baselineConversionRate,
      baselineSource,
      baselinePpv,
      trafficSource,
      trafficConfidence,
      mdePercent,
      confidenceLevel,
      power,
      decisionMetric: guardrails.objective || 'revenue_per_visitor',
    }),
    analysis_method: 'sequential',
    ...(sampleFloor ? { min_sample_size: sampleFloor } : {}),
    ...(conversionFloor ? { min_conversions_per_variation: conversionFloor } : {}),
  };
  const guardrailChecks = buildGuardrailChecks(currentPrice, priceArms, guardrails, {
    checkoutPriceFunctionActive,
  });
  const armProjections = buildArmProjections(priceArms, baselinePpv);
  const recommendedOption = variantCountOptions.find(o => o.recommended);

  return {
    // Four digits of the clock repeated every ten seconds, so two plans built
    // close together could share an id and one would overwrite the other.
    id: planId || `SP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    shop_domain: shopDomain,
    status: 'draft',
    schema_version: '1.0.0',
    product_id: productId,
    variant_id: variantId,
    title,
    handle: productHandle,
    product_handle: productHandle,
    image_url: imageUrl ? String(imageUrl).trim() : '',
    unit_cost: resolvedUnitCost,
    margin_source: marginSource || (resolvedUnitCost !== null ? 'estimated_margin' : null),
    current_price: roundPrice(currentPrice),
    currency,
    objective: 'revenue_per_visitor',
    scenario_preset: scenarioPreset,
    recommended_variant_count: recommendedOption?.count || resolvedCount,
    variant_count_rationale:
      trafficConfidence === 'estimated'
        ? `Traffic estimated from shop averages (${dailyVisitors}/day) — use a Safe 2-price test first.`
        : recommendedOption?.feasibility_warning ||
          `At ${dailyVisitors} daily visitors, ${resolvedCount} variants balances power and duration.`,
    daily_visitors: dailyVisitors,
    traffic_source: trafficSource,
    traffic_confidence: trafficConfidence,
    baseline_source: baselineSource,
    price_arms: priceArms,
    traffic_split_strategy: 'equal',
    statistical_design: statisticalDesign,
    ...(sampleFloor
      ? {
          launch_preferences: { min_sample_size: sampleFloor },
          goal: {
            min_sample_size: sampleFloor,
            analysis_method: 'sequential',
            mde_percent: mdePercent,
            significance_level: confidenceFraction,
          },
        }
      : {
          goal: {
            analysis_method: 'sequential',
            mde_percent: mdePercent,
            significance_level: confidenceFraction,
          },
        }),
    variant_count_options: variantCountOptions,
    learning_path: buildLearningPath(currentPrice, scenarioPreset),
    arm_projections: armProjections,
    guardrail_checks: guardrailChecks,
    ai_summary: {
      headline: `Test ${title} with ${resolvedCount} price arms`,
      confidence: 'medium',
      key_insight:
        armProjections.find(
          p => p.projected_ppv === Math.max(...armProjections.map(x => x.projected_ppv))
        )?.price !== currentPrice
          ? 'Higher price arm may improve PPV despite conversion trade-off'
          : 'Control price is near optimal in preview model',
    },
    plan_version: planVersion,
    test_id: null,
  };
}

function applyPriceArmOverrides(plan = {}, armPrices = {}, guardrails = {}) {
  const currentPrice = Number(plan.current_price);
  const currency = plan.currency || 'USD';
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    throw new Error('This product has no valid current price');
  }
  const arms = (Array.isArray(plan.price_arms) ? plan.price_arms : []).map(arm => {
    const raw = armPrices[arm.id];
    const price =
      raw !== undefined && raw !== null && String(raw).trim() !== ''
        ? Number(raw)
        : Number(arm.price);
    if (!Number.isFinite(price) || price < 0) {
      throw new Error(`Invalid price for ${arm.label || 'a variation'}`);
    }
    const isControl = Math.abs(price - currentPrice) < 0.01;
    const delta = currentPrice > 0 ? ((price - currentPrice) / currentPrice) * 100 : 0;
    return {
      ...arm,
      price: roundPrice(price, currency),
      delta_percent: roundPrice(delta),
      role: isControl ? 'control' : arm.role === 'control' && !isControl ? 'challenger' : arm.role,
      label: isControl ? 'Control' : arm.label || 'Challenger',
    };
  });
  if (arms.length < 2) {
    throw new Error('A test needs control and at least one price variation');
  }
  const guardrailChecks = buildGuardrailChecks(currentPrice, arms, guardrails, {
    checkoutPriceFunctionActive: plan.checkout_price_function_active ?? null,
  });
  const baselinePpv = Number(plan.baseline_ppv) || 0;
  const armProjections = buildArmProjections(arms, baselinePpv);
  return {
    ...plan,
    price_arms: arms,
    guardrail_checks: guardrailChecks,
    arm_projections: armProjections,
  };
}

module.exports = {
  buildSmartPricingTestPlan,
  buildGuardrailChecks,
  buildArmProjections,
  buildLearningPath,
  applyPriceArmOverrides,
};
