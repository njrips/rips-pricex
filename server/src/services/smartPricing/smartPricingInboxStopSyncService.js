/**
 * Push Smart Pricing inbox status when linked tests stop or winners apply.
 */

const logger = require('../../utils/logger');
const { getTestById } = require('../../models/test');
const {
  findInboxPlanByTestId,
  patchInboxPlansFromSync,
} = require('../../models/smartPricingInboxStore');
const { syncInboxPlanEntry } = require('./smartPricingInboxSyncService');
const { isSmartPricingEnabled } = require('./smartPricingFeatureService');
const { isSmartPricingTest } = require('./smartPricingTestIdentity');

async function resolvePlanRefForTest(shopDomain, test = {}) {
  const metadata = test.metadata && typeof test.metadata === 'object' ? test.metadata : {};
  const planId = String(metadata.smart_pricing_plan_id || '').trim();
  const testId = String(test.id || '').trim();
  const match = testId
    ? await findInboxPlanByTestId(shopDomain, testId).catch(() => null)
    : null;
  if (match?.id) {
    return {
      plan_id: match.id,
      test_id: testId || String(match.test_id || '').trim(),
      status: match.status || null,
    };
  }
  if (planId && testId) {
    return { plan_id: planId, test_id: testId, status: null };
  }
  return null;
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

  const planRef = await resolvePlanRefForTest(domain, test);
  if (!isSmartPricingTest(test) && !planRef) {
    return { synced: false, reason: 'not_smart_pricing_test', test_id: id };
  }
  if (!planRef) {
    return { synced: false, reason: 'plan_not_linked', test_id: id };
  }

  const result = await syncInboxPlanEntry(domain, planRef);
  // Classic "Pause" uses POST /tests/:id/stop with reason merchant_stop.
  // Do not flip those plans to winner_ready — merchants paused traffic, not declared a winner.
  const normalizedReason = String(reason || '')
    .trim()
    .toLowerCase();
  const currentStatus = String(planRef.status || '')
    .trim()
    .toLowerCase();
  const merchantPaused =
    (normalizedReason === 'merchant_stop' ||
      normalizedReason === 'merchant_stop_product' ||
      normalizedReason === 'guardrail_breach') &&
    result.synced &&
    !result.winner_applied &&
    (result.inbox_status === 'winner_ready' || result.test_status === 'stopped');
  // Keep a merchant or guardrail pause so interval syncs do not turn it into a
  // generic stopped state or advertise a rollout without reviewed evidence.
  const keepExistingPause =
    currentStatus === 'paused' &&
    result.synced &&
    !result.winner_applied &&
    (result.inbox_status === 'winner_ready' || result.inbox_status === 'stopped') &&
    normalizedReason !== 'auto_winner' &&
    normalizedReason !== 'apply_winner' &&
    normalizedReason !== 'auto_winner_failed' &&
    normalizedReason !== 'merchant_resume_product';
  // Resume flips a per-product pause back to running without waiting for the next sync.
  const merchantResumed =
    normalizedReason === 'merchant_resume_product' &&
    result.synced &&
    !result.winner_applied;
  let patchRow = result;
  if (merchantPaused || keepExistingPause) {
    patchRow = {
      ...result,
      inbox_status: 'paused',
      winner_ready: false,
    };
  } else if (merchantResumed) {
    patchRow = {
      ...result,
      inbox_status: 'running',
      winner_ready: false,
    };
  }

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
