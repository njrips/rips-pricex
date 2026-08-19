/**
 * Runtime revenue-drop enforcement for running Smart Pricing tests.
 */

const { updateTest } = require('../../models/test');
const abTestEngine = require('../abTestEngine');
const { scheduleSmartPricingInboxSync } = require('./smartPricingInboxStopSyncService');
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

function resolveThreshold(test = {}) {
  const config = parseGuardrailConfig(test.guardrail_config);
  const goalRails =
    test.goal && typeof test.goal === 'object' && test.goal.guardrails
      ? test.goal.guardrails
      : {};
  const raw =
    config.max_revenue_drop_percent ??
    goalRails.max_revenue_drop_percent ??
    test.metadata?.guardrails?.max_revenue_drop_percent;
  return Number(raw);
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

  let threshold = resolveThreshold(test);
  if (!Number.isFinite(threshold) || threshold <= 0) {
    try {
      const { getShopSmartPricingGuardrails } = require('./smartPricingGuardrailsService');
      const shop = await getShopSmartPricingGuardrails(shopDomain);
      threshold = Number(shop?.max_revenue_drop_percent);
    } catch {
      threshold = NaN;
    }
  }
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
  scheduleSmartPricingInboxSync(shopDomain, test.id, { reason: 'guardrail_breach' });

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
};
