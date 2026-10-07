import { getSmartPricingExperimentTests } from '../../../services/smartPricingApi';
import { getPlanExperimentId, normalizePlanStatus } from './classicExperimentHelpers';
import { collectExperimentTestIds, isSettledClassicPlan } from './classicExperimentListActions';

const testIdOfPlan = plan => String(plan?.test_id || plan?.metadata?.test_id || '').trim();

/**
 * The test ids an experiment-level Pause, Stop or Resume should reach.
 *
 * The plans in this browser are not a complete list of an experiment's tests:
 * a plan can be missing locally while its test runs on, and an action built
 * from the plans alone left that test pricing shoppers behind a row that read
 * Paused or Completed. So the server is asked for the experiment's tests too,
 * and any in `statuses` are added -- except products whose winner is
 * published, which these actions never touch.
 *
 * If the server cannot be reached the listed ids are used as before, so the
 * action still does everything it used to.
 */
export async function withUnlistedExperimentTests(
  shopDomain,
  plans,
  listedTestIds,
  { statuses = [] } = {}
) {
  const rows = Array.isArray(plans) ? plans : [];
  const listed = Array.isArray(listedTestIds) ? listedTestIds : [];
  const experimentIds = [...new Set(rows.map(getPlanExperimentId).filter(Boolean))];
  if (experimentIds.length !== 1 || !statuses.length) return listed;

  let tests;
  try {
    tests = await getSmartPricingExperimentTests(shopDomain, experimentIds[0]);
  } catch {
    return listed;
  }
  const settled = new Set(rows.filter(isSettledClassicPlan).map(testIdOfPlan).filter(Boolean));
  const seen = new Set(listed);
  const extra = (Array.isArray(tests) ? tests : [])
    .filter(row => statuses.includes(String(row?.status || '').toLowerCase()))
    .map(row => String(row?.id || '').trim())
    .filter(id => id && !seen.has(id) && !settled.has(id));
  return [...listed, ...extra];
}

/**
 * Stops a paused experiment's tests on the way to Archive.
 *
 * A paused test keeps its products reserved so Resume can have them back, and
 * an archived experiment offers no Resume. Archived while paused, it went on
 * holding every product, and the create wizard counted them as "in other
 * tests" with nothing on the list that could free them.
 *
 * `stopEach(ids)` posts the stops and resolves `{ succeeded }`; the ids that
 * stopped are returned so their plans can be marked finished.
 */
export async function stopPausedTestsBeforeArchive(shopDomain, plans, stopEach) {
  const rows = Array.isArray(plans) ? plans : [];
  const listed = collectExperimentTestIds(
    rows.filter(plan => normalizePlanStatus(plan) === 'paused'),
    { skipSettled: true }
  );
  const ids = await withUnlistedExperimentTests(shopDomain, rows, listed, {
    statuses: ['paused'],
  });
  if (!ids.length) return [];
  const { succeeded } = await stopEach(ids);
  return Array.isArray(succeeded) ? succeeded : [];
}
