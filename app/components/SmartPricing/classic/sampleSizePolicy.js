/**
 * Client-side power sample-size policy. Keep the two-proportion formula aligned with
 * server/src/services/smartPricing/statisticalDesignService.js.
 */

const Z_BETA = { 80: 0.8416, 90: 1.2816, 95: 1.6449 };

/**
 * Mirror of ABSOLUTE_MIN_CONVERSIONS_PER_VARIATION in
 * server/src/utils/minSampleSize.js. The decision engine enforces this floor
 * whatever Settings says, so the input must not offer a smaller number.
 */
export const ABSOLUTE_MIN_CONVERSIONS_PER_VARIATION = 10;

/** Mirror of DEFAULT_GUARDRAILS.min_conversions_per_variation on the server. */
export const DEFAULT_MIN_CONVERSIONS_PER_VARIATION = 100;

export const DEFAULT_MDE_PERCENT = 10;
export const DEFAULT_CONFIDENCE_LEVEL = 90;
export const DEFAULT_POWER = 80;

function firstPositiveInt(...values) {
  for (const raw of values) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1) return Math.round(n);
  }
  return null;
}

/**
 * Peter Acklam's inverse-normal approximation. Planning A/B/n tests needs
 * critical values beyond the three common confidence presets because the live
 * decision engine Bonferroni-adjusts alpha across challengers.
 */
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

function twoSidedCriticalZ(confidenceLevel, comparisonCount = 1) {
  const confidence = Number(confidenceLevel) / 100;
  const comparisons = Math.max(1, Math.round(Number(comparisonCount) || 1));
  const alpha = Number.isFinite(confidence) && confidence > 0 && confidence < 1
    ? 1 - confidence
    : 0.1;
  return inverseStandardNormal(1 - alpha / comparisons / 2) || 1.6449;
}

export function shopDesignFromGuardrails(guardrails = {}) {
  const source =
    guardrails?.guardrails && typeof guardrails.guardrails === 'object'
      ? guardrails.guardrails
      : guardrails && typeof guardrails === 'object'
        ? guardrails
        : {};
  const confidenceLevel = Number(source.confidence_level) === 95 ? 95 : DEFAULT_CONFIDENCE_LEVEL;
  const mde = Number(source.mde_percent);
  const configuredPower = Number(source.statistical_power);
  const minConversions = Number(source.min_conversions_per_variation);
  return {
    confidenceLevel,
    mdePercent: Number.isFinite(mde) && mde >= 5 && mde <= 20 ? mde : DEFAULT_MDE_PERCENT,
    power: configuredPower === 90 ? 90 : DEFAULT_POWER,
    significanceLevel: confidenceLevel / 100,
    minConversions:
      Number.isFinite(minConversions) && minConversions >= ABSOLUTE_MIN_CONVERSIONS_PER_VARIATION
        ? Math.round(minConversions)
        : DEFAULT_MIN_CONVERSIONS_PER_VARIATION,
  };
}

function asConfidenceFraction(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n > 1 && n <= 100) return n / 100;
  if (n <= 1) return n;
  return null;
}

/** Prefer plan-stamped stats, then shop Settings, then 90% / 10% lift. */
export function stampStatisticalFields(plan = {}, shopGuardrails = {}) {
  const shop = shopDesignFromGuardrails(shopGuardrails);
  const goal = plan.goal && typeof plan.goal === 'object' ? plan.goal : {};
  const design =
    plan.statistical_design && typeof plan.statistical_design === 'object'
      ? plan.statistical_design
      : {};
  const significanceLevel =
    asConfidenceFraction(goal.significance_level) ||
    asConfidenceFraction(design.confidence_level) ||
    shop.significanceLevel;
  const confidenceLevel = Math.round(significanceLevel * 100) === 95 ? 95 : DEFAULT_CONFIDENCE_LEVEL;
  const mde = Number(goal.mde_percent ?? design.mde_percent);
  const power = Number(goal.statistical_power ?? design.statistical_power);
  return {
    analysis_method: goal.analysis_method || design.analysis_method || 'sequential',
    mde_percent: Number.isFinite(mde) && mde >= 5 && mde <= 20 ? mde : shop.mdePercent,
    statistical_power: Number.isFinite(power) && power > 0 ? power : shop.power,
    significance_level: significanceLevel,
    confidence_level: confidenceLevel,
  };
}

export function inferBaselineConversionRate(row = {}) {
  const source = row && typeof row === 'object' ? row : {};
  const baselineSource = String(
    source.baseline_source ?? source.statistical_design?.baseline_source ?? ''
  )
    .trim()
    .toLowerCase();
  if (
    baselineSource &&
    !['experiment_conversion', 'converting_sessions', 'unique_purchasers_per_session'].includes(
      baselineSource
    )
  ) {
    return null;
  }
  const direct = Number(
    source.baseline_conversion_rate ??
      source.baselineConversionRate ??
      source.statistical_design?.baseline_conversion_rate
  );
  if (Number.isFinite(direct) && direct > 0 && direct < 1) return direct;
  const visitors30 = Number(source.visitors_30d);
  const units = Number(source.units_sold_30d);
  if (Number.isFinite(visitors30) && visitors30 > 0 && Number.isFinite(units) && units > 0) {
    const rate = units / visitors30;
    if (rate > 0 && rate < 1) return rate;
  }
  return null;
}

/**
 * Casagrande-Pike two-proportion sample size without continuity correction — the
 * consensus default for a fixed-horizon A/B planning reference. Live decisions
 * use a separate evidence process; this formula estimates traffic commitment.
 * Pooled variance under H0, unpooled under H1:
 *
 *   n = (z(1-α/2)·√(2p̄q̄) + z(1-β)·√(p₁q₁ + p₂q₂))² / (p₂ - p₁)²
 *
 * `mdePercent` is a *relative* lift, so p₂ = p₁(1 + mde/100).
 */
export function computeVisitorsPerVariant({
  baselineConversionRate = 0.02,
  mdePercent = DEFAULT_MDE_PERCENT,
  confidenceLevel = DEFAULT_CONFIDENCE_LEVEL,
  power = DEFAULT_POWER,
  comparisonCount = 1,
} = {}) {
  const p1 = Number(baselineConversionRate);
  const effect = Number(mdePercent) / 100;
  if (!Number.isFinite(p1) || p1 <= 0 || p1 >= 1 || !(effect > 0)) return null;
  const p2 = p1 * (1 + effect);
  if (!Number.isFinite(p2) || p2 >= 1) return null;
  const delta = p2 - p1;
  if (delta <= 0) return null;

  const zAlpha = twoSidedCriticalZ(confidenceLevel, comparisonCount);
  const zBeta = Z_BETA[Number(power)] || Z_BETA[80];
  const pBar = (p1 + p2) / 2;
  const seNull = Math.sqrt(2 * pBar * (1 - pBar));
  const seAlt = Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2));
  const n = ((zAlpha * seNull + zBeta * seAlt) / delta) ** 2;
  return Number.isFinite(n) ? Math.ceil(n) : null;
}

/**
 * Inverse of `computeVisitorsPerVariant`: the smallest relative lift a fixed
 * sample can resolve. Reporting this is the standard way to answer "is my
 * traffic enough?" when the sample size is the constraint rather than the goal.
 * Required n falls monotonically as the lift grows, so bisect on the lift.
 */
export function detectableLiftPercent({
  visitorsPerVariant = 0,
  baselineConversionRate = null,
  confidenceLevel = DEFAULT_CONFIDENCE_LEVEL,
  power = DEFAULT_POWER,
  comparisonCount = 1,
} = {}) {
  const n = Number(visitorsPerVariant);
  const p1 = Number(baselineConversionRate);
  if (!Number.isFinite(n) || n < 1) return null;
  if (!Number.isFinite(p1) || p1 <= 0 || p1 >= 1) return null;

  const requiredFor = lift =>
    computeVisitorsPerVariant({
      baselineConversionRate: p1,
      mdePercent: lift,
      confidenceLevel,
      power,
      comparisonCount,
    });

  // p₂ must stay below 1, which caps how large a relative lift can be modelled.
  let hi = Math.min(1000, 100 * (1 / p1 - 1) * 0.99);
  let lo = 0.01;
  const atCeiling = requiredFor(hi);
  if (atCeiling === null || atCeiling > n) return null;

  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    const need = requiredFor(mid);
    if (need !== null && need <= n) hi = mid;
    else lo = mid;
  }
  return Math.round(hi * 10) / 10;
}

/**
 * A conversion floor is expressed in orders, but traffic planning is expressed
 * in visitors, so translate it through the baseline rate. Returns null when no
 * measured baseline exists — inventing one would put a fake number on the
 * review step.
 */
export function visitorsForConversionFloor(minConversions, baselineConversionRate) {
  const conversions = Number(minConversions);
  const rate = Number(baselineConversionRate);
  if (!Number.isFinite(conversions) || conversions < 1) return null;
  if (!Number.isFinite(rate) || rate <= 0 || rate >= 1) return null;
  return Math.ceil(conversions / rate);
}

export function resolveSampleSizePolicy({
  merchantMin = 5000,
  minConversions = null,
  baselineConversionRate = null,
  mdePercent = DEFAULT_MDE_PERCENT,
  confidenceLevel = DEFAULT_CONFIDENCE_LEVEL,
  power = DEFAULT_POWER,
  storedRecommended = null,
  comparisonCount = 1,
} = {}) {
  const floor = firstPositiveInt(merchantMin) || 5000;
  // Recompute whenever a baseline is available. Persisted recommendations may
  // have been produced by an older formula, confidence setting, or arm count.
  const computedRecommended = computeVisitorsPerVariant({
      baselineConversionRate,
      mdePercent,
      confidenceLevel,
      power,
      comparisonCount,
    });
  const recommended = computedRecommended || firstPositiveInt(storedRecommended);
  // Results are gated on conversions per variation as well as visitors, so the
  // earliest a call can happen is whichever floor takes longer to reach.
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
    floorLimitedBy: conversionFloorVisitors && conversionFloorVisitors > floor ? 'conversions' : 'visitors',
    recommendedPerVariant: recommended || null,
    planningPerVariant: planning,
    detectableLiftAtFloorPercent: detectableLiftPercent({
      visitorsPerVariant: earliest,
      baselineConversionRate,
      confidenceLevel,
      power,
      comparisonCount,
    }),
    mdePercent: Number(mdePercent) || DEFAULT_MDE_PERCENT,
    confidenceLevel: Number(confidenceLevel) || DEFAULT_CONFIDENCE_LEVEL,
    statisticalPower: Number(power) || DEFAULT_POWER,
    comparisonCount: Math.max(1, Math.round(Number(comparisonCount) || 1)),
    recommendationSource: computedRecommended ? 'computed' : recommended ? 'stored' : null,
    baselineConversionRate: Number(baselineConversionRate) || null,
    powerRating: !recommended
      ? 'insufficient_data'
      : earliest < recommended
        ? 'underpowered'
        : 'adequate',
  };
}
