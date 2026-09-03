/**
 * Joins Smart Pricing plan projections with live test analytics for merchant reporting.
 */

const { getTestById } = require('../../models/test');
const analyticsService = require('../analytics');
const { findInboxPlanByTestId } = require('../../models/smartPricingInboxStore');
const { isSmartPricingTest } = require('./smartPricingTestIdentity');

function variantFixedPrice(variant = {}) {
  const cfg = variant.config && typeof variant.config === 'object' ? variant.config : {};
  if (cfg.price !== undefined && cfg.price !== null && String(cfg.price).trim() !== '') {
    return Number(cfg.price);
  }
  const byProduct = cfg.byProduct;
  if (byProduct && typeof byProduct === 'object') {
    for (const productCfg of Object.values(byProduct)) {
      const byVariant =
        productCfg?.byVariant && typeof productCfg.byVariant === 'object'
          ? productCfg.byVariant
          : null;
      if (!byVariant) {
        continue;
      }
      for (const variantCfg of Object.values(byVariant)) {
        if (
          variantCfg?.price !== undefined &&
          variantCfg?.price !== null &&
          String(variantCfg.price).trim() !== ''
        ) {
          return Number(variantCfg.price);
        }
      }
    }
  }
  return null;
}

function isOfferAnalyticsContext(arm, test) {
  const type = String(test?.type || test?.metadata?.experiment_type || '')
    .trim()
    .toLowerCase();
  if (type === 'offer' || type === 'offer_test') return true;
  return Boolean(arm?.offer && typeof arm.offer === 'object');
}

function matchAnalyticsToTestVariant(testVariant, analyticsVariants = [], extraNeedles = []) {
  const byIdentity = analyticsVariants.find(row => {
    if (testVariant?.id !== undefined && testVariant?.id !== null) {
      return String(row.id) === String(testVariant.id);
    }
    if (testVariant?.name && row.name) {
      return String(row.name).trim() === String(testVariant.name).trim();
    }
    return false;
  });
  if (byIdentity) return byIdentity;
  for (const needle of extraNeedles) {
    const text = String(needle || '')
      .trim()
      .toLowerCase();
    if (!text) continue;
    const hit = analyticsVariants.find(row =>
      String(row.name || '')
        .toLowerCase()
        .includes(text)
    );
    if (hit) return hit;
  }
  return null;
}

function matchOfferVariantToArm(arm, index, testVariants = [], analyticsVariants = []) {
  const label = String(arm?.label || '').trim();
  const armId = String(arm?.id || '').trim();
  const testVariant =
    testVariants.find(variant => armId && String(variant?.id) === armId) ||
    testVariants.find(variant => {
      const name = String(variant?.name || '').trim();
      if (!label || !name) return false;
      const a = name.toLowerCase();
      const b = label.toLowerCase();
      return a === b || a.includes(b) || b.includes(a);
    }) ||
    (Number.isInteger(index) && index >= 0 ? testVariants[index] || null : null);

  return {
    testVariant,
    analyticsVariant: matchAnalyticsToTestVariant(testVariant, analyticsVariants, [label, armId]),
  };
}

function matchVariantToArm(arm, testVariants = [], analyticsVariants = [], options = {}) {
  const index = Number.isInteger(options.index) ? options.index : null;
  if (isOfferAnalyticsContext(arm, options.test)) {
    return matchOfferVariantToArm(arm, index, testVariants, analyticsVariants);
  }

  const targetPrice = Number(arm?.price);
  if (!Number.isFinite(targetPrice)) {
    return matchOfferVariantToArm(arm, index, testVariants, analyticsVariants);
  }

  const testVariant =
    testVariants.find(variant => {
      const price = variantFixedPrice(variant);
      return Number.isFinite(price) && Math.abs(price - targetPrice) < 0.02;
    }) ||
    testVariants.find(variant => String(variant?.name || '').includes(String(targetPrice))) ||
    (Number.isInteger(index) && index >= 0 ? testVariants[index] || null : null);

  const analyticsVariant =
    matchAnalyticsToTestVariant(testVariant, analyticsVariants) ||
    analyticsVariants.find(row => String(row.name || '').includes(String(targetPrice))) ||
    null;

  return { testVariant, analyticsVariant };
}

function buildArmAnalyticsRow(arm, projection, matches, baselinePpv) {
  const live = matches.analyticsVariant || {};
  const visitors = Number(live.visitors) || 0;
  const livePpv = Number(live.profitPerVisitor ?? live.profit_per_visitor);
  const liveRpv = Number(live.revenuePerVisitor ?? live.revenue_per_visitor);
  const projectedPpv = Number(projection?.projected_ppv);
  const baseline = Number(baselinePpv);
  const ppvDelta =
    Number.isFinite(livePpv) && Number.isFinite(projectedPpv)
      ? Math.round((livePpv - projectedPpv) * 1000) / 1000
      : null;

  const revenueTrapLive =
    Number.isFinite(liveRpv) &&
    Number.isFinite(livePpv) &&
    liveRpv > (baseline || 0) &&
    livePpv < (baseline || liveRpv);

  return {
    arm_id: arm.id,
    role: arm.role,
    label: arm.label || null,
    price: arm.price,
    variant_id: live.id || matches.testVariant?.id || null,
    variant_name: live.name || matches.testVariant?.name || null,
    visitors,
    conversions: Number(live.conversions) || 0,
    conversion_rate: Number(live.conversionRate ?? live.conversion_rate) || 0,
    revenue_per_visitor: Number.isFinite(liveRpv) ? liveRpv : null,
    profit_per_visitor: Number.isFinite(livePpv) ? livePpv : null,
    projected_ppv: Number.isFinite(projectedPpv) ? projectedPpv : null,
    projected_conversion_delta_percent: projection?.projected_conversion_delta_percent ?? null,
    ppv_vs_projection_delta: ppvDelta,
    revenue_trap_projected: projection?.revenue_trap_risk === true,
    revenue_trap_live: revenueTrapLive,
  };
}

function isControlArm(arm) {
  const role = String(arm?.role || '')
    .trim()
    .toLowerCase();
  if (role === 'control') {
    return true;
  }
  const label = String(arm?.label || '')
    .trim()
    .toLowerCase();
  return label === 'control' || label.startsWith('control ');
}

/**
 * Pick winner arm only when analytics declares a promoteable winner.
 * Do not invent a challenger from "best rate" when significance.winner is unset.
 */
function resolveWinnerArm(armRows = [], significance = null) {
  if (!significance?.significant) {
    return { winner_arm_id: null, winner_variant_id: null };
  }

  const winnerFlag = String(significance.winner || '')
    .trim()
    .toLowerCase();
  // Two-variant: variantB = challenger. Multi: best + winnerVariantId.
  // Control / empty winner → not roll-out-ready.
  if (winnerFlag !== 'variantb' && winnerFlag !== 'best') {
    return { winner_arm_id: null, winner_variant_id: null };
  }

  let winnerVariantId = significance.winnerVariantId || null;
  if (
    (winnerVariantId === null ||
      winnerVariantId === undefined ||
      String(winnerVariantId).trim() === '') &&
    winnerFlag === 'best'
  ) {
    winnerVariantId = significance.bestVariantId || null;
  }

  if (
    winnerVariantId !== null &&
    winnerVariantId !== undefined &&
    String(winnerVariantId).trim() !== ''
  ) {
    const byVariant = armRows.find(row => String(row.variant_id) === String(winnerVariantId));
    if (byVariant && !isControlArm(byVariant)) {
      return {
        winner_arm_id: byVariant.arm_id || null,
        winner_variant_id: byVariant.variant_id || null,
      };
    }
    return { winner_arm_id: null, winner_variant_id: null };
  }

  // Two-variant path: significance.winner === 'variantB' without variant ids.
  // Prefer the first non-control arm with the highest conversion rate among challengers
  // only when there is exactly one non-control arm.
  const nonControl = armRows.filter(row => !isControlArm(row));
  if (winnerFlag === 'variantb' && nonControl.length === 1) {
    return {
      winner_arm_id: nonControl[0].arm_id || null,
      winner_variant_id: nonControl[0].variant_id || null,
    };
  }

  return { winner_arm_id: null, winner_variant_id: null };
}

function buildSignificanceSummary(analytics) {
  const sig =
    analytics?.significance && typeof analytics.significance === 'object'
      ? analytics.significance
      : null;
  if (!sig) {
    return {
      significant: false,
      lift: null,
      confidence: null,
      message: analytics?.error || 'Collecting data',
      winner: null,
      winnerVariantId: null,
      bestVariantId: null,
    };
  }
  return {
    significant: sig.significant === true,
    lift: Number.isFinite(Number(sig.lift)) ? Number(sig.lift) : null,
    confidence: Number.isFinite(Number(sig.confidence)) ? Number(sig.confidence) : null,
    message: sig.message || null,
    winner: sig.winner ?? null,
    winnerVariantId: sig.winnerVariantId ?? null,
    bestVariantId: sig.bestVariantId ?? null,
    minSampleSize: Number.isFinite(Number(sig.minSampleSize)) ? Number(sig.minSampleSize) : null,
    // A merchant looking at a blocked result needs to see which floor is
    // holding it, not just that something is missing.
    minConversionsPerVariation: Number.isFinite(Number(sig.minConversionsPerVariation))
      ? Number(sig.minConversionsPerVariation)
      : null,
    lowestArmConversions: Number.isFinite(Number(sig.lowestArmConversions))
      ? Number(sig.lowestArmConversions)
      : null,
    recommendedSampleSize: Number.isFinite(Number(sig.recommendedSampleSize))
      ? Number(sig.recommendedSampleSize)
      : null,
    sampleReady: sig.sampleReady === true ? true : sig.sampleReady === false ? false : null,
    powered: sig.powered === true ? true : sig.powered === false ? false : null,
    sequential: sig.sequential === true,
    method: sig.method || null,
    family: sig.family || null,
    evidenceValidated: sig.evidenceValidated === true,
    evidenceValidity: sig.evidenceValidity || null,
    controlWin: sig.controlWin === true,
    // A split that does not match the allocation invalidates the comparison, so
    // it has to reach the merchant rather than sit in the analytics payload.
    srm:
      sig.srm && typeof sig.srm === 'object'
        ? {
            detected: sig.srm.detected === true,
            pValue: Number.isFinite(Number(sig.srm.pValue)) ? Number(sig.srm.pValue) : null,
            message: sig.srm.message || null,
          }
        : null,
    outcomesMatured: sig.outcomesMatured === true ? true : sig.outcomesMatured === false ? false : null,
    collectionDays: Number.isFinite(Number(sig.collectionDays))
      ? Math.round(Number(sig.collectionDays))
      : null,
    outcomeMaturityDays: Number.isFinite(Number(sig.outcomeMaturityDays))
      ? Number(sig.outcomeMaturityDays)
      : null,
  };
}

function synthesizeArmsFromTestVariants(testVariants = []) {
  return (Array.isArray(testVariants) ? testVariants : []).map((variant, index) => {
    const price = variantFixedPrice(variant);
    const name = String(variant?.name || `Variant ${index + 1}`).trim();
    const role =
      index === 0 || /^control\b/i.test(name) || /\bcontrol\b/i.test(name)
        ? 'control'
        : 'challenger';
    return {
      id: variant?.id || `variant_${index}`,
      role,
      label:
        name || (role === 'control' ? 'Control' : `Variation ${String.fromCharCode(65 + index)}`),
      price: Number.isFinite(price) ? price : null,
      allocation_percent: Number(variant?.allocation) || null,
    };
  });
}

async function buildSmartPricingTestAnalytics(shopDomain, testId) {
  const test = await getTestById(testId, shopDomain);
  if (!test) {
    throw new Error('Test not found');
  }

  // tests table has no metadata column today — linkage usually lives on the inbox plan.
  const metadata = test.metadata && typeof test.metadata === 'object' ? test.metadata : {};
  const plan = (await findInboxPlanByTestId(shopDomain, testId)) || null;
  const isSmartPricing = isSmartPricingTest(test) || Boolean(plan?.id);
  if (!isSmartPricing) {
    throw new Error('Test is not linked to Smart Pricing');
  }

  const armsFromPlan = Array.isArray(plan?.price_arms) ? plan.price_arms : [];
  const armsFromMeta = Array.isArray(metadata.price_arms) ? metadata.price_arms : [];
  const testVariants = Array.isArray(test.variants) ? test.variants : [];
  const arms =
    armsFromPlan.length > 0
      ? armsFromPlan
      : armsFromMeta.length > 0
        ? armsFromMeta
        : synthesizeArmsFromTestVariants(testVariants);
  const projections = Array.isArray(plan?.arm_projections)
    ? plan.arm_projections
    : Array.isArray(metadata.arm_projections)
      ? metadata.arm_projections
      : [];

  const analytics = await analyticsService.getTestAnalytics(testId, shopDomain).catch(() => null);
  let revenueGuardrail = null;
  try {
    const { enforceRevenueDropGuardrail } = require('./smartPricingGuardrailEvaluatorService');
    revenueGuardrail = await enforceRevenueDropGuardrail({
      shopDomain,
      test,
      analytics,
    });
  } catch {
    revenueGuardrail = null;
  }
  // Read once and share: the auto-winner evaluation and the rollout decision
  // both need these, and this function runs once per product on an experiment
  // screen that may hold fifty of them.
  const shopGuardrails = await require('./smartPricingGuardrailsService')
    .getShopSmartPricingGuardrails(shopDomain)
    .catch(() => null);
  const shopReadiness = await require('./smartPricingRolloutReadinessStore')
    .getShopRolloutReadiness(shopDomain)
    .catch(() => ({}));
  const testReadiness = shopReadiness?.[testId] || null;

  let autoWinner = null;
  if (!revenueGuardrail?.enforced) {
    try {
      const { evaluateSmartPricingAutoWinner } = require('./smartPricingAutoWinnerService');
      autoWinner = await evaluateSmartPricingAutoWinner({
        shopDomain,
        test,
        analytics,
        plan,
        guardrails: shopGuardrails,
        readiness: testReadiness,
      });
    } catch {
      autoWinner = null;
    }
  }
  const analyticsVariants = Array.isArray(analytics?.variants) ? analytics.variants : [];
  const baselinePpv =
    plan?.statistical_design?.baseline_ppv ??
    metadata.baseline_ppv ??
    analyticsVariants[0]?.profitPerVisitor ??
    null;

  const projectionByArmId = new Map(
    projections.filter(row => row?.arm_id).map(row => [String(row.arm_id), row])
  );
  const projectionByPrice = new Map(
    projections
      .filter(row => row?.price !== undefined && row?.price !== null)
      .map(row => [String(Number(row.price)), row])
  );

  const armRows = arms.map((arm, index) => {
    const projection =
      projectionByArmId.get(String(arm.id)) ||
      projectionByPrice.get(String(Number(arm.price))) ||
      null;
    const matches = matchVariantToArm(arm, testVariants, analyticsVariants, { test, index });
    return buildArmAnalyticsRow(arm, projection, matches, baselinePpv);
  });

  const totalVisitorsFromArms = armRows.reduce((sum, row) => sum + (Number(row.visitors) || 0), 0);
  const totalConversionsFromArms = armRows.reduce(
    (sum, row) => sum + (Number(row.conversions) || 0),
    0
  );
  const analyticsSummary =
    analytics?.summary && typeof analytics.summary === 'object' ? analytics.summary : {};
  const totalVisitors =
    Number.isFinite(Number(analyticsSummary.totalVisitors)) &&
    Number(analyticsSummary.totalVisitors) > 0
      ? Number(analyticsSummary.totalVisitors)
      : totalVisitorsFromArms;
  const totalConversions =
    Number.isFinite(Number(analyticsSummary.totalConversions)) &&
    Number(analyticsSummary.totalConversions) >= 0
      ? Number(analyticsSummary.totalConversions)
      : totalConversionsFromArms;
  const overallConversionRate =
    totalVisitors > 0 ? Math.round((totalConversions / totalVisitors) * 10000) / 100 : null;

  const weightedLivePpv =
    totalVisitorsFromArms > 0
      ? armRows.reduce(
          (sum, row) =>
            sum +
            (Number.isFinite(row.profit_per_visitor) ? row.profit_per_visitor : 0) *
              (Number(row.visitors) || 0),
          0
        ) / totalVisitorsFromArms
      : null;

  const significance = buildSignificanceSummary(analytics);
  const winner = resolveWinnerArm(armRows, significance);

  // The rollout verdict ships with the analytics the experiment screen already
  // fetches per product, so the readiness table and the apply button cannot
  // disagree about whether this product is finished.
  let productDecision = null;
  try {
    const { resolveProductRolloutDecision } = require('./smartPricingProductDecision');
    productDecision = resolveProductRolloutDecision({
      // The test row was read before the guardrail and auto-winner steps ran, so
      // their fresh outcomes are handed over explicitly rather than re-read.
      test: {
        ...test,
        status: autoWinner?.test_status || revenueGuardrail?.test_status || test.status,
      },
      // An auto-apply that just landed must read as applied, not ready again.
      autoApplied:
        autoWinner?.enforced === true && autoWinner?.action !== 'stop_winner_ready',
      analytics: { significance, arms: armRows, revenue_guardrail: revenueGuardrail },
      plan,
      guardrails: shopGuardrails,
      readiness: testReadiness,
    });
  } catch {
    productDecision = null;
  }

  return {
    test_id: testId,
    plan_id: plan?.id || metadata.smart_pricing_plan_id || null,
    test_status: autoWinner?.test_status || revenueGuardrail?.test_status || test.status,
    revenue_guardrail: revenueGuardrail,
    auto_winner: autoWinner,
    baseline_ppv: baselinePpv,
    cogs: test.goal?.cogs || null,
    currency: plan?.currency || metadata.currency || 'USD',
    arms: armRows,
    significance,
    product_decision: productDecision,
    winner_arm_id: winner.winner_arm_id,
    winner_variant_id: winner.winner_variant_id,
    summary: {
      visitors: totalVisitors,
      conversions: totalConversions,
      overall_conversion_rate: overallConversionRate,
      live_weighted_ppv: weightedLivePpv,
      projected_best_ppv: armRows.reduce((best, row) => {
        const ppv = Number(row.projected_ppv);
        if (!Number.isFinite(ppv)) {
          return best;
        }
        return best === null || ppv > best ? ppv : best;
      }, null),
      revenue_trap_flags: armRows.filter(row => row.revenue_trap_live || row.revenue_trap_projected)
        .length,
      lift: significance.lift,
      confidence: significance.confidence,
      significant: significance.significant,
    },
  };
}

module.exports = {
  buildSmartPricingTestAnalytics,
  matchVariantToArm,
  variantFixedPrice,
  resolveWinnerArm,
  buildSignificanceSummary,
  isControlArm,
};
