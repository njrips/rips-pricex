/**
 * Sync Smart Pricing inbox plans with live RipX test status.
 */

const { getTestById } = require('../../models/test');

const WINNER_READY_STATUSES = new Set(['stopped', 'completed']);
const RUNNING_STATUSES = new Set(['running', 'active']);

function normalizePlanRef(plan = {}) {
  return {
    plan_id: String(plan.id || plan.plan_id || '').trim(),
    test_id: String(plan.test_id || '').trim(),
  };
}

function resolveWinnerApplied(test = {}) {
  const mode = String(test.personalization_mode || '')
    .trim()
    .toLowerCase();
  return mode === 'personalized' || mode === 'rollout';
}

function resolveInboxPlanStatus(test = {}) {
  if (resolveWinnerApplied(test)) {
    return 'applied';
  }
  const status = String(test.status || '')
    .trim()
    .toLowerCase();
  if (WINNER_READY_STATUSES.has(status)) {
    return 'winner_ready';
  }
  if (RUNNING_STATUSES.has(status)) {
    return 'running';
  }
  return status || 'unknown';
}

async function syncInboxPlanEntry(shopDomain, planRef = {}) {
  const { plan_id: planId, test_id: testId } = normalizePlanRef(planRef);
  if (!planId || !testId) {
    return {
      plan_id: planId || null,
      test_id: testId || null,
      synced: false,
      reason: 'missing_plan_or_test_id',
    };
  }

  const test = await getTestById(testId, shopDomain);
  if (!test) {
    return {
      plan_id: planId,
      test_id: testId,
      synced: false,
      reason: 'test_not_found',
    };
  }

  const testStatus = String(test.status || '')
    .trim()
    .toLowerCase();
  const winnerApplied = resolveWinnerApplied(test);
  const winnerReady = WINNER_READY_STATUSES.has(testStatus) && !winnerApplied;
  const inboxStatus = resolveInboxPlanStatus(test);

  return {
    plan_id: planId,
    test_id: testId,
    synced: true,
    test_status: testStatus,
    test_name: test.name || null,
    personalization_mode: test.personalization_mode || null,
    winner_variant_id: test.winner_variant_id || null,
    winner_ready: winnerReady,
    winner_applied: winnerApplied,
    inbox_status: inboxStatus,
    stopped_at: test.stopped_at || null,
  };
}

async function syncInboxPlans(shopDomain, plans = []) {
  const refs = (Array.isArray(plans) ? plans : [])
    .map(normalizePlanRef)
    .filter(ref => ref.plan_id && ref.test_id);

  const results = await Promise.all(
    refs.map(ref =>
      syncInboxPlanEntry(shopDomain, ref).catch(err => ({
        plan_id: ref.plan_id,
        test_id: ref.test_id,
        synced: false,
        reason: err.message || 'sync_failed',
      }))
    )
  );

  const winnerReadyCount = results.filter(row => row.winner_ready).length;
  const appliedCount = results.filter(row => row.winner_applied).length;
  const runningCount = results.filter(row => row.inbox_status === 'running').length;

  return {
    plans: results,
    summary: {
      synced_count: results.filter(row => row.synced).length,
      winner_ready_count: winnerReadyCount,
      applied_count: appliedCount,
      running_count: runningCount,
    },
  };
}

module.exports = {
  syncInboxPlans,
  syncInboxPlanEntry,
  resolveInboxPlanStatus,
  resolveWinnerApplied,
};
