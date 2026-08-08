/**
 * Personalization Service
 *
 * Handles applying winning variant when a test completes:
 * - Personalize: Apply winner to 100% of traffic
 * - Rollout: Gradually increase winner exposure (e.g. 25% → 50% → 100%)
 */

const { getTestById, updateTest } = require('../models/test');
const analyticsService = require('./analytics');
const logger = require('../utils/logger');

const PERSONALIZATION_MODES = {
  NONE: 'none',
  PERSONALIZED: 'personalized',
  ROLLOUT: 'rollout',
};

function getPrimaryMetricValue(variant = {}, metric = 'revenue') {
  const visitors = Math.max(1, Number(variant.visitors) || 0);
  const conversions = Number(variant.conversions) || 0;
  const revenue = Number(variant.revenue) || 0;
  const profit = Number(variant.profit) || revenue;

  switch (metric) {
    case 'conversion_rate':
    case 'conversions':
      return conversions / visitors;
    case 'revenue_per_visitor':
      return revenue / visitors;
    case 'profit_per_visitor':
      return profit / visitors;
    case 'aov':
    case 'average_order_value':
      return Number(variant.avgOrderValue) || (conversions > 0 ? revenue / conversions : 0);
    case 'revenue':
    default:
      return revenue;
  }
}

/**
 * Determine winner from analytics (best performing variant by primary metric)
 * Falls back to test variants when analytics has insufficient data.
 *
 * @param {Object} analytics - Analytics result from getTestAnalytics
 * @param {Object} goal - Test goal config
 * @param {Array} testVariants - Test's variant config (fallback when analytics insufficient)
 * @returns {Object|null} { index, variant } or null
 */
function getWinnerFromAnalytics(analytics, goal = {}, testVariants = []) {
  const metric = goal?.metric || 'revenue';

  // Try analytics first when we have 2+ variants with data
  if (analytics?.variants && analytics.variants.length >= 2) {
    const significance = analytics.significance;

    // If we have a clear significance winner, use it
    if (significance?.winner) {
      let winnerIdx = significance.winner === 'variantB' ? 1 : 0;
      let variant = analytics.variants[winnerIdx];
      if (
        significance.winner === 'best' &&
        (significance.winnerVariantId || significance.bestVariantId)
      ) {
        const idx = analytics.variants.findIndex(
          v => v.id === (significance.winnerVariantId || significance.bestVariantId)
        );
        if (idx >= 0) {
          winnerIdx = idx;
          variant = analytics.variants[idx];
        }
      }
      if (variant) {
        return { index: winnerIdx, variant };
      }
    }

    // Fallback: pick best by primary metric from analytics
    let bestIdx = 0;
    let bestValue = -Infinity;

    analytics.variants.forEach((v, i) => {
      const value = getPrimaryMetricValue(v, metric);
      if (value > bestValue) {
        bestValue = value;
        bestIdx = i;
      }
    });

    return {
      index: bestIdx,
      variant: analytics.variants[bestIdx],
    };
  }

  // Insufficient analytics: use test variants and pick highest-allocation (or first)
  const variants = Array.isArray(testVariants) ? testVariants : [];
  if (variants.length === 0) {
    return null;
  }

  // Pick variant with highest allocation (typically the primary/control variant)
  let bestIdx = 0;
  let bestAllocation = -1;
  variants.forEach((v, i) => {
    const alloc = Number(v.allocation) || 0;
    if (alloc > bestAllocation) {
      bestAllocation = alloc;
      bestIdx = i;
    }
  });

  logger.info('Using test variant as winner (insufficient analytics)', {
    variantIndex: bestIdx,
    variantName: variants[bestIdx]?.name,
    allocation: bestAllocation,
  });

  return {
    index: bestIdx,
    variant: variants[bestIdx],
  };
}

/**
 * Apply personalization (winner to 100%) for a stopped test
 *
 * @param {string} testId - Test ID
 * @param {string} shopDomain - Shop domain
 * @param {Object} options - { variantIndex?, force? }
 * @returns {Promise<Object>} Updated test
 */
async function applyPersonalization(testId, shopDomain, options = {}) {
  const test = await getTestById(testId, shopDomain);
  if (!test) {
    throw new Error('Test not found');
  }
  if (test.status !== 'stopped' && test.status !== 'completed') {
    throw new Error('Test must be stopped before applying personalization');
  }

  let winnerIndex = options.variantIndex;
  let winnerVariant = null;

  if (winnerIndex === null || winnerIndex === undefined) {
    const analytics = await analyticsService.getTestAnalytics(testId, shopDomain);
    const winner = getWinnerFromAnalytics(analytics, test.goal, test.variants);
    if (!winner) {
      throw new Error('No winner could be determined. Test has no variants configured.');
    }
    winnerIndex = winner.index;
    winnerVariant = winner.variant;
  } else {
    const variants = test.variants || [];
    winnerVariant = variants[winnerIndex];
    if (!winnerVariant) {
      throw new Error('Invalid variant index');
    }
  }

  const variantId = winnerVariant?.id || test.variants?.[winnerIndex]?.id;
  const variantName = winnerVariant?.name || test.variants?.[winnerIndex]?.name;

  await updateTest(testId, shopDomain, {
    winner_variant_index: winnerIndex,
    winner_variant_id: variantId,
    personalization_mode: PERSONALIZATION_MODES.PERSONALIZED,
    rollout_percent: 100,
    rollout_schedule: null,
    rollout_started_at: new Date(),
  });

  logger.info('Personalization applied', {
    testId,
    shopDomain,
    winnerVariant: variantName,
    winnerIndex,
  });

  return getTestById(testId, shopDomain);
}

/**
 * Start gradual rollout of the winning variant
 *
 * @param {string} testId - Test ID
 * @param {string} shopDomain - Shop domain
 * @param {Object} options - { variantIndex?, initialPercent?, schedule? }
 * @returns {Promise<Object>} Updated test
 */
async function startRollout(testId, shopDomain, options = {}) {
  const test = await getTestById(testId, shopDomain);
  if (!test) {
    throw new Error('Test not found');
  }
  if (test.status !== 'stopped' && test.status !== 'completed') {
    throw new Error('Test must be stopped before starting rollout');
  }

  let winnerIndex = options.variantIndex;
  let winnerVariant = null;

  if (winnerIndex === null || winnerIndex === undefined) {
    const analytics = await analyticsService.getTestAnalytics(testId, shopDomain);
    const winner = getWinnerFromAnalytics(analytics, test.goal, test.variants);
    if (!winner) {
      throw new Error('No winner could be determined. Test has no variants configured.');
    }
    winnerIndex = winner.index;
    winnerVariant = winner.variant;
  } else {
    const variants = test.variants || [];
    winnerVariant = variants[winnerIndex];
    if (!winnerVariant) {
      throw new Error('Invalid variant index');
    }
  }

  const variantId = winnerVariant?.id || test.variants?.[winnerIndex]?.id;
  const initialPercent = Math.min(100, Math.max(0, options.initialPercent ?? 25));
  let schedule = options.schedule || null;
  // Ensure schedule is valid JSON-serializable array for JSONB column
  if (Array.isArray(schedule) && schedule.length > 0) {
    schedule = schedule.map(s => ({
      day: Number(s?.day) || 0,
      percent: Math.min(100, Math.max(0, Number(s?.percent) || 0)),
    }));
  } else {
    schedule = null;
  }

  await updateTest(testId, shopDomain, {
    winner_variant_index: winnerIndex,
    winner_variant_id: variantId,
    personalization_mode: PERSONALIZATION_MODES.ROLLOUT,
    rollout_percent: initialPercent,
    rollout_schedule: schedule,
    rollout_started_at: new Date(),
  });

  logger.info('Rollout started', {
    testId,
    shopDomain,
    winnerIndex,
    initialPercent,
    hasSchedule: !!schedule,
  });

  return getTestById(testId, shopDomain);
}

/**
 * Update rollout percentage (called by job or manual)
 *
 * @param {string} testId - Test ID
 * @param {string} shopDomain - Shop domain
 * @param {number} percent - New rollout percentage (0-100)
 * @returns {Promise<Object>} Updated test
 */
async function updateRolloutPercent(testId, shopDomain, percent) {
  const clamped = Math.min(100, Math.max(0, percent));
  await updateTest(testId, shopDomain, {
    rollout_percent: clamped,
  });
  if (clamped >= 100) {
    await updateTest(testId, shopDomain, {
      personalization_mode: PERSONALIZATION_MODES.PERSONALIZED,
    });
  }
  return getTestById(testId, shopDomain);
}

/**
 * Disable personalization/rollout
 *
 * @param {string} testId - Test ID
 * @param {string} shopDomain - Shop domain
 * @returns {Promise<Object>} Updated test
 */
async function disablePersonalization(testId, shopDomain) {
  await updateTest(testId, shopDomain, {
    personalization_mode: PERSONALIZATION_MODES.NONE,
    rollout_percent: 0,
    rollout_schedule: null,
    rollout_started_at: null,
  });
  return getTestById(testId, shopDomain);
}

/**
 * Get effective rollout percent based on schedule (if any)
 *
 * @param {Object} test - Test with rollout_schedule, rollout_started_at, rollout_percent
 * @returns {number} Effective percent 0-100
 */
function getEffectiveRolloutPercent(test) {
  if (!test) {
    return 0;
  }
  const mode = test.personalization_mode;
  if (mode === PERSONALIZATION_MODES.PERSONALIZED) {
    return 100;
  }
  if (mode !== PERSONALIZATION_MODES.ROLLOUT) {
    return 0;
  }

  const schedule = test.rollout_schedule;
  if (!schedule || !Array.isArray(schedule) || schedule.length === 0) {
    return Number(test.rollout_percent) || 0;
  }

  const startedAt = test.rollout_started_at ? new Date(test.rollout_started_at) : null;
  if (!startedAt) {
    return Number(test.rollout_percent) || 0;
  }

  const now = new Date();
  const daysSinceStart = (now - startedAt) / (24 * 60 * 60 * 1000);

  // Sort by day ascending
  const sorted = [...schedule].sort((a, b) => (a.day ?? 0) - (b.day ?? 0));
  let effective = Number(test.rollout_percent) || 0;

  for (let i = sorted.length - 1; i >= 0; i--) {
    if (daysSinceStart >= (sorted[i].day ?? 0)) {
      effective = Math.min(100, Number(sorted[i].percent) ?? effective);
      break;
    }
  }

  return effective;
}

module.exports = {
  PERSONALIZATION_MODES,
  getWinnerFromAnalytics,
  applyPersonalization,
  startRollout,
  updateRolloutPercent,
  disablePersonalization,
  getEffectiveRolloutPercent,
};
