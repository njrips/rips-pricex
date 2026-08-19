/**
 * Push Smart Pricing inbox status when linked tests stop or winners apply.
 */

const logger = require('../../utils/logger');
const { getTestById } = require('../../models/test');
const { listInboxPlans, patchInboxPlansFromSync } = require('../../models/smartPricingInboxStore');
const { syncInboxPlanEntry } = require('./smartPricingInboxSyncService');
const { isSmartPricingEnabled } = require('./smartPricingFeatureService');

function isSmartPricingTest(test = {}) {
  const metadata = test.metadata && typeof test.metadata === 'object' ? test.metadata : {};
  return (
    metadata.smart_pricing_source === 'smart_pricing' || Boolean(metadata.smart_pricing_plan_id)
  );
}

async function resolvePlanRefForTest(shopDomain, test = {}) {
  const metadata = test.metadata && typeof test.metadata === 'object' ? test.metadata : {};
  const planId = String(metadata.smart_pricing_plan_id || '').trim();
  const testId = String(test.id || '').trim();
  if (planId && testId) {
    return { plan_id: planId, test_id: testId };
  }
  if (!testId) {
    return null;
  }
  const stored = await listInboxPlans(shopDomain);
  const match = (stored.plans || []).find(row => String(row.test_id || '') === testId);
  if (!match?.id) {
    return null;
  }
  return { plan_id: match.id, test_id: testId };
}

async function syncSmartPricingInboxForTest(shopDomain, testId, { reason = 'test_event' } = {}) {
  if (!isSmartPricingEnabled()) {
    return { synced: false, reason: 'feature_disabled' };
  }
  const domain = String(shopDomain || '').trim();
  const id = String(testId || '').trim();
  if (!domain || !id) {
    return { synced: false, reason: 'missing_shop_or_test' };
  }

  const test = await getTestById(id, domain);
  if (!test) {
    return { synced: false, reason: 'test_not_found', test_id: id };
  }
  if (!isSmartPricingTest(test)) {
    return { synced: false, reason: 'not_smart_pricing_test', test_id: id };
  }

  const planRef = await resolvePlanRefForTest(domain, test);
  if (!planRef) {
    return { synced: false, reason: 'plan_not_linked', test_id: id };
  }

  const result = await syncInboxPlanEntry(domain, planRef);
  // Classic "Pause" uses POST /tests/:id/stop with reason merchant_stop.
  // Do not flip those plans to winner_ready — merchants paused traffic, not declared a winner.
  const normalizedReason = String(reason || '')
    .trim()
    .toLowerCase();
  const merchantPaused =
    (normalizedReason === 'merchant_stop' || normalizedReason === 'guardrail_breach') &&
    result.synced &&
    !result.winner_applied &&
    (result.inbox_status === 'winner_ready' || result.test_status === 'stopped');
  const patchRow = merchantPaused
    ? {
        ...result,
        inbox_status: 'paused',
        winner_ready: false,
      }
    : result;

  if (patchRow.synced) {
    await patchInboxPlansFromSync(domain, [patchRow]);
  }

  return {
    ...patchRow,
    reason,
    pushed_at: new Date().toISOString(),
  };
}

function scheduleSmartPricingInboxSync(shopDomain, testId, meta = {}) {
  if (!isSmartPricingEnabled()) {
    return;
  }
  syncSmartPricingInboxForTest(shopDomain, testId, meta).catch(err => {
    logger.warn('Smart Pricing inbox stop sync failed', {
      shopDomain,
      testId,
      reason: meta.reason,
      error: err.message,
    });
  });
}

module.exports = {
  syncSmartPricingInboxForTest,
  scheduleSmartPricingInboxSync,
  isSmartPricingTest,
};
