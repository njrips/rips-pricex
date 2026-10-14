/**
 * Runtime revenue-drop enforcement for running Smart Pricing tests.
 */

const logger = require('../../utils/logger');
const {
  MIN_CONVERSIONS_FOR_REVENUE_GUARDRAIL,
  evaluateRevenueDrop,
  resolveGuardrailMinVisitors,
} = require('./smartPricingRevenueGuardrail');

const PAUSABLE_STATUSES = new Set(['running', 'active', 'scheduled']);

const deps = {
  updateTest: (...args) => require('../../models/test').updateTest(...args),
  updateTestStatus: (...args) => require('../../models/test').updateTestStatus(...args),
  listExperimentTests: (...args) =>
    require('../../models/smartPricingInboxStore').listExperimentTests(...args),
  syncSmartPricingInboxForTest: (...args) =>
    require('./smartPricingInboxStopSyncService').syncSmartPricingInboxForTest(...args),
  recordEventForTest: (...args) =>
    require('../../models/smartPricingProductEventStore').recordEventForTest(...args),
};

function parseGuardrailConfig(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof raw === 'object' ? raw : {};
}

function isRunningStatus(status) {
  const key = String(status || '')
    .trim()
    .toLowerCase();
  return key === 'running' || key === 'active';
}

function goalGuardrails(test = {}) {
  return test.goal && typeof test.goal === 'object' && test.goal.guardrails
    ? test.goal.guardrails
    : {};
}

/**
 * Whether this test asked for the guardrail at all.
 *
 * `guardrail_config` is stored as NULL for a disabled guardrail, so the column
 * cannot carry the answer -- and reading a missing column as "no guardrail"
 * would be wrong too, since a threshold also survives on the goal. The goal's
 * own `enabled: false` is the durable signal, and only an explicit false
 * counts: tests launched before the guardrail was switchable have no flag and
 * must keep the protection they launched with.
 */
function isGuardrailDisabled(test = {}) {
  const config = parseGuardrailConfig(test.guardrail_config);
  if (config.enabled === false) return true;
  return goalGuardrails(test).enabled === false;
}

function variantKey(row = {}, index = 0) {
  return String(row.id ?? row.variant_id ?? row.variantId ?? row.name ?? index);
}

function variantTotals(row = {}) {
  return {
    visitors: Number(row.visitors) || 0,
    revenue: Number(row.revenue) || 0,
    conversions: Number(row.conversions ?? row.orders) || 0,
  };
}

function snapshotVariants(variants = []) {
  const out = {};
  variants.forEach((row, index) => {
    out[variantKey(row, index)] = variantTotals(row);
  });
  return out;
}

/**
 * Results since the guardrail was re-armed. Without this, a resumed test is
 * judged on the same totals that paused it and is paused again on the next
 * check, so Resume could never stick.
 */
function variantsSinceBaseline(variants = [], baseline = {}) {
  return variants.map((row, index) => {
    const now = variantTotals(row);
    const before = baseline[variantKey(row, index)] || {};
    const visitors = Math.max(0, now.visitors - (Number(before.visitors) || 0));
    const revenue = Math.max(0, now.revenue - (Number(before.revenue) || 0));
    const conversions = Math.max(0, now.conversions - (Number(before.conversions) || 0));
    // eslint-disable-next-line no-unused-vars
    const { revenuePerVisitor, revenue_per_visitor, ...rest } = row;
    return { ...rest, visitors, revenue, conversions, orders: conversions };
  });
}

function resolveThreshold(test = {}, shopGuardrails = {}) {
  const config = parseGuardrailConfig(test.guardrail_config);
  const goalRails = goalGuardrails(test);
  const raw =
    config.max_revenue_drop_percent ??
    goalRails.max_revenue_drop_percent ??
    test.metadata?.guardrails?.max_revenue_drop_percent;
  const storedThreshold = Number(raw);
  // The test's own threshold stands on its own. It used to be capped by the
  // shop default, which is no longer a setting the merchant can see, so a test
  // launched at 20% would have paused at 10% for reasons nothing on screen
  // explained. The shop value is now only the fallback for a test without one.
  if (Number.isFinite(storedThreshold) && storedThreshold > 0) {
    return storedThreshold;
  }
  return Number(
    shopGuardrails.max_revenue_drop_percent ?? shopGuardrails.maxRevenueDropPercent
  );
}

async function enforceRevenueDropGuardrail({ shopDomain, test, analytics } = {}) {
  if (!test?.id || !shopDomain) {
    return { skipped: true, reason: 'missing_test' };
  }
  if (isGuardrailDisabled(test)) {
    return { skipped: true, reason: 'guardrail_disabled', test_status: test.status };
  }
  const config = parseGuardrailConfig(test.guardrail_config);
  if (config.breached_at) {
    return {
      skipped: true,
      reason: 'already_breached',
      breached: true,
      test_status: test.status,
      ...config,
    };
  }
  if (!isRunningStatus(test.status)) {
    return { skipped: true, reason: 'not_running', test_status: test.status };
  }

  let shopGuardrails = {};
  try {
    const { getShopSmartPricingGuardrails } = require('./smartPricingGuardrailsService');
    shopGuardrails = (await getShopSmartPricingGuardrails(shopDomain)) || {};
  } catch {
    shopGuardrails = {};
  }
  let threshold = resolveThreshold(test, shopGuardrails);
  if (!Number.isFinite(threshold) || threshold <= 0) {
    threshold = 10;
  }

  const allVariants = Array.isArray(analytics?.variants) ? analytics.variants : [];
  if (config.rebaseline === true) {
    if (!allVariants.length) {
      return { skipped: true, reason: 'awaiting_baseline', test_status: test.status };
    }
    await deps.updateTest(test.id, shopDomain, {
      guardrail_config: {
        ...config,
        rebaseline: false,
        baseline: snapshotVariants(allVariants),
        baseline_at: new Date().toISOString(),
      },
    });
    return { skipped: true, reason: 'baseline_recorded', test_status: test.status };
  }
  const variants =
    config.baseline && typeof config.baseline === 'object'
      ? variantsSinceBaseline(allVariants, config.baseline)
      : allVariants;
  const verdict = evaluateRevenueDrop({
    variants,
    thresholdPercent: threshold,
    minVisitors: resolveGuardrailMinVisitors(
      (test.goal && typeof test.goal === 'object' ? test.goal.min_sample_size : undefined) ??
        config.min_visitors_per_variant
    ),
    minConversions: Math.max(
      MIN_CONVERSIONS_FOR_REVENUE_GUARDRAIL,
      Number(config.min_conversions_per_variant) || 0
    ),
  });

  if (!verdict.ready || !verdict.breached) {
    return {
      skipped: false,
      enforced: false,
      test_status: test.status,
      ...verdict,
    };
  }

  const breachedAt = new Date().toISOString();
  const nextConfig = {
    ...config,
    enabled: true,
    auto_stop: true,
    metric: 'revenue_per_visitor',
    max_revenue_drop_percent: verdict.threshold_percent,
    breached_at: breachedAt,
    observed_drop_percent: verdict.observed_drop_percent,
    variant_id: verdict.variant_id || null,
    variant_name: verdict.variant_name || null,
    action: 'paused',
  };

  await deps.updateTest(test.id, shopDomain, {
    auto_stop: true,
    guardrail_config: nextConfig,
  });
  // Paused, not stopped: the experiment keeps its products and the merchant
  // resumes it like any pause, which also re-arms this guardrail.
  const paused = await deps.updateTestStatus(test.id, shopDomain, 'paused');
  await deps
    .syncSmartPricingInboxForTest(shopDomain, test.id, { reason: 'guardrail_breach' })
    .catch(() => null);

  const experimentId = String(test?.metadata?.experiment_id || '').trim();
  const payload = {
    reason: 'guardrail_breach',
    scope: 'test',
    // One pause across every product, so the experiment's history shows it once.
    activity_id: `guardrail:${experimentId || test.id}:${breachedAt}`,
    observed_drop_percent: verdict.observed_drop_percent,
    threshold_percent: verdict.threshold_percent,
    variant_id: verdict.variant_id || null,
    variant_name: verdict.variant_name || null,
    breached_at: breachedAt,
  };
  await deps
    .recordEventForTest(shopDomain, test.id, 'guardrail_stopped', {
      actor: 'guardrail',
      test: paused || test,
      payload,
    })
    .catch(() => null);

  const pausedSiblings = await pauseRestOfExperiment({
    shopDomain,
    test,
    payload: { ...payload, triggered_by_test_id: String(test.id) },
  });

  return {
    skipped: false,
    enforced: true,
    breached: true,
    test_status: paused?.status || 'paused',
    paused_test_ids: [String(test.id), ...pausedSiblings],
    ...verdict,
    breached_at: breachedAt,
  };
}

/**
 * The guardrail pauses the whole test, not just the product that tripped it:
 * the merchant set one revenue limit for the experiment, and one variation
 * losing past it is the signal to stop and look at every price in it.
 */
async function pauseRestOfExperiment({ shopDomain, test, payload }) {
  const experimentId = String(test?.metadata?.experiment_id || '').trim();
  if (!experimentId) return [];
  const siblings = await deps.listExperimentTests(shopDomain, experimentId).catch(() => []);
  const pausedIds = [];
  for (const sibling of siblings) {
    if (String(sibling.id) === String(test.id)) continue;
    const status = String(sibling.status || '').trim().toLowerCase();
    if (!PAUSABLE_STATUSES.has(status)) continue;
    try {
      const updated = await deps.updateTestStatus(sibling.id, shopDomain, 'paused');
      if (!updated) continue;
      pausedIds.push(String(sibling.id));
      // Marked so its resume also starts the guardrail on fresh results.
      await deps
        .updateTest(sibling.id, shopDomain, {
          guardrail_config: {
            ...parseGuardrailConfig(sibling.guardrail_config),
            guardrail_paused_at: payload.breached_at,
          },
        })
        .catch(() => null);
      await deps
        .syncSmartPricingInboxForTest(shopDomain, sibling.id, { reason: 'guardrail_breach' })
        .catch(() => null);
      await deps
        .recordEventForTest(shopDomain, sibling.id, 'stopped', {
          actor: 'guardrail',
          test: updated,
          payload: { ...payload, reason: 'guardrail_pause' },
        })
        .catch(() => null);
    } catch (error) {
      logger.warn('Revenue guardrail could not pause a test in the experiment', {
        shopDomain,
        testId: sibling.id,
        error: error?.message,
      });
    }
  }
  return pausedIds;
}

module.exports = {
  __deps: deps,
  enforceRevenueDropGuardrail,
  isGuardrailDisabled,
  resolveThreshold,
};
