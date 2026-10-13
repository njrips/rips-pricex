import { getSmartPricingExperimentTests } from '../../../services/smartPricingApi';
import { getPlanExperimentId, normalizePlanStatus } from './classicExperimentHelpers';
import {
  collectExperimentTestIds,
  isSettledClassicPlan,
  splitSettledByIds,
} from './classicExperimentListActions';

const testIdOfPlan = plan => String(plan?.test_id || plan?.metadata?.test_id || '').trim();

/**
 * The products an experiment-level Pause should reach: the running ones.
 *
 * An experiment keeps every product it ever tested, and Pause used to be sent
 * to all of them. The finished ones were put back on hold, and a product whose
 * winner was ready came back as one waiting to resume.
 */
export function runningExperimentTestIds(plans) {
  const rows = Array.isArray(plans) ? plans : [];
  return collectExperimentTestIds(
    rows.filter(plan => normalizePlanStatus(plan) === 'running'),
    { skipSettled: true }
  );
}

/** No answer at all, or the server failing rather than refusing. */
export function isTransientLifecycleFailure(error) {
  if (!error) return false;
  const status = Number(error?.response?.status);
  if (!error.response) return true;
  return status >= 500 || status === 429;
}

const RETRY_DELAY_MS = 800;

/**
 * Posts `/tests/:id/:action` for each id and reports which were accepted.
 *
 * Products that failed for a transient reason are sent once more. Pause and
 * Stop are safe to repeat, and a brief overload used to fail the whole click
 * with the experiment left running and nothing visibly changed.
 *
 * @param {string[]} testIds
 * @param {'pause'|'stop'} action
 * @param {(path: string, body: object) => Promise<unknown>} post
 */
export async function postToEachExperimentTest(
  testIds,
  action,
  post,
  { retryDelayMs = RETRY_DELAY_MS, body = {} } = {}
) {
  const ids = Array.isArray(testIds) ? testIds : [];
  const send = id => post(`/tests/${encodeURIComponent(id)}/${action}`, body);
  const results = await Promise.allSettled(ids.map(send));
  const retry = results
    .map((row, index) =>
      row.status === 'rejected' && isTransientLifecycleFailure(row.reason) ? index : -1
    )
    .filter(index => index >= 0);
  if (retry.length) {
    if (retryDelayMs > 0) await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    const again = await Promise.allSettled(retry.map(index => send(ids[index])));
    retry.forEach((index, k) => {
      results[index] = again[k];
    });
  }
  return splitSettledByIds(ids, results);
}

/**
 * The error to show when no product accepted the action.
 *
 * The server's own words for a refusal; for an outage, something the merchant
 * can act on instead of "Network Error" or a database timeout.
 */
export function lifecycleFailureError(reason, verb = 'pause') {
  if (reason && !isTransientLifecycleFailure(reason) && reason.message) return reason;
  return new Error(
    `Could not ${verb} this test because Priceify did not respond. It is still running; try again in a moment.`
  );
}

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
  { statuses = [], dropListedOutsideStatuses = false } = {}
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
  const serverRows = Array.isArray(tests) ? tests : [];
  const extra = serverRows
    .filter(row => statuses.includes(String(row?.status || '').toLowerCase()))
    .map(row => String(row?.id || '').trim())
    .filter(id => id && !seen.has(id) && !settled.has(id));
  // A plan can still read running after its test was stopped elsewhere, and
  // Pause sent to that test is refused. Only ids the server reported are
  // dropped, so one it left out is still tried.
  const kept = dropListedOutsideStatuses
    ? listed.filter(id => {
        const row = serverRows.find(test => String(test?.id || '').trim() === id);
        return !row || statuses.includes(String(row?.status || '').toLowerCase());
      })
    : listed;
  return [...kept, ...extra];
}

/**
 * Stops a paused experiment's tests on the way to Archive.
 *
 * A paused test keeps its products reserved so Resume can have them back, and
 * an archived experiment offers no Resume. Archived while paused, it went on
 * holding every product, and the create wizard counted them as "in other
 * tests" with nothing on the list that could free them.
 *
 * `stopEach(ids)` posts the stops and resolves `{ succeeded }`, and the ids
 * that stopped are returned. Their plans stay `paused` under the archive, so
 * Restore brings the experiment back as Paused; send the stops with
 * `ARCHIVE_STOP_BODY` so the server keeps it that way too.
 */
export const ARCHIVE_STOP_BODY = Object.freeze({ reason: 'archive' });

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
