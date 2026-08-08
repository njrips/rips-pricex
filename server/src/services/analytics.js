/**
 * Analytics Service
 *
 * Handles analytics calculations for AB tests:
 * - Conversion rates
 * - Statistical significance
 * - Revenue impact
 * - Confidence intervals
 */

const { query } = require('../utils/database');
const {
  getTestAnalytics,
  getSecondaryEventMetrics,
  getEventCollectionStats,
  getCheckoutEventBreakdown,
} = require('../models/analytics');
const { getTestById } = require('../models/test');
const { STATISTICAL_THRESHOLD, SETTINGS_BOUNDS } = require('../constants');
const { getCheckoutPhaseFromTest } = require('../utils/checkoutPhases');
const { parseGoalConfig } = require('../utils/goalConfig');

const CHECKOUT_SECTION_EVENT_NAMES = Object.freeze([
  'checkout_section_impression',
  'checkout_section_cta_click',
  'checkout_section_offer_apply',
  'checkout_product_impression',
  'checkout_product_click',
  'checkout_product_add_attempt',
  'checkout_product_add_success',
  'checkout_product_add_failed',
]);
const CHECKOUT_PHASE_EVENT_NAMES = Object.freeze([
  'checkout_phase_impression',
  'checkout_phase_cta_click',
  'checkout_phase_offer_apply',
  'checkout_phase_conversion',
  'checkout_runtime_diagnostic',
]);
const CHECKOUT_PAYMENT_EVENT_NAMES = Object.freeze([
  'checkout_payment_method_action',
  'checkout_customization_match',
]);
const CHECKOUT_DELIVERY_EVENT_NAMES = Object.freeze([
  'checkout_delivery_method_action',
  'checkout_customization_match',
]);

function normalizeAnalyticsEventName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100);
}

function getVariantIdentity(variant = {}) {
  return variant.id ?? variant.variant_id ?? variant.name ?? null;
}

function resolveControlVariantId(test = {}, variants = []) {
  const configuredVariants = Array.isArray(test?.variants) ? test.variants : [];
  const configuredControl =
    configuredVariants.find(variant => variant?.is_control || variant?.isControl) ||
    configuredVariants.find(variant => String(variant?.name || '').toLowerCase() === 'control') ||
    configuredVariants[0];
  const configuredId = getVariantIdentity(configuredControl);
  if (configuredId !== null && configuredId !== undefined) {
    return String(configuredId);
  }
  const dataControl = variants.find(
    variant => String(variant?.name || '').toLowerCase() === 'control'
  );
  return dataControl?.id ?? variants[0]?.id ?? null;
}

function orderVariantsForComparison(variants = [], test = {}) {
  const configuredVariants = Array.isArray(test?.variants) ? test.variants : [];
  const configuredOrder = new Map();
  configuredVariants.forEach((variant, index) => {
    const identity = getVariantIdentity(variant);
    if (identity !== null && identity !== undefined) {
      configuredOrder.set(String(identity), index);
    }
    if (variant?.name) {
      configuredOrder.set(String(variant.name), index);
    }
  });
  const controlId = resolveControlVariantId(test, variants);
  return [...variants].sort((a, b) => {
    if (controlId && String(a.id) === String(controlId)) {
      return -1;
    }
    if (controlId && String(b.id) === String(controlId)) {
      return 1;
    }
    const aOrder = configuredOrder.get(String(a.id)) ?? configuredOrder.get(String(a.name)) ?? 999;
    const bOrder = configuredOrder.get(String(b.id)) ?? configuredOrder.get(String(b.name)) ?? 999;
    return aOrder - bOrder;
  });
}

function toPercent(numerator, denominator) {
  const top = Number(numerator) || 0;
  const bottom = Number(denominator) || 0;
  return bottom > 0 ? (top / bottom) * 100 : 0;
}

function getEventCountForVariant(variant = {}, eventName) {
  return Number(variant.checkoutSectionEvents?.[eventName]?.count) || 0;
}

function buildCheckoutJourneyStep(id, label, eventName, variants = []) {
  const variantRows = variants.map(variant => {
    const visitors = Number(variant.visitors) || 0;
    const count = getEventCountForVariant(variant, eventName);
    return {
      variantId: variant.id,
      variantName: variant.name,
      count,
      rate: toPercent(count, visitors),
    };
  });
  const total = variantRows.reduce((sum, row) => sum + row.count, 0);
  const leader = variantRows.reduce((best, row) => {
    if (!best) {
      return row;
    }
    return row.rate > best.rate ? row : best;
  }, null);
  return {
    id,
    label,
    eventName,
    total,
    leader,
    variants: variantRows,
  };
}

function addVariantEventCount(target, variantId, variantName, eventName, count) {
  if (!variantId) {
    return;
  }
  if (!target.variants[variantId]) {
    target.variants[variantId] = {
      variantId,
      variantName: variantName || variantId,
      impressions: 0,
      ctaClicks: 0,
      offerApplies: 0,
    };
  }
  if (eventName === 'checkout_section_impression') {
    target.variants[variantId].impressions += count;
  } else if (eventName === 'checkout_section_cta_click') {
    target.variants[variantId].ctaClicks += count;
  } else if (eventName === 'checkout_section_offer_apply') {
    target.variants[variantId].offerApplies += count;
  }
}

function buildCheckoutAdvancedOutput({
  checkoutPhase,
  checkoutSectionEventNames,
  variants,
  checkoutEventBreakdown,
}) {
  if (!checkoutSectionEventNames.length) {
    return null;
  }

  const variantNames = new Map(variants.map(variant => [String(variant.id), variant.name]));
  const sectionGroups = new Map();
  const productGroups = new Map();
  const diagnosticGroups = new Map();
  const methodActionGroups = new Map();

  (checkoutEventBreakdown || []).forEach(row => {
    const eventName = row.eventName;
    const count = Number(row.uniqueUsers) || Number(row.totalEvents) || 0;
    const variantId = row.variantId ? String(row.variantId) : '';
    const variantName = variantNames.get(variantId) || variantId;

    if (eventName && eventName.startsWith('checkout_section_')) {
      const sectionId = row.checkoutSectionId || 'unknown-section';
      const sectionType = row.checkoutSectionType || 'checkout_section';
      const key = `${sectionId}:${sectionType}`;
      if (!sectionGroups.has(key)) {
        sectionGroups.set(key, {
          sectionId,
          sectionType,
          impressions: 0,
          ctaClicks: 0,
          offerApplies: 0,
          variants: {},
        });
      }
      const group = sectionGroups.get(key);
      if (eventName === 'checkout_section_impression') {
        group.impressions += count;
      } else if (eventName === 'checkout_section_cta_click') {
        group.ctaClicks += count;
      } else if (eventName === 'checkout_section_offer_apply') {
        group.offerApplies += count;
      }
      addVariantEventCount(group, variantId, variantName, eventName, count);
    }

    if (eventName && eventName.startsWith('checkout_product_')) {
      const productId = row.checkoutProductId || row.checkoutMerchandiseId || 'unknown-product';
      const sectionId = row.checkoutSectionId || 'unknown-section';
      const key = `${sectionId}:${productId}:${row.checkoutProductAnalyticsKey || ''}`;
      if (!productGroups.has(key)) {
        productGroups.set(key, {
          productId,
          merchandiseId: row.checkoutMerchandiseId || null,
          analyticsKey: row.checkoutProductAnalyticsKey || null,
          sectionId,
          sectionType: row.checkoutSectionType || 'product_list',
          sourceMode: row.checkoutProductSourceMode || 'manual',
          strategy: row.checkoutProductStrategy || '',
          action: row.checkoutProductAction || 'display_only',
          rank: row.checkoutProductRank || null,
          impressions: 0,
          clicks: 0,
          addAttempts: 0,
          addSuccesses: 0,
          addFailures: 0,
          failureReasons: {},
          variants: {},
        });
      }
      const group = productGroups.get(key);
      if (eventName === 'checkout_product_impression') {
        group.impressions += count;
      } else if (eventName === 'checkout_product_click') {
        group.clicks += count;
      } else if (eventName === 'checkout_product_add_attempt') {
        group.addAttempts += count;
      } else if (eventName === 'checkout_product_add_success') {
        group.addSuccesses += count;
      } else if (eventName === 'checkout_product_add_failed') {
        group.addFailures += count;
        const reason = row.checkoutProductFailureReason || 'add_failed';
        group.failureReasons[reason] = (group.failureReasons[reason] || 0) + count;
      }
      if (variantId) {
        group.variants[variantId] = group.variants[variantId] || {
          variantId,
          variantName,
          impressions: 0,
          clicks: 0,
          addAttempts: 0,
          addSuccesses: 0,
          addFailures: 0,
        };
        const variant = group.variants[variantId];
        if (eventName === 'checkout_product_impression') {
          variant.impressions += count;
        } else if (eventName === 'checkout_product_click') {
          variant.clicks += count;
        } else if (eventName === 'checkout_product_add_attempt') {
          variant.addAttempts += count;
        } else if (eventName === 'checkout_product_add_success') {
          variant.addSuccesses += count;
        } else if (eventName === 'checkout_product_add_failed') {
          variant.addFailures += count;
        }
      }
    }

    if (eventName === 'checkout_runtime_diagnostic') {
      const reason = row.diagnosticReason || 'runtime_diagnostic';
      if (!diagnosticGroups.has(reason)) {
        diagnosticGroups.set(reason, {
          reason,
          count: 0,
          variants: {},
          lastSeen: row.lastSeen || null,
        });
      }
      const group = diagnosticGroups.get(reason);
      group.count += Number(row.totalEvents) || count;
      if (variantId) {
        group.variants[variantId] =
          (group.variants[variantId] || 0) + (Number(row.totalEvents) || count);
      }
      if (row.lastSeen) {
        group.lastSeen = row.lastSeen;
      }
    }

    if (
      eventName === 'checkout_payment_method_action' ||
      eventName === 'checkout_delivery_method_action' ||
      eventName === 'checkout_customization_match'
    ) {
      const action = row.checkoutMethodAction || row.checkoutCustomizationType || 'matched';
      const key = `${eventName}:${action}`;
      if (!methodActionGroups.has(key)) {
        methodActionGroups.set(key, {
          eventName,
          action,
          count: 0,
          variants: {},
        });
      }
      const group = methodActionGroups.get(key);
      group.count += count;
      if (variantId) {
        group.variants[variantId] = (group.variants[variantId] || 0) + count;
      }
    }
  });

  const sectionPerformanceRows = Array.from(sectionGroups.values())
    .map(row => ({
      ...row,
      ctr: toPercent(row.ctaClicks, row.impressions),
      offerApplyRate: toPercent(row.offerApplies, row.impressions),
      variants: Object.values(row.variants).map(variant => ({
        ...variant,
        ctr: toPercent(variant.ctaClicks, variant.impressions),
        offerApplyRate: toPercent(variant.offerApplies, variant.impressions),
      })),
    }))
    .sort((a, b) => b.impressions - a.impressions || b.ctaClicks - a.ctaClicks);

  const productPerformanceRows = Array.from(productGroups.values())
    .map(row => ({
      ...row,
      clickRate: toPercent(row.clicks, row.impressions),
      addAttemptRate: toPercent(row.addAttempts, row.impressions),
      addSuccessRate: toPercent(row.addSuccesses, row.addAttempts),
      failureRate: toPercent(row.addFailures, row.addAttempts),
      variants: Object.values(row.variants).map(variant => ({
        ...variant,
        clickRate: toPercent(variant.clicks, variant.impressions),
        addSuccessRate: toPercent(variant.addSuccesses, variant.addAttempts),
      })),
    }))
    .sort((a, b) => b.impressions - a.impressions || b.addSuccesses - a.addSuccesses);

  const journeyEvents =
    checkoutPhase === 'payment_method'
      ? [
          ['phase_impression', 'Checkout Viewed', 'checkout_phase_impression'],
          ['customization_match', 'Customization Matched', 'checkout_customization_match'],
          ['payment_action', 'Payment Action', 'checkout_payment_method_action'],
          ['offer_apply', 'Offer Applied', 'checkout_phase_offer_apply'],
        ]
      : checkoutPhase === 'delivery_method'
        ? [
            ['phase_impression', 'Checkout Viewed', 'checkout_phase_impression'],
            ['customization_match', 'Customization Matched', 'checkout_customization_match'],
            ['delivery_action', 'Delivery Action', 'checkout_delivery_method_action'],
            ['offer_apply', 'Offer Applied', 'checkout_phase_offer_apply'],
          ]
        : [
            ['phase_impression', 'Checkout Viewed', 'checkout_phase_impression'],
            ['section_impression', 'Section Viewed', 'checkout_section_impression'],
            ['cta_click', 'CTA Clicked', 'checkout_section_cta_click'],
            ['offer_apply', 'Offer Applied', 'checkout_section_offer_apply'],
          ];

  return {
    phase: checkoutPhase,
    journeySteps: journeyEvents.map(([id, label, eventName]) =>
      buildCheckoutJourneyStep(id, label, eventName, variants)
    ),
    sectionPerformanceRows,
    productPerformanceRows,
    diagnostics: Array.from(diagnosticGroups.values()).sort((a, b) => b.count - a.count),
    methodActions: Array.from(methodActionGroups.values()).sort((a, b) => b.count - a.count),
    signalTotals: {
      totalCheckoutEvents: (checkoutEventBreakdown || []).reduce(
        (sum, row) => sum + (Number(row.totalEvents) || 0),
        0
      ),
      uniqueCheckoutSignals: checkoutSectionEventNames.length,
      sectionsTracked: sectionPerformanceRows.length,
      productsTracked: productPerformanceRows.length,
    },
  };
}

class AnalyticsService {
  /**
   * Calculate conversion rate
   *
   * @param {number} conversions - Number of conversions
   * @param {number} visitors - Number of visitors
   * @returns {number} Conversion rate as percentage
   */
  calculateConversionRate(conversions, visitors) {
    const v = Number(visitors) || 0;
    const c = Number(conversions) || 0;
    if (v <= 0 || !Number.isFinite(c)) {
      return 0;
    }
    return (c / v) * 100;
  }

  /**
   * Calculate statistical significance using Z-test or Fisher's exact (small samples)
   *
   * @param {Object} variantA - Control variant data
   * @param {Object} variantB - Test variant data
   * @param {Object} options - { significanceThreshold: 0.05 }
   * @returns {Object} Significance results
   */
  calculateSignificance(variantA, variantB, options = {}) {
    const n1 = Number(variantA?.visitors) || 0;
    const n2 = Number(variantB?.visitors) || 0;
    const x1 = Number(variantA?.conversions) || 0;
    const x2 = Number(variantB?.conversions) || 0;
    const threshold = Number(options.significanceThreshold) || STATISTICAL_THRESHOLD.P_VALUE;

    if (n1 <= 0 || n2 <= 0 || !Number.isFinite(x1) || !Number.isFinite(x2)) {
      return {
        significant: false,
        pValue: 1,
        confidence: 0,
        confidenceInterval: null,
        message: 'Insufficient data',
      };
    }

    const p1 = x1 / n1;
    const p2 = x2 / n2;
    const totalN = n1 + n2;
    const totalX = x1 + x2;
    const p = totalX / totalN;
    const q = 1 - p;

    // Use Fisher's exact for small samples (expected cell count < 5)
    const expectedMin = Math.min(n1 * p, n1 * q, n2 * p, n2 * q);
    const useFisher = totalN < 30 || expectedMin < 5;

    let pValue;
    if (useFisher) {
      pValue = this._fisherExactTwoTailed(x1, n1 - x1, x2, n2 - x2);
      pValue = Math.min(1, Math.max(0, pValue));
    } else {
      const se = Math.sqrt(p * q * (1 / n1 + 1 / n2));
      if (se === 0) {
        return {
          significant: false,
          pValue: 1,
          confidence: 0,
          confidenceInterval: null,
          message: 'Cannot calculate significance',
        };
      }
      const z = (p1 - p2) / se;
      pValue = 2 * (1 - this.normalCDF(Math.abs(z)));
    }

    const confidence = (1 - pValue) * 100;
    const significant = pValue < threshold;
    const lift = p1 > 0 ? ((p2 - p1) / p1) * 100 : 0;
    let winner = null;
    if (significant) {
      winner = p2 > p1 ? 'variantB' : 'variantA';
    }

    // Wilson score 95% confidence interval for lift (variantB vs variantA)
    const ciA = this._wilsonScoreInterval(x1, n1, 0.95);
    const ciB = this._wilsonScoreInterval(x2, n2, 0.95);

    return {
      significant,
      pValue: Math.round(pValue * 10000) / 10000,
      confidence: Math.round(confidence * 100) / 100,
      lift: Math.round(lift * 100) / 100,
      winner,
      zScore: !useFisher
        ? Math.round(((p1 - p2) / Math.sqrt(p * q * (1 / n1 + 1 / n2))) * 100) / 100
        : null,
      method: useFisher ? 'fisher' : 'ztest',
      confidenceInterval: {
        variantA: ciA,
        variantB: ciB,
      },
    };
  }

  /**
   * Fisher's exact test (two-tailed) for 2x2 contingency table
   * Hypergeometric distribution for a, b, c, d
   */
  _fisherExactTwoTailed(a, b, c, d) {
    const n = a + b + c + d;
    const r1 = a + b;
    const c1 = a + c;
    const minA = Math.max(0, r1 + c1 - n);
    const maxA = Math.min(r1, c1);

    let p = 0;
    const logChoose = (n, k) => {
      if (k < 0 || k > n) {
        return -Infinity;
      }
      let r = 0;
      for (let i = 0; i < k; i++) {
        r += Math.log(n - i) - Math.log(i + 1);
      }
      return r;
    };

    const prob = aVal => {
      const bVal = r1 - aVal;
      const cVal = c1 - aVal;
      const dVal = n - r1 - cVal;
      if (bVal < 0 || cVal < 0 || dVal < 0) {
        return 0;
      }
      return Math.exp(logChoose(r1, aVal) + logChoose(n - r1, cVal) - logChoose(n, c1));
    };

    const pObs = prob(a);
    for (let k = minA; k <= maxA; k++) {
      if (prob(k) <= pObs + 1e-10) {
        p += prob(k);
      }
    }
    return Math.min(1, p);
  }

  /**
   * Wilson score interval for proportion
   * @returns {{ low: number, high: number }} as percentage 0-100
   */
  _wilsonScoreInterval(x, n, conf = 0.95) {
    if (n <= 0) {
      return { low: 0, high: 0 };
    }
    const z = conf === 0.95 ? 1.96 : conf === 0.99 ? 2.576 : 1.96;
    const p = x / n;
    const denom = 1 + (z * z) / n;
    const center = (p + (z * z) / (2 * n)) / denom;
    const margin = (z / denom) * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
    return {
      low: Math.max(0, Math.round((center - margin) * 10000) / 100),
      high: Math.min(100, Math.round((center + margin) * 10000) / 100),
    };
  }

  /**
   * Normal cumulative distribution function approximation
   *
   * @param {number} z - Z-score
   * @returns {number} Cumulative probability
   */
  normalCDF(z) {
    // Approximation using error function
    return 0.5 * (1 + this.erf(z / Math.sqrt(2)));
  }

  /**
   * Error function approximation
   *
   * @param {number} x - Input value
   * @returns {number} Error function value
   */
  erf(x) {
    // Abramowitz and Stegun approximation
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);

    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

    return sign * y;
  }

  /**
   * Calculate revenue impact
   *
   * @param {Object} variantA - Control variant
   * @param {Object} variantB - Test variant
   * @returns {Object} Revenue impact
   */
  calculateRevenueImpact(variantA, variantB) {
    const revenueA = Number(variantA?.revenue) || 0;
    const revenueB = Number(variantB?.revenue) || 0;
    const visitorsA = Number(variantA?.visitors) || 0;
    const visitorsB = Number(variantB?.visitors) || 0;

    const rpvA = visitorsA > 0 && Number.isFinite(revenueA) ? revenueA / visitorsA : 0;
    const rpvB = visitorsB > 0 && Number.isFinite(revenueB) ? revenueB / visitorsB : 0;

    const impact = revenueB - revenueA;
    const impactPercent = revenueA > 0 ? (impact / revenueA) * 100 : 0;

    return {
      controlRevenue: revenueA,
      testRevenue: revenueB,
      impact: Math.round(impact * 100) / 100,
      impactPercent: Math.round(impactPercent * 100) / 100,
      revenuePerVisitor: {
        control: Math.round(rpvA * 100) / 100,
        test: Math.round(rpvB * 100) / 100,
      },
    };
  }

  _getBuiltInCheckoutEventNames(test = {}) {
    const type = String(test?.type || '')
      .trim()
      .toLowerCase();
    const checkoutPhase = getCheckoutPhaseFromTest(test);
    if (type !== 'checkout') {
      return [];
    }
    if (checkoutPhase === 'payment_method') {
      return [...CHECKOUT_PHASE_EVENT_NAMES, ...CHECKOUT_PAYMENT_EVENT_NAMES];
    }
    if (checkoutPhase === 'delivery_method') {
      return [...CHECKOUT_PHASE_EVENT_NAMES, ...CHECKOUT_DELIVERY_EVENT_NAMES];
    }
    return [...CHECKOUT_PHASE_EVENT_NAMES, ...CHECKOUT_SECTION_EVENT_NAMES];
  }

  _buildCheckoutAdvancedOutput(input = {}) {
    return buildCheckoutAdvancedOutput(input);
  }

  /**
   * Sample Ratio Mismatch (SRM) detection
   * Detects if observed traffic split deviates significantly from expected allocation.
   * SRM indicates data quality issues (e.g. bot traffic, tracking bugs, assignment skew).
   *
   * @param {Array} variants - Variants with visitors and allocation
   * @param {number} totalVisitors - Total visitors across all variants
   * @returns {Object} { detected: boolean, pValue: number, chiSquare: number, message?: string }
   */
  detectSampleRatioMismatch(variants, totalVisitors) {
    if (!variants || variants.length < 2 || totalVisitors < 100) {
      return { detected: false, pValue: 1, chiSquare: 0 };
    }

    let chiSquare = 0;
    const df = variants.length - 1;

    for (const v of variants) {
      const observed = v.visitors || 0;
      const expectedPercent = (v.allocation || 0) / 100;
      const expected = totalVisitors * expectedPercent;
      if (expected > 0) {
        chiSquare += Math.pow(observed - expected, 2) / expected;
      }
    }

    // Chi-square to p-value (approximation for df=1,2,...)
    const pValue = this._chiSquareToPValue(chiSquare, df);
    const detected = pValue < 0.001; // Industry standard threshold for SRM

    return {
      detected,
      pValue: Math.round(pValue * 10000) / 10000,
      chiSquare: Math.round(chiSquare * 100) / 100,
      message: detected
        ? 'Sample ratio mismatch detected. Traffic split deviates from expected—check for tracking issues or bot traffic.'
        : null,
    };
  }

  /**
   * Multi-variant significance (chi-square test + pairwise winner)
   * For A/B/C tests: chi-square for homogeneity, then pairwise vs control for winner
   *
   * @param {Array} variants - All variants with visitors, conversions
   * @param {Object} options - { significanceThreshold: 0.05 }
   * @returns {Object} Significance results
   */
  calculateMultiVariantSignificance(variants, options = {}) {
    const threshold = Number(options.significanceThreshold) || STATISTICAL_THRESHOLD.P_VALUE;
    if (!variants || variants.length < 2) {
      return {
        significant: false,
        pValue: 1,
        confidence: 0,
        method: 'chi2',
        message: 'Insufficient data',
      };
    }

    const totalN = variants.reduce((s, v) => s + (Number(v.visitors) || 0), 0);
    const totalX = variants.reduce((s, v) => s + (Number(v.conversions) || 0), 0);
    const pPooled = totalN > 0 ? totalX / totalN : 0;

    if (totalN <= 0 || !Number.isFinite(pPooled)) {
      return {
        significant: false,
        pValue: 1,
        confidence: 0,
        method: 'chi2',
        message: 'Insufficient data',
      };
    }

    // Chi-square test for homogeneity (2xk contingency: converted vs not, by variant)
    let chiSquare = 0;
    for (const v of variants) {
      const n = Number(v.visitors) || 0;
      const x = Number(v.conversions) || 0;
      if (n <= 0) {
        continue;
      }
      const expectedConverted = n * pPooled;
      const expectedNot = n * (1 - pPooled);
      if (expectedConverted > 0.5) {
        chiSquare += Math.pow(x - expectedConverted, 2) / expectedConverted;
      }
      if (expectedNot > 0.5) {
        chiSquare += Math.pow(n - x - expectedNot, 2) / expectedNot;
      }
    }

    const df = Math.max(1, variants.length - 1);
    const pValue = this._chiSquareToPValue(chiSquare, df);
    const significant = pValue < threshold;

    // Winner: best conversion rate; if significant, compare best vs control (variant 0)
    const control = variants[0];
    const sorted = [...variants].sort((a, b) => {
      const rateA = (a.visitors || 0) > 0 ? (a.conversions || 0) / a.visitors : 0;
      const rateB = (b.visitors || 0) > 0 ? (b.conversions || 0) / b.visitors : 0;
      return rateB - rateA;
    });
    const best = sorted[0];
    let winner = null;
    let pairwisePValue = null;

    if (significant && best && control && best.id !== control.id) {
      const pairSig = this.calculateSignificance(control, best, {
        significanceThreshold: threshold,
      });
      pairwisePValue = pairSig.pValue;
      if (pairSig.significant && pairSig.winner === 'variantB') {
        winner = 'best';
      }
    }

    const confidence = (1 - pValue) * 100;
    const controlRate =
      (control?.visitors || 0) > 0 ? ((control?.conversions || 0) / control.visitors) * 100 : 0;
    const bestRate =
      (best?.visitors || 0) > 0 ? ((best?.conversions || 0) / best.visitors) * 100 : 0;
    const lift = controlRate > 0 ? ((bestRate - controlRate) / controlRate) * 100 : 0;

    return {
      significant,
      pValue: Math.round(pValue * 10000) / 10000,
      confidence: Math.round(confidence * 100) / 100,
      lift: Math.round(lift * 100) / 100,
      winner: winner === 'best' ? 'best' : null,
      winnerVariantId: winner === 'best' ? best?.id : null,
      bestVariantId: best?.id ?? null,
      method: 'chi2',
      comparisonGuidance:
        variants.length > 2
          ? 'Global chi-square is used for multi-variant evidence. Pairwise winner reads are exploratory unless you apply multiplicity control or a fixed-horizon decision rule.'
          : null,
      multiplicity: {
        applies: variants.length > 2,
        correctionApplied: false,
        recommendation:
          variants.length > 2
            ? 'Use this as a screening signal, then validate the winning variant against control before promotion.'
            : null,
      },
      chiSquare: Math.round(chiSquare * 100) / 100,
      pairwisePValue,
      confidenceInterval: null,
    };
  }

  /**
   * Chi-square to p-value (upper tail P(X > chiSquare))
   * For df=1: chiSquare = z^2, so p = 2*(1 - normCDF(sqrt(chiSquare)))
   * For df>1: Wilson-Hilferty approximation
   */
  _chiSquareToPValue(chiSquare, df) {
    if (chiSquare <= 0 || df <= 0) {
      return 1;
    }
    if (df === 1) {
      const z = Math.sqrt(chiSquare);
      return 2 * (1 - this.normalCDF(z));
    }
    // Wilson-Hilferty: (chiSquare/df)^(1/3) ~ N(1-2/(9*df), 2/(9*df))
    const u = Math.pow(chiSquare / df, 1 / 3);
    const mu = 1 - 2 / (9 * df);
    const sigma = Math.sqrt(2 / (9 * df));
    const z = (u - mu) / sigma;
    return 1 - this.normalCDF(z);
  }

  /**
   * Extract secondary event names from goal config (backward compatible)
   *
   * @param {Object} goal - Test goal config
   * @returns {string[]} Event names
   */
  _getSecondaryEventNames(goal) {
    if (!goal || typeof goal !== 'object') {
      return [];
    }
    if (Array.isArray(goal.secondary)) {
      return goal.secondary
        .map(s => normalizeAnalyticsEventName(s?.event_name || s?.eventName))
        .filter(Boolean);
    }
    return [];
  }

  /**
   * Get comprehensive analytics for a test
   *
   * @param {string} testId - Test ID
   * @param {string} shopDomain - Shop domain
   * @param {Object} options - Optional segment filters: { device, country }
   * @returns {Promise<Object>} Complete analytics
   */
  async getTestAnalytics(testId, shopDomain, options = {}) {
    // Fetch test first for goal config (conversion window, conversion URL, secondary events)
    let test = null;
    try {
      test = await getTestById(testId, shopDomain);
    } catch {
      // Ignore
    }

    const goal = parseGoalConfig(test?.goal);
    const conversionWindowDays =
      options.conversionWindowDays ?? goal.conversion_window_days ?? null;
    const conversionUrl = options.conversionUrl ?? goal.conversion_url ?? null;

    const rawData = await getTestAnalytics(testId, shopDomain, {
      ...options,
      conversionWindowDays: conversionWindowDays || null,
      conversionUrl:
        conversionUrl && String(conversionUrl).trim() ? String(conversionUrl).trim() : null,
    });

    const secondaryEventNames = goal ? this._getSecondaryEventNames(goal) : [];
    const checkoutSectionEventNames = this._getBuiltInCheckoutEventNames(test);
    const eventNamesForMetrics = Array.from(
      new Set([...secondaryEventNames, ...checkoutSectionEventNames])
    );
    let eventMetrics = {};
    let secondaryEventStats = {};
    let checkoutEventBreakdown = [];
    if (eventNamesForMetrics.length > 0) {
      [eventMetrics, secondaryEventStats, checkoutEventBreakdown] = await Promise.all([
        getSecondaryEventMetrics(testId, shopDomain, eventNamesForMetrics, options),
        getEventCollectionStats(testId, shopDomain, eventNamesForMetrics, options),
        checkoutSectionEventNames.length > 0
          ? getCheckoutEventBreakdown(testId, shopDomain, options)
          : Promise.resolve([]),
      ]);
    }

    const calculateProfit = variant => {
      const revenue = Number(variant.revenue) || 0;
      const conversions = Number(variant.conversions) || 0;
      const cogs = goal?.cogs;
      if (!cogs?.enabled) {
        return revenue;
      }
      if (cogs.type === 'fixed_per_order') {
        return revenue - conversions * (Number(cogs.value) || 0);
      }
      return revenue - revenue * ((Number(cogs.value) || 0) / 100);
    };

    // Calculate metrics for each variant
    const variants = orderVariantsForComparison(
      (rawData || []).map(variant => {
        const visitors = Number(variant.visitors) || 0;
        const revenue = Number(variant.revenue) || 0;
        const conversions = Number(variant.conversions) || 0;
        const profit = calculateProfit({ ...variant, visitors, revenue, conversions });
        const v = {
          id: variant.variant_id,
          name: variant.variant_name,
          visitors,
          conversions,
          conversionRate: this.calculateConversionRate(conversions, visitors),
          revenue,
          revenuePerVisitor: visitors > 0 ? revenue / visitors : 0,
          profit,
          profitPerVisitor: visitors > 0 ? profit / visitors : 0,
          avgOrderValue: conversions > 0 ? revenue / conversions : 0,
          secondaryEvents: {},
          checkoutSectionEvents: {},
        };
        secondaryEventNames.forEach(eventName => {
          const data = eventMetrics[eventName]?.[variant.variant_id];
          v.secondaryEvents[eventName] = {
            count: data?.count ?? 0,
            sum: data?.sum ?? 0,
            rate: v.visitors > 0 ? ((data?.count ?? 0) / v.visitors) * 100 : 0,
          };
        });
        checkoutSectionEventNames.forEach(eventName => {
          const data = eventMetrics[eventName]?.[variant.variant_id];
          v.checkoutSectionEvents[eventName] = {
            count: data?.count ?? 0,
            sum: data?.sum ?? 0,
            rate: v.visitors > 0 ? ((data?.count ?? 0) / v.visitors) * 100 : 0,
          };
        });
        return v;
      }),
      test
    );
    const checkoutAdvanced = buildCheckoutAdvancedOutput({
      checkoutPhase: getCheckoutPhaseFromTest(test),
      checkoutSectionEventNames,
      variants,
      checkoutEventBreakdown,
    });

    if (!rawData || rawData.length < 2) {
      const totalVisitors = variants.reduce((sum, v) => sum + (v.visitors || 0), 0);
      return {
        error: 'Insufficient data for analysis',
        variants,
        secondaryEventNames,
        secondaryEventStats,
        checkoutSectionEventNames,
        checkoutAdvanced,
        significance: {
          significant: false,
          pValue: 1,
          confidence: 0,
          message:
            rawData?.length === 1 ? 'Need at least 2 variants to compare' : 'No variants with data',
        },
        summary: {
          totalVisitors,
          totalConversions: variants.reduce((sum, v) => sum + (v.conversions || 0), 0),
          totalRevenue: variants.reduce((sum, v) => sum + (v.revenue || 0), 0),
        },
      };
    }

    // Calculate significance (frequentist) or Bayesian probability to beat control
    const analysisMethod = goal.analysis_method || 'frequentist';
    let significanceThreshold = STATISTICAL_THRESHOLD.P_VALUE;
    const configuredGoalConfidence = Number(goal.significance_level);
    try {
      let conf =
        Number.isFinite(configuredGoalConfidence) &&
        configuredGoalConfidence > 0 &&
        configuredGoalConfidence < 1
          ? configuredGoalConfidence
          : null;
      if (!conf) {
        const settingsRes = await query(
          'SELECT confidence_level FROM shop_settings WHERE shop_domain = $1',
          [shopDomain]
        );
        conf =
          Number(settingsRes.rows[0]?.confidence_level) || SETTINGS_BOUNDS.DEFAULT_CONFIDENCE_LEVEL;
      }
      significanceThreshold = 1 - conf;
    } catch {
      // Use default
    }
    let significance;
    if (variants.length === 2) {
      significance = this.calculateSignificance(variants[0], variants[1], {
        significanceThreshold,
      });
    } else if (variants.length > 2) {
      significance = this.calculateMultiVariantSignificance(variants, { significanceThreshold });
    } else {
      significance = { significant: false, pValue: 1, confidence: 0, message: 'Insufficient data' };
    }

    if (analysisMethod === 'bayesian') {
      const control = variants[0];
      const probToBeatControl = variants.map(v => {
        if (v.id === control.id) {
          return { variantId: v.id, variantName: v.name, probabilityToBeatControl: 0.5 };
        }
        const pA = control.conversions / Math.max(1, control.visitors);
        const pB = v.conversions / Math.max(1, v.visitors);
        const nA = control.visitors;
        const nB = v.visitors;
        const se = Math.sqrt((pA * (1 - pA)) / nA + (pB * (1 - pB)) / nB);
        const z = se > 0 ? (pB - pA) / se : 0;
        // P(B beats A) = Φ(z) where z = (pB-pA)/SE (normal approximation)
        const prob = this.normalCDF(z);
        return {
          variantId: v.id,
          variantName: v.name,
          probabilityToBeatControl: Math.round(prob * 1000) / 1000,
        };
      });
      significance = {
        ...significance,
        bayesian: true,
        probabilityMethod: 'normal_approximation',
        probabilityLabel: 'Directional probability',
        probabilityNote:
          'This is a normal-approximation directional probability, not a full Beta-Binomial posterior.',
        probToBeatControl,
      };
    }

    // Calculate revenue impact against the actual winner/best variant when available.
    const controlVariant = variants[0];
    const comparisonVariant =
      variants.find(v => v.id === (significance.winnerVariantId || significance.bestVariantId)) ||
      variants[1];
    const revenueImpact =
      controlVariant && comparisonVariant && controlVariant.id !== comparisonVariant.id
        ? {
            ...this.calculateRevenueImpact(controlVariant, comparisonVariant),
            controlVariantId: controlVariant.id,
            controlVariantName: controlVariant.name,
            comparisonVariantId: comparisonVariant.id,
            comparisonVariantName: comparisonVariant.name,
          }
        : null;

    // Sample Ratio Mismatch (SRM) detection - data quality check
    const totalVisitors = variants.reduce((sum, v) => sum + v.visitors, 0);
    const holdoutPercent = test?.holdout_percent ?? 0;
    const variantsWithAllocation = variants.map(v => {
      if (v.id === 'holdout' || v.name === 'Holdout') {
        return {
          ...v,
          allocation: Number.isFinite(Number(holdoutPercent))
            ? Number(holdoutPercent)
            : 100 / variants.length,
        };
      }
      const testVariant = (test?.variants || []).find(tv => tv?.id === v.id || tv?.name === v.name);
      return { ...v, allocation: testVariant?.allocation ?? 100 / variants.length };
    });
    const srm = this.detectSampleRatioMismatch(variantsWithAllocation, totalVisitors);

    return {
      testId,
      variants,
      significance,
      analysisMethod: analysisMethod || 'frequentist',
      revenueImpact,
      secondaryEventNames,
      secondaryEventStats,
      checkoutSectionEventNames,
      checkoutAdvanced,
      srm,
      summary: {
        totalVisitors,
        totalConversions: variants.reduce((sum, v) => sum + v.conversions, 0),
        totalRevenue: variants.reduce((sum, v) => sum + v.revenue, 0),
      },
    };
  }
}

module.exports = new AnalyticsService();
