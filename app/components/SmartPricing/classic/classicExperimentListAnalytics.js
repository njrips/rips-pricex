import { getSmartPricingTestAnalytics } from '../../../services/smartPricingApi';
import { mapWithConcurrency } from '../../../utils/mapWithConcurrency';
import { collectExperimentTestIds } from './classicExperimentListActions';

/** Attach fetched test analytics onto inbox plans for list-row edit gating. */
export function enrichExperimentsWithListAnalytics(experiments, analyticsByTestId = {}) {
  const map = analyticsByTestId && typeof analyticsByTestId === 'object' ? analyticsByTestId : {};
  if (!Object.keys(map).length) return experiments;

  return (Array.isArray(experiments) ? experiments : []).map(experiment => {
    const plans = Array.isArray(experiment?.plans) ? experiment.plans : [];
    let changed = false;
    const nextPlans = plans.map(plan => {
      const testId = String(plan?.test_id || plan?.metadata?.test_id || '').trim();
      const analytics = testId ? map[testId] : null;
      if (!analytics) return plan;
      changed = true;
      return { ...plan, analytics };
    });
    return changed ? { ...experiment, plans: nextPlans } : experiment;
  });
}

/**
 * Load analytics for running/paused tests so Edit test follows per-variation floors.
 * Caps concurrency and count so the list stays responsive on large shops.
 */
export async function fetchListAnalyticsForEditGating(shopDomain, experiments, { limit = 24 } = {}) {
  const rows = (Array.isArray(experiments) ? experiments : []).filter(
    row => row?.status === 'running' || row?.status === 'paused'
  );
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
