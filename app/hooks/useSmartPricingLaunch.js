import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { ROUTES } from '../constants';
import { launchSmartPricingPlan } from '../services/smartPricingApi';
import { stampLaunchOnPlan } from '../components/SmartPricing/classic/classicActivity';
import { readInboxPlans, updateInboxPlan } from '../components/SmartPricing/smartPricingConstants';

/** A run of failures this long is a cause, not bad luck, so the rest are not tried. */
const MAX_CONSECUTIVE_LAUNCH_FAILURES = 3;

function writeLaunchInboxPatch(shopDomain, plan, data) {
  const testId = data?.inbox_plan?.test_id || data?.test?.id || null;
  const current =
    (readInboxPlans(shopDomain) || []).find(row => row.id === plan.id) || plan;
  const stamped = stampLaunchOnPlan(current, {
    status: data?.inbox_plan?.status || 'running',
    testId,
  });
  updateInboxPlan(shopDomain, plan.id, {
    status: stamped.status,
    test_id: stamped.test_id,
    metadata: stamped.metadata,
  });
  return testId;
}

/**
 * Plans whose saved copy already has a test.
 *
 * The server refuses to start a variant that is already being priced, so a
 * retry after a launch that stopped part way failed on the first plan that had
 * gone live, and could never get to the ones that had not.
 */
export function alreadyLaunchedPlanIds(shopDomain, plans = []) {
  const wanted = new Set((plans || []).map(plan => plan?.id).filter(Boolean));
  const launched = new Set();
  (readInboxPlans(shopDomain) || []).forEach(row => {
    if (row?.id && wanted.has(row.id) && String(row.test_id || '').trim()) launched.add(row.id);
  });
  return launched;
}

export function buildPartialLaunchError({ launched, skipped, failures, requested, stoppedEarly }) {
  const first = failures[0]?.error;
  const reason = first?.message || 'Launch failed.';
  const live = launched + skipped;
  const error = new Error(
    live > 0
      ? `${live} of ${requested} products are live. ${failures.length} could not start${
          stoppedEarly ? ' and the rest were not tried' : ''
        }: ${reason} Press Launch again to start the rest.`
      : reason
  );
  error.details = first?.details;
  error.launched = launched;
  error.failures = failures;
  return error;
}

export function useSmartPricingLaunch(shopDomain) {
  const navigate = useNavigate();
  const [launching, setLaunching] = useState(false);

  const launchOne = useCallback(
    async (plan, { openTest = false } = {}) => {
      setLaunching(true);
      try {
        const data = await launchSmartPricingPlan(shopDomain, plan, { autoStart: true });
        const testId = writeLaunchInboxPatch(shopDomain, plan, data);
        if (openTest && plan?.id) {
          navigate(ROUTES.appSmartPricingPlan(shopDomain, plan.id));
        }
        return { testId, started: true };
      } finally {
        setLaunching(false);
      }
    },
    [navigate, shopDomain]
  );

  /**
   * Starts every plan, one at a time, and keeps going past a single failure.
   *
   * An experiment is one test per variant, so a large one is hundreds of
   * launches. Stopping at the first error left the rest unstarted with no way
   * to resume; now each failure is collected, plans already live are skipped,
   * and the error at the end says how far it got.
   */
  const launchMany = useCallback(
    async (plans, { maxCount, onProgress } = {}) => {
      const list = Array.isArray(plans) ? plans : [];
      if (!list.length) {
        throw new Error('Nothing to launch.');
      }
      setLaunching(true);
      const limit = Number.isFinite(maxCount) && maxCount > 0 ? maxCount : list.length;
      const live = alreadyLaunchedPlanIds(shopDomain, list);
      const failures = [];
      let launched = 0;
      let skipped = 0;
      let consecutiveFailures = 0;
      let stoppedEarly = false;
      const report = () =>
        onProgress?.({ done: launched + skipped + failures.length, total: list.length });

      try {
        for (const plan of list) {
          if (launched >= limit) {
            stoppedEarly = true;
            break;
          }
          if (plan?.id && live.has(plan.id)) {
            skipped += 1;
            report();
            continue;
          }
          try {
            const data = await launchSmartPricingPlan(shopDomain, plan, { autoStart: true });
            writeLaunchInboxPatch(shopDomain, plan, data);
            launched += 1;
            consecutiveFailures = 0;
          } catch (error) {
            failures.push({ plan, error });
            consecutiveFailures += 1;
          }
          report();
          if (consecutiveFailures >= MAX_CONSECUTIVE_LAUNCH_FAILURES) {
            stoppedEarly = true;
            break;
          }
        }
        if (failures.length) {
          throw buildPartialLaunchError({
            launched,
            skipped,
            failures,
            requested: list.length,
            stoppedEarly,
          });
        }
        return { launched, skipped, stoppedEarly, requested: list.length };
      } finally {
        setLaunching(false);
      }
    },
    [shopDomain]
  );

  return { launching, launchOne, launchMany };
}
