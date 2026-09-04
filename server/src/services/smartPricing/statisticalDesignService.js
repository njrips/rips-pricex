const PRACTICAL_TEST_MIN_DAYS = 14;
const PRACTICAL_TEST_MAX_DAYS = 56;

/**
 * Statistical design helpers for Smart Pricing test plans.
 * Mirrors RipX SampleSizeCalculator two-proportion logic (simplified for backend).
 */

const Z_BETA = { 80: 0.8416, 90: 1.2816, 95: 1.6449 };

function inverseStandardNormal(p) {
  if (!(p > 0 && p < 1)) return null;
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const low = 0.02425;
  const high = 1 - low;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > high) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function getZAlpha(confidenceLevel, comparisonCount = 1) {
  const confidence = Number(confidenceLevel) / 100;
  const comparisons = Math.max(1, Math.round(Number(comparisonCount) || 1));
  const alpha = Number.isFinite(confidence) && confidence > 0 && confidence < 1
    ? 1 - confidence
    : 0.1;
  return inverseStandardNormal(1 - alpha / comparisons / 2) || 1.6449;
}

function getZBeta(power) {
  const p = Number(power);
  return Z_BETA[p] || Z_BETA[80];
}

/**
 * Casagrande-Pike fixed-horizon two-proportion planning reference without
 * continuity correction. Live decisions use always-valid mSPRT evidence:
 *
 *   n = (z(1-α/2)·√(2p̄q̄) + z(1-β)·√(p₁q₁ + p₂q₂))² / (p₂ - p₁)²
 *
 * Must stay identical to computeVisitorsPerVariant in
 * app/components/SmartPricing/classic/sampleSizePolicy.js, which powers the
 * wizard's time-to-read estimate. `mdePercent` is a relative lift.
 */
function computeVisitorsPerVariant({
  baselineConversionRate = 0.02,
  mdePercent = 10,
  confidenceLevel = 90,
  power = 80,
  comparisonCount = 1,
} = {}) {
  const p1 = Number(baselineConversionRate);
  const effect = Number(mdePercent) / 100;
  if (!Number.isFinite(p1) || p1 <= 0 || p1 >= 1 || !(effect > 0)) {
    return null;
  }
  const p2 = p1 * (1 + effect);
  if (!Number.isFinite(p2) || p2 >= 1) {
    return null;
  }
  const delta = p2 - p1;
  if (delta <= 0) {
    return null;
  }

  const zAlpha = getZAlpha(confidenceLevel, comparisonCount);
  const zBeta = getZBeta(power);
  const pBar = (p1 + p2) / 2;
  const seNull = Math.sqrt(2 * pBar * (1 - pBar));
  const seAlt = Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2));
  const n = ((zAlpha * seNull + zBeta * seAlt) / delta) ** 2;
  return Number.isFinite(n) ? Math.ceil(n) : null;
}

function ratePowerRating(estimatedDays, targetDays = 21) {
  if (estimatedDays <= targetDays) {
    return 'adequate';
  }
  if (estimatedDays <= targetDays * 1.5) {
    return 'adequate';
  }
  if (estimatedDays <= targetDays * 2) {
    return 'underpowered';
  }
  return 'underpowered';
}

function buildVariantCountOptions({
  dailyVisitors = 100,
  baselineConversionRate = 0.02,
  mdePercent = 10,
  confidenceLevel = 90,
  power = 80,
  targetDays = 21,
  counts = [2, 3, 4],
} = {}) {
  const daily = Math.max(1, Number(dailyVisitors) || 1);
  let recommendedCount = 3;
  let bestScore = Infinity;

  const options = counts.map(count => {
    const comparisonCount = Math.max(1, Number(count) - 1);
    const perVariant = computeVisitorsPerVariant({
      baselineConversionRate,
      mdePercent,
      confidenceLevel,
      power,
      comparisonCount,
    });
    if (!perVariant) return null;
    const totalVisitors = perVariant * count;
    const estimatedDays = Math.ceil(totalVisitors / daily);
    const timelineRating = ratePowerRating(estimatedDays, targetDays);
    const feasibilityWarning =
      estimatedDays > targetDays * 1.5
        ? `Exceeds ${targetDays}-day target at current traffic`
        : null;
    const score =
      Math.abs(estimatedDays - targetDays) + (timelineRating === 'underpowered' ? 50 : 0);
    if (score < bestScore) {
      bestScore = score;
      recommendedCount = count;
    }
    return {
      count,
      visitors_per_variant: perVariant,
      total_visitors: totalVisitors,
      estimated_days: estimatedDays,
      mde_percent: mdePercent,
      timeline_rating: timelineRating,
      power_rating: timelineRating,
      recommended: false,
      feasibility_warning: feasibilityWarning,
      comparison_count: comparisonCount,
    };
  }).filter(Boolean);

  return options.map(opt => ({ ...opt, recommended: opt.count === recommendedCount }));
}

function buildStatisticalDesign(params = {}) {
  const options = buildVariantCountOptions(params);
  const selected =
    options.find(o => o.count === params.variantCount) ||
    options.find(o => o.recommended) ||
    options[0];
  if (!selected) {
    return {
      primary_metric: 'conversion_rate',
      decision_metric: params.decisionMetric || 'revenue_per_visitor',
      planning_method: 'fixed_horizon_two_proportion',
      baseline_conversion_rate: params.baselineConversionRate || 0,
      baseline_source: params.baselineSource || null,
      traffic_source: params.trafficSource || null,
      traffic_confidence: params.trafficConfidence || null,
      baseline_ppv: params.baselinePpv || 0,
      confidence_level: params.confidenceLevel || 90,
      statistical_power: params.power || 80,
      mde_percent: params.mdePercent || 10,
      visitors_per_variant_required: 0,
      total_visitors_required: 0,
      estimated_duration_days: 0,
      daily_visitors_to_sku: params.dailyVisitors || 0,
      power_rating: 'underpowered',
      timeline_rating: 'insufficient_data',
      duration_feasibility: 'insufficient_data',
      practical_window_min_days: PRACTICAL_TEST_MIN_DAYS,
      practical_window_max_days: PRACTICAL_TEST_MAX_DAYS,
      analysis_method: 'sequential',
      feasibility_notes: ['Insufficient data for sample size calculation'],
    };
  }

  const notes = [];
  if (selected.feasibility_warning) {
    notes.push(selected.feasibility_warning);
  }
  if (selected.timeline_rating === 'underpowered') {
    notes.push('Consider 2 variants or extending test duration');
  }

  return {
    primary_metric: 'conversion_rate',
    decision_metric: params.decisionMetric || 'revenue_per_visitor',
    planning_method: 'fixed_horizon_two_proportion',
    baseline_conversion_rate: Number(params.baselineConversionRate) || 0,
    baseline_source: params.baselineSource || null,
    traffic_source: params.trafficSource || null,
    traffic_confidence: params.trafficConfidence || null,
    baseline_ppv: Number(params.baselinePpv) || 0,
    confidence_level: Number(params.confidenceLevel) || 90,
    statistical_power: Number(params.power) || 80,
    mde_percent: Number(params.mdePercent) || 10,
    visitors_per_variant_required: selected.visitors_per_variant,
    total_visitors_required: selected.total_visitors,
    estimated_duration_days: selected.estimated_days,
    daily_visitors_to_sku: Math.max(1, Number(params.dailyVisitors) || 1),
    power_rating: selected.timeline_rating,
    timeline_rating: selected.timeline_rating,
    duration_feasibility:
      selected.estimated_days <= PRACTICAL_TEST_MAX_DAYS ? 'practical' : 'not_feasible',
    practical_window_min_days: PRACTICAL_TEST_MIN_DAYS,
    practical_window_max_days: PRACTICAL_TEST_MAX_DAYS,
    analysis_method: 'sequential',
    feasibility_notes: notes,
  };
}

function firstPositiveInt(...values) {
  for (const raw of values) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1) return Math.round(n);
  }
  return null;
}

/**
 * Merchant floor stays the earliest look. Power N is the planning / recommended sample.
 * Sequential testing may call a large effect after the floor and before power N.
 */
function visitorsForConversionFloor(minConversions, baselineConversionRate) {
  const conversions = Number(minConversions);
  const rate = Number(baselineConversionRate);
  if (!Number.isFinite(conversions) || conversions < 1) return null;
  if (!Number.isFinite(rate) || rate <= 0 || rate >= 1) return null;
  return Math.ceil(conversions / rate);
}

function resolveSampleSizePolicy({
  merchantMin = 5000,
  minConversions = null,
  baselineConversionRate = null,
  mdePercent = 10,
  confidenceLevel = 90,
  power = 80,
  storedRecommended = null,
  comparisonCount = 1,
} = {}) {
  const floor = firstPositiveInt(merchantMin) || 5000;
  const computedRecommended = computeVisitorsPerVariant({
      baselineConversionRate,
      mdePercent,
      confidenceLevel,
      power,
      comparisonCount,
    });
  const recommended = computedRecommended || firstPositiveInt(storedRecommended);
  // Mirror the wizard: a result is gated on conversions per variation too, so
  // the earliest look is whichever floor takes longer to reach.
  const conversionFloorVisitors = visitorsForConversionFloor(
    minConversions,
    baselineConversionRate
  );
  const earliest = conversionFloorVisitors ? Math.max(floor, conversionFloorVisitors) : floor;
  const planning = recommended ? Math.max(earliest, recommended) : earliest;
  return {
    merchantMin: floor,
    minConversions: firstPositiveInt(minConversions),
    conversionFloorVisitors,
    earliestCallPerVariant: earliest,
    recommendedPerVariant: recommended || null,
    planningPerVariant: planning,
    mdePercent: Number(mdePercent) || 10,
    confidenceLevel: Number(confidenceLevel) || 90,
    statisticalPower: Number(power) || 80,
    comparisonCount: Math.max(1, Math.round(Number(comparisonCount) || 1)),
    recommendationSource: computedRecommended ? 'computed' : recommended ? 'stored' : null,
    baselineConversionRate: Number(baselineConversionRate) || null,
    powerRating: recommended && earliest < recommended ? 'underpowered' : 'adequate',
  };
}

module.exports = {
  visitorsForConversionFloor,
  computeVisitorsPerVariant,
  buildVariantCountOptions,
  buildStatisticalDesign,
  ratePowerRating,
  resolveSampleSizePolicy,
};
