import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { ROUTES } from '../constants';
import { launchSmartPricingPlan } from '../services/smartPricingApi';
import { stampLaunchOnPlan } from '../components/SmartPricing/classic/classicActivity';
import { readInboxPlans, updateInboxPlan } from '../components/SmartPricing/smartPricingConstants';

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

  const launchMany = useCallback(
    async (plans, { maxCount } = {}) => {
      setLaunching(true);
      let launched = 0;
      let stoppedEarly = false;
      const list = Array.isArray(plans) ? plans : [];
      if (!list.length) {
        throw new Error('Nothing to launch.');
      }
      const limit = Number.isFinite(maxCount) && maxCount > 0 ? maxCount : list.length;

      try {
        for (const plan of list) {
          if (launched >= limit) {
            stoppedEarly = true;
            break;
          }
          const data = await launchSmartPricingPlan(shopDomain, plan, { autoStart: true });
          writeLaunchInboxPatch(shopDomain, plan, data);
          launched += 1;
        }
        return { launched, stoppedEarly, requested: list.length };
      } finally {
        setLaunching(false);
      }
    },
    [shopDomain]
  );

  return { launching, launchOne, launchMany };
}
