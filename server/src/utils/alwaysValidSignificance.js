/**
 * Sequential directional evidence (mixture-SPRT approximation).
 *
 * Mixture prior on the effect is N(0, τ²) with τ calibrated to the absolute MDE
 * (Johari et al. 2015/2019; Optimizely Stats Engine).
 *
 * IMPORTANT: variance is estimated from accumulating aggregates, and value
 * metrics model each visitor as Bernoulli(p) times a constant order value
 * rather than using event-level second moments. That proxy omits the spread of
 * order values among buyers, so it understates variance when order sizes vary —
 * the optimistic direction. This module must not authorize automatic catalog
 * writes until a validated e-process or confidence sequence replaces it.
 */

const { isSmartPricingTest } = require('../services/smartPricing/smartPricingTestIdentity');

const DEFAULT_MDE_PERCENT = 10;
const DEFAULT_BASELINE_RATE = 0.02;
const SMART_PRICING_DEFAULT_CONFIDENCE = 0.9;

function asPositive(raw, fallback = 0) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Returns the value only when it is a usable positive number, else null. */
function positiveOrNull(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function clamp01(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.min(0.999, Math.max(0, n));
}

function inferPrimaryFamily(goal = {}) {
  const key = String(goal.primary_metric || goal.metric || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (key === 'profit_per_visitor' || key === 'ppv') return 'profit';
  if (
    key === 'revenue_per_visitor' ||
    key === 'rpv' ||
    key === 'revenue' ||
    key === 'aov' ||
    key === 'average_order_value'
  ) {
    return 'revenue';
  }
  return 'conversion';
}

function variantMean(variant, family) {
  if (family === 'profit') return Number(variant?.profitPerVisitor) || 0;
  if (family === 'revenue') return Number(variant?.revenuePerVisitor) || 0;
  const visitors = asPositive(variant?.visitors);
  const conversions = Number(variant?.conversions) || 0;
  return visitors > 0 ? conversions / visitors : 0;
}

function pooledRate(a, b) {
  const n = asPositive(a?.visitors) + asPositive(b?.visitors);
  const x = (Number(a?.conversions) || 0) + (Number(b?.conversions) || 0);
  return n > 0 ? x / n : 0;
}

function familyRevenue(variant) {
  const direct = Number(variant?.revenue);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const visitors = asPositive(variant?.visitors);
  const rpv = Number(variant?.revenuePerVisitor) || 0;
  return visitors * rpv;
}

function familyProfit(variant) {
  const direct = Number(variant?.profit);
  if (Number.isFinite(direct)) return direct;
  const visitors = asPositive(variant?.visitors);
  const ppv = Number(variant?.profitPerVisitor) || 0;
  return visitors * ppv;
}

/**
 * What one order is worth in the units the test is measured in.
 *
 * The variance proxy below scales visitor-level variance by this, so a profit
 * test has to use profit per order. It used revenue per order for both value
 * families, which inflated a profit test's variance by roughly the inverse
 * margin squared and made it ask for several times the traffic its own numbers
 * justify.
 */
function pooledValuePerOrder(a, b, family) {
  const x = (Number(a?.conversions) || 0) + (Number(b?.conversions) || 0);
  if (!(x > 0)) return 0;
  const total = family === 'profit' ? familyProfit(a) + familyProfit(b) : familyRevenue(a) + familyRevenue(b);
  return total / x;
}

function observationVariance(a, b, family) {
  const p = clamp01(pooledRate(a, b));
  if (family === 'conversion') return Math.max(p * (1 - p), 1e-12);
  // Magnitude, not signed value: a test price selling $5 below cost varies as
  // much per order as one earning $5, and variance is the square either way.
  const perOrder = Math.abs(pooledValuePerOrder(a, b, family));
  if (!(perOrder > 0)) return Math.max(p * (1 - p), 1e-12);
  return Math.max(p * (1 - p) * perOrder * perOrder, 1e-12);
}

function absoluteMde({ family, baselineRate, baselineMean, mdePercent }) {
  const rel = asPositive(mdePercent, DEFAULT_MDE_PERCENT) / 100;
  if (family === 'conversion') {
    const p = clamp01(baselineRate || DEFAULT_BASELINE_RATE);
    return Math.max(p * rel, 1e-6);
  }
  const mean = asPositive(baselineMean);
  if (mean > 0) return Math.max(mean * rel, 1e-6);
  const p = clamp01(baselineRate || DEFAULT_BASELINE_RATE);
  return Math.max(p * rel, 1e-6);
}

/**
 * log Λ_n for a normal mean with N(0, τ²) mixture (two-sided via |S|).
 * Λ = sqrt(σ² / (σ² + nτ²)) * exp(S² τ² / (2σ²(σ² + nτ²)))
 */
function logMixtureLambda(nEff, delta, sigma2, tau2) {
  const n = asPositive(nEff);
  const variance = asPositive(sigma2);
  const mix = asPositive(tau2);
  if (!(n > 0) || !(variance > 0) || !(mix > 0)) return 0;
  const denom = variance + n * mix;
  if (!(denom > 0)) return 0;
  const sum = n * Number(delta);
  return 0.5 * Math.log(variance / denom) + (sum * sum * mix) / (2 * variance * denom);
}

function alwaysValidPValue(logLambda) {
  if (!Number.isFinite(logLambda) || logLambda <= 0) return 1;
  const p = Math.exp(-logLambda);
  return Math.min(1, Math.max(Number.MIN_VALUE, p));
}

function twoSampleAlwaysValid(control, challenger, options = {}) {
  const family = options.family || 'conversion';
  const n1 = asPositive(control?.visitors);
  const n2 = asPositive(challenger?.visitors);
  const nEff = n1 > 0 && n2 > 0 ? (n1 * n2) / (n1 + n2) : 0;
  const mean1 = variantMean(control, family);
  const mean2 = variantMean(challenger, family);
  const delta = mean2 - mean1;
  const sigma2 = observationVariance(control, challenger, family);
  // A designed baseline is only usable when it is a real number. `!= null` let
  // NaN through, and NaN then fell all the way back to the 2% default rate,
  // which mis-calibrates the mixture prior for any product that does not happen
  // to convert at 2% and makes the test far too slow to call a genuine win.
  const baselineRate = positiveOrNull(options.baselineRate) ?? pooledRate(control, challenger);
  const baselineMean = positiveOrNull(options.baselineMean) ?? (mean1 + mean2) / 2;
  const tau = absoluteMde({
    family,
    baselineRate,
    baselineMean,
    mdePercent: options.mdePercent,
  });
  const logLambda = logMixtureLambda(nEff, delta, sigma2, tau * tau);
  const pValue = alwaysValidPValue(logLambda);
  const alpha = asPositive(options.alpha, 0.05);
  return {
    family,
    nEff,
    delta,
    logLambda,
    lambda: Number.isFinite(logLambda) ? Math.exp(logLambda) : 1,
    pValue,
    significant: pValue < alpha,
    winner: pValue < alpha ? (delta > 0 ? 'challenger' : delta < 0 ? 'control' : null) : null,
  };
}

function asConfidenceFraction(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n > 1 && n <= 100) return n / 100;
  if (n <= 1) return n;
  return null;
}

/** Confidence as a fraction. Smart Pricing defaults to 90%, not the legacy 95% settings bound. */
function resolveAnalysisConfidence(goal = {}, test = {}, fallback = 0.95) {
  const fromGoal = asConfidenceFraction(goal?.significance_level);
  if (fromGoal) return fromGoal;
  const design = test?.metadata?.statistical_design || test?.statistical_design;
  const fromDesign = asConfidenceFraction(design?.confidence_level);
  if (fromDesign) return fromDesign;
  if (shouldUseSequentialDecision(goal, test)) return SMART_PRICING_DEFAULT_CONFIDENCE;
  return asConfidenceFraction(fallback) || 0.95;
}

function shouldUseSequentialDecision(goal = {}, test = {}) {
  const method = String(goal?.analysis_method || test?.goal?.analysis_method || '')
    .trim()
    .toLowerCase();
  if (method === 'sequential' || method === 'msprt' || method === 'always_valid') return true;
  const designMethod = String(test?.metadata?.statistical_design?.analysis_method || '')
    .trim()
    .toLowerCase();
  if (designMethod === 'sequential' || designMethod === 'msprt' || designMethod === 'always_valid') {
    return true;
  }
  if (Number(goal?.visitors_per_variant_recommended) > 0) return true;
  return isSmartPricingTest(test);
}

function applyAlwaysValidDecision(significance, variants = [], options = {}) {
  const rows = Array.isArray(variants) ? variants.filter(row => asPositive(row?.visitors) > 0) : [];
  const base = significance && typeof significance === 'object' ? { ...significance } : {};
  if (rows.length < 2) {
    return {
      ...base,
      method: 'msprt',
      sequential: true,
      significant: false,
      winner: null,
      winnerVariantId: null,
      message: base.message || 'Insufficient data',
    };
  }

  const family = inferPrimaryFamily(options.goal || {});
  const alpha = asPositive(options.alpha, 0.05);
  const mdePercent = asPositive(options.mdePercent ?? options.goal?.mde_percent, DEFAULT_MDE_PERCENT);
  const control = rows[0];
  const challengers = rows.slice(1);
  const pairAlpha = challengers.length > 1 ? alpha / challengers.length : alpha;
  const pairs = challengers.map(challenger => ({
    challenger,
    result: twoSampleAlwaysValid(control, challenger, {
      family,
      alpha: pairAlpha,
      mdePercent,
      baselineRate: options.baselineRate,
      baselineMean: options.baselineMean,
    }),
  }));

  const crossed = pairs
    .filter(row => row.result.significant && row.result.winner === 'challenger')
    .sort((a, b) => Math.abs(b.result.delta) - Math.abs(a.result.delta));
  const controlPairs = pairs.filter(
    row => row.result.significant && row.result.winner === 'control'
  );
  const bestPair = pairs.slice().sort((a, b) => a.result.pValue - b.result.pValue)[0];
  const winnerPair = crossed[0] || null;
  const pValue = winnerPair?.result.pValue ?? bestPair?.result.pValue ?? 1;
  const significant = Boolean(winnerPair);
  const winnerVariantId = winnerPair?.challenger?.id || null;
  // Every challenger must lose with a sequential call. One inconclusive arm keeps the product running.
  const controlWin = !significant && pairs.length > 0 && controlPairs.length === pairs.length;

  return {
    ...base,
    fixedHorizon: {
      significant: base.significant === true,
      pValue: base.pValue,
      confidence: base.confidence,
      winner: base.winner,
      method: base.method || null,
    },
    method: 'msprt',
    sequential: true,
    evidenceValidated: false,
    evidenceValidity:
      family === 'conversion' ? 'estimated_variance' : 'value_metric_variance_proxy',
    family,
    mdePercent,
    pValue: Math.round(pValue * 10000) / 10000,
    confidence: Math.round((1 - pValue) * 10000) / 100,
    significant,
    controlWin,
    winner: significant ? (rows.length === 2 ? 'variantB' : 'best') : null,
    winnerVariantId,
    bestVariantId: winnerVariantId || bestPair?.challenger?.id || null,
    lambda: winnerPair?.result.lambda ?? bestPair?.result.lambda ?? null,
    message: significant
      ? null
      : controlWin
        ? 'Control is winning — the catalog price is stronger than every variation.'
        : 'Collecting data — sequential testing needs stronger evidence than a one-look z-test.',
    pairwise: pairs.map(row => ({
      variantId: row.challenger.id || null,
      variantName: row.challenger.name || null,
      pValue: row.result.pValue,
      significant: row.result.significant,
      winner: row.result.winner,
      delta: row.result.delta,
    })),
  };
}

module.exports = {
  DEFAULT_MDE_PERCENT,
  inferPrimaryFamily,
  logMixtureLambda,
  alwaysValidPValue,
  twoSampleAlwaysValid,
  applyAlwaysValidDecision,
  shouldUseSequentialDecision,
  resolveAnalysisConfidence,
  asConfidenceFraction,
  SMART_PRICING_DEFAULT_CONFIDENCE,
  absoluteMde,
};
