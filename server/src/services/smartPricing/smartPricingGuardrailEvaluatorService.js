/**
 * Runtime revenue-drop enforcement for running Smart Pricing tests.
 */

const { updateTest } = require('../../models/test');
const abTestEngine = require('../abTestEngine');
const { syncSmartPricingInboxForTest } = require('./smartPricingInboxStopSyncService');
const {
  MIN_VISITORS_FOR_REVENUE_GUARDRAIL,
  evaluateRevenueDrop,
} = require('./smartPricingRevenueGuardrail');

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

function resolveThreshold(test = {}, shopGuardrails = {}) {
  const config = parseGuardrailConfig(test.guardrail_config);
  const goalRails =
    test.goal && typeof test.goal === 'object' && test.goal.guardrails
      ? test.goal.guardrails
      : {};
  const raw =
    config.max_revenue_drop_percent ??
    goalRails.max_revenue_drop_percent ??
    test.metadata?.guardrails?.max_revenue_drop_percent;
  const storedThreshold = Number(raw);
  const shopThreshold = Number(
    shopGuardrails.max_revenue_drop_percent ?? shopGuardrails.maxRevenueDropPercent
  );
  if (Number.isFinite(storedThreshold) && storedThreshold > 0) {
    return Number.isFinite(shopThreshold) && shopThreshold > 0
      ? Math.min(storedThreshold, shopThreshold)
      : storedThreshold;
  }
  return shopThreshold;
}

async function enforceRevenueDropGuardrail({ shopDomain, test, analytics } = {}) {
  if (!test?.id || !shopDomain) {
    return { skipped: true, reason: 'missing_test' };
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

  const variants = Array.isArray(analytics?.variants) ? analytics.variants : [];
  const verdict = evaluateRevenueDrop({
    variants,
    thresholdPercent: threshold,
    minVisitors: Number(config.min_visitors_per_variant) || MIN_VISITORS_FOR_REVENUE_GUARDRAIL,
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

  await updateTest(test.id, shopDomain, {
    auto_stop: true,
    guardrail_config: nextConfig,
  });
  const stopped = await abTestEngine.stopTest(test.id, shopDomain);
  await syncSmartPricingInboxForTest(shopDomain, test.id, { reason: 'guardrail_breach' }).catch(
    () => null
  );

  const { recordEventForTest } = require('../../models/smartPricingProductEventStore');
  await recordEventForTest(shopDomain, test.id, 'guardrail_stopped', {
    actor: 'guardrail',
    test: stopped || test,
    payload: {
      observed_drop_percent: verdict.observed_drop_percent,
      threshold_percent: verdict.threshold_percent,
      variant_id: verdict.variant_id || null,
      variant_name: verdict.variant_name || null,
      breached_at: breachedAt,
    },
  }).catch(() => null);

  return {
    skipped: false,
    enforced: true,
    breached: true,
    test_status: stopped?.status || 'stopped',
    ...verdict,
    breached_at: breachedAt,
  };
}

module.exports = {
  enforceRevenueDropGuardrail,
  resolveThreshold,
};
