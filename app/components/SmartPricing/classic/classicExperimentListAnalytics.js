import { getSmartPricingTestAnalytics } from '../../../services/smartPricingApi';
import { mapWithConcurrency } from '../../../utils/mapWithConcurrency';
import { collectExperimentTestIds } from './classicExperimentListActions';

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Visitors, lift and confidence for one row, read from the live analytics.
 *
 * The row's own figures come from fields the inbox plan never carries
 * (`analytics.visitors`, `lift_pct`), so without this a test with visitors
 * still read "—" on the list while its Overview showed the count. Each test is
 * counted once, however many plans name it.
 */
function liveRowMetrics(payloads) {
  let visitors = 0;
  const lifts = [];
  const confidences = [];
  payloads.forEach(payload => {
    const summary = payload?.summary || {};
    const fromSummary = finiteOrNull(summary.visitors);
    const fromArms = (Array.isArray(payload?.arms) ? payload.arms : []).reduce(
      (sum, arm) => sum + (Number(arm?.visitors) || 0),
      0
    );
    visitors += fromSummary !== null && fromSummary > 0 ? fromSummary : fromArms;
    // Below the sample floors the server withholds a reading; so does the list.
    if (payload?.significance?.sampleReady === false) return;
    const lift = finiteOrNull(summary.lift ?? payload?.significance?.lift);
    if (lift !== null) lifts.push(lift);
    const confidence = finiteOrNull(summary.confidence ?? payload?.significance?.confidence);
    if (confidence !== null) confidences.push(confidence);
  });
  return {
    visitors: visitors > 0 ? visitors : null,
    lift: lifts.length ? lifts.reduce((a, b) => a + b, 0) / lifts.length : null,
    confidence: confidences.length ? Math.max(...confidences) : null,
  };
}

/** Attach fetched test analytics onto inbox plans, and the row's live totals. */
export function enrichExperimentsWithListAnalytics(experiments, analyticsByTestId = {}) {
  const map = analyticsByTestId && typeof analyticsByTestId === 'object' ? analyticsByTestId : {};
  if (!Object.keys(map).length) return experiments;

  return (Array.isArray(experiments) ? experiments : []).map(experiment => {
    const plans = Array.isArray(experiment?.plans) ? experiment.plans : [];
    let changed = false;
    const payloadByTest = new Map();
    const nextPlans = plans.map(plan => {
      const testId = String(plan?.test_id || plan?.metadata?.test_id || '').trim();
      const analytics = testId ? map[testId] : null;
      if (!analytics) return plan;
      changed = true;
      payloadByTest.set(testId, analytics);
      return { ...plan, analytics };
    });
    if (!changed) return experiment;
    return {
      ...experiment,
      plans: nextPlans,
      ...liveRowMetrics([...payloadByTest.values()]),
    };
  });
}

/**
 * Load analytics for running/paused tests so Edit test follows per-variation floors.
 * Caps concurrency and count so the list stays responsive on large shops.
 */
export async function fetchListAnalyticsForEditGating(shopDomain, experiments, { limit = 24 } = {}) {
  // Live tests first, so the cap never trades one away for a finished one.
  const live = row => row?.status === 'running' || row?.status === 'paused';
  const finished = row => ['winner_ready', 'applied', 'completed'].includes(row?.status);
  const all = Array.isArray(experiments) ? experiments : [];
  const rows = [...all.filter(live), ...all.filter(finished)];
  const testIds = [
    ...new Set(rows.flatMap(row => collectExperimentTestIds(row?.plans || []))),
  ].slice(0, limit);
  if (!testIds.length) return {};

  const results = await mapWithConcurrency(testIds, async testId => {
    try {
      return await getSmartPricingTestAnalytics(shopDomain, testId);
    } catch {
      return null;
    }
  });

  const analyticsByTestId = {};
  testIds.forEach((testId, index) => {
    if (results[index]) analyticsByTestId[testId] = results[index];
  });
  return analyticsByTestId;
}
