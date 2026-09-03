/**
 * Pure helpers for per-product action gating in the Classic product drill-down.
 */

export const PRODUCT_EVENT_LABELS = Object.freeze({
  launched: 'Launched',
  stopped: 'Stopped',
  resumed: 'Resumed',
  winner_applied: 'Price applied to Shopify',
  reverted: 'Price reverted',
  finished_control: 'Kept catalog price',
  rerun_queued: 'Re-run queued',
  guardrail_stopped: 'Stopped by guardrail',
  auto_applied: 'Auto-applied winning price',
});

/**
 * Decide which lifecycle actions are available for one product row.
 * sharedTest products cannot be stopped/re-run in isolation.
 */
export function resolveProductActionAvailability({
  planStatus = '',
  testStatus = '',
  decision = null,
  sharedTest = false,
  hasAppliedBaseline = false,
  hasFollowUpQueued = false,
  alreadyReverted = false,
} = {}) {
  const plan = String(planStatus || '')
    .trim()
    .toLowerCase();
  const test = String(testStatus || '')
    .trim()
    .toLowerCase();
  const state = String(decision?.state || '')
    .trim()
    .toLowerCase();
  const mode = String(decision?.personalization_mode || '')
    .trim()
    .toLowerCase();

  const running = test === 'running' || test === 'active' || plan === 'running';
  const paused =
    plan === 'paused' || test === 'paused' || test === 'stopped' || plan === 'stopped';
  const decided =
    state === 'applied' ||
    plan === 'applied' ||
    mode === 'personalized' ||
    mode === 'rollout' ||
    mode === 'control' ||
    plan === 'completed';
  const canApply = decision?.can_apply === true;
  const canFinish = decision?.can_finish === true;

  const sharedBlock = sharedTest
    ? 'This SKU shares a test with other products, so stop and re-run must happen at the experiment level.'
    : null;

  // Reverting needs the per-variant snapshot taken at apply time. Offering it
  // without one — an apply from before we recorded baselines, or an apply we
  // already undid — is an action that can only fail.
  const applied = state === 'applied' || plan === 'applied';
  const revertReason = !hasAppliedBaseline
    ? applied
      ? 'This price was applied before we started recording the previous price, so it cannot be restored automatically.'
      : 'No apply snapshot to revert.'
    : alreadyReverted
      ? 'The previous price has already been restored.'
      : null;

  return {
    canStop: Boolean(running && !sharedTest && !decided),
    canResume: Boolean(paused && !decided && !sharedTest && !running),
    canApply,
    canFinish,
    canRevert: Boolean(hasAppliedBaseline && !alreadyReverted),
    canRerun: Boolean(!sharedTest && !hasFollowUpQueued && (decided || paused || canFinish)),
    sharedBlock,
    reasons: {
      stop: sharedBlock || (!running ? 'Product is not running.' : null),
      resume: decided
        ? 'This product has already been decided. Start a re-run instead.'
        : !paused
          ? 'Product is not paused.'
          : null,
      apply: canApply ? null : 'A reviewed challenger winner is not ready yet.',
      finish: canFinish ? null : 'A control decision is not ready yet.',
      revert: revertReason,
      rerun: sharedBlock || (hasFollowUpQueued ? 'A follow-up round is already queued.' : null),
    },
  };
}

export function mapServerEventToActivity(event) {
  if (!event) return null;
  const kindMap = {
    launched: 'started',
    stopped: 'paused',
    resumed: 'resumed',
    winner_applied: 'complete',
    auto_applied: 'complete',
    reverted: 'updated',
    finished_control: 'complete',
    rerun_queued: 'queued',
    guardrail_stopped: 'guardrail',
  };
  return {
    id: event.id || `server:${event.event_type}:${event.created_at}`,
    at: event.created_at,
    title: PRODUCT_EVENT_LABELS[event.event_type] || event.event_type,
    kind: kindMap[event.event_type] || 'updated',
    actor: event.actor || 'system',
    detail: formatEventDetail(event),
    status: event.event_type,
    source: 'server',
    plan_id: event.plan_id || null,
    test_id: event.test_id || null,
    payload: event.payload || {},
  };
}

function formatEventDetail(event) {
  const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
  if (event.event_type === 'winner_applied' || event.event_type === 'auto_applied') {
    const n = payload.updated_count;
    return Number.isFinite(Number(n))
      ? `${n} Shopify price${Number(n) === 1 ? '' : 's'} updated`
      : payload.winner_variant_name || null;
  }
  if (event.event_type === 'reverted') {
    const n = Array.isArray(payload.variants) ? payload.variants.length : payload.updated_count;
    return Number.isFinite(Number(n))
      ? `Restored ${n} price${Number(n) === 1 ? '' : 's'}`
      : null;
  }
  if (event.event_type === 'rerun_queued') {
    return payload.follow_up_plan_id
      ? `Queued ${payload.follow_up_plan_id} (round ${payload.learning_round || '?'})`
      : null;
  }
  if (event.event_type === 'guardrail_stopped') {
    return Number.isFinite(Number(payload.observed_drop_percent))
      ? `Revenue drop ${payload.observed_drop_percent}% exceeded ${payload.threshold_percent}%`
      : null;
  }
  return payload.note || payload.reason || null;
}

/**
 * Merge server events (preferred) with legacy client activity_log entries.
 */
export function mergeServerAndLegacyActivity(serverEvents = [], legacyActivity = []) {
  const fromServer = (Array.isArray(serverEvents) ? serverEvents : [])
    .map(mapServerEventToActivity)
    .filter(Boolean);
  const fromLegacy = (Array.isArray(legacyActivity) ? legacyActivity : []).map(row => ({
    ...row,
    source: row.source || 'legacy',
  }));

  // Prefer server events; keep legacy rows that do not collide on id/timestamp+title.
  const serverKeys = new Set(
    fromServer.map(row => `${row.at}|${row.title}|${row.plan_id || ''}`)
  );
  const keptLegacy = fromLegacy.filter(row => {
    const key = `${row.at}|${row.title}|${row.plan_id || ''}`;
    return !serverKeys.has(key);
  });

  return [...fromServer, ...keptLegacy].sort((a, b) =>
    String(b.at || '').localeCompare(String(a.at || ''))
  );
}
