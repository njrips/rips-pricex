import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, unwrapData } from '../services';
import {
  getSmartPricingGuardrails,
  getSmartPricingInboxPlan,
  getSmartPricingOpportunities,
  getSmartPricingTestAnalytics,
} from '../services/smartPricingApi';
import {
  readInboxPlans,
  updateInboxPlan,
  writeInboxPlans,
} from '../components/SmartPricing/smartPricingConstants';
import { hydrateInboxFromServer } from '../components/SmartPricing/smartPricingInboxPersistence';
import {
  findExperimentByPlanId,
  findPlanInCatalog,
} from '../components/SmartPricing/classic/classicExperimentHelpers';
import {
  buildActivityTimeline,
  buildAudienceSummary,
  buildConversionRows,
  buildMetricsSummary,
  buildOverviewKpis,
  buildProductPerformanceGrid,
  buildSettingsSummary,
  buildVariationAveragePerformance,
  buildVariationsSummary,
  collectExperimentTestIds,
  mergeExperimentAnalytics,
} from '../components/SmartPricing/classic/classicExperimentDetailsHelpers';

function unwrapTest(payload) {
  if (!payload) return null;
  if (payload.test && typeof payload.test === 'object') return payload.test;
  if (payload.id && (payload.variants || payload.status || payload.type)) return payload;
  return null;
}

export function useClassicExperimentDetails(shopDomain, planId) {
  const [allPlans, setAllPlans] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [analyticsByTestId, setAnalyticsByTestId] = useState({});
  const [test, setTest] = useState(null);
  const [qaRuns, setQaRuns] = useState([]);
  const [shopGuardrails, setShopGuardrails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('error');
  const [reloadKey, setReloadKey] = useState(0);
  const handleBackfillKeyRef = useRef('');

  const refresh = useCallback(() => {
    setReloadKey(key => key + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setMessage('');
      try {
        const local = readInboxPlans(shopDomain) || [];
        const hydrated = await hydrateInboxFromServer(shopDomain, local).catch(() => null);
        let nextPlans = Array.isArray(hydrated?.plans) ? hydrated.plans : local;

        const needle = String(planId || '').trim();
        if (needle && !findPlanInCatalog(nextPlans, needle)) {
          const remotePlan = await getSmartPricingInboxPlan(shopDomain, needle).catch(() => null);
          const row = remotePlan?.plan || null;
          if (row?.id && !nextPlans.some(p => p.id === row.id)) {
            nextPlans = [...nextPlans, row];
          }
        }

        if (!cancelled) {
          setAllPlans(nextPlans);
          if (nextPlans.length) {
            writeInboxPlans(shopDomain, nextPlans, { persist: false });
          }
        }

        const guardrails = await getSmartPricingGuardrails(shopDomain).catch(() => null);
        if (guardrails && !cancelled) {
          setShopGuardrails(
            guardrails.guardrails && typeof guardrails.guardrails === 'object'
              ? guardrails.guardrails
              : guardrails
          );
        }
      } catch (err) {
        if (!cancelled) {
          setMessageType('error');
          setMessage(err.message || 'Could not load experiment.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shopDomain, planId, reloadKey]);

  const experiment = useMemo(() => findExperimentByPlanId(allPlans, planId), [allPlans, planId]);
  const plan = experiment?.representative || findPlanInCatalog(allPlans, planId) || null;
  const testId = plan?.test_id || null;
  const experimentPlans = useMemo(
    () =>
      Array.isArray(experiment?.plans) && experiment.plans.length
        ? experiment.plans
        : plan
          ? [plan]
          : [],
    [experiment?.plans, plan]
  );
  const experimentTestIds = useMemo(
    () => collectExperimentTestIds(experimentPlans, testId),
    [experimentPlans, testId]
  );
  const experimentTestIdsKey = experimentTestIds.join('|');

  // Backfill storefront handles for older inbox plans that predate catalog handle persistence.
  useEffect(() => {
    let cancelled = false;
    const experimentPlans = Array.isArray(experiment?.plans) ? experiment.plans : [];
    const missingIds = experimentPlans
      .filter(
        row =>
          row?.product_id &&
          !String(row.handle || row.product_handle || row.metadata?.handle || '').trim()
      )
      .map(row => String(row.id || row.product_id))
      .sort();
    const backfillKey = `${shopDomain || ''}:${experiment?.id || ''}:${missingIds.join(',')}`;
    if (!shopDomain || !missingIds.length) return undefined;
    if (handleBackfillKeyRef.current === backfillKey) return undefined;

    (async () => {
      const payload = await getSmartPricingOpportunities(shopDomain, { filter: 'all' }).catch(
        () => null
      );
      if (cancelled) return;
      const opportunities =
        payload?.opportunities || payload?.rows || payload?.data?.opportunities || [];
      if (!Array.isArray(opportunities) || !opportunities.length) return;

      const byProduct = new Map();
      const byVariant = new Map();
      opportunities.forEach(opp => {
        const handle = String(opp?.handle || opp?.product_handle || '').trim();
        if (!handle) return;
        if (opp.product_id) byProduct.set(String(opp.product_id), handle);
        if (opp.variant_id) byVariant.set(String(opp.variant_id), handle);
      });
      if (!byProduct.size && !byVariant.size) return;

      // Mark attempted only after a usable catalog response so empty/failed fetches can retry.
      handleBackfillKeyRef.current = backfillKey;

      const patches = new Map();
      experimentPlans.forEach(row => {
        if (String(row.handle || row.product_handle || row.metadata?.handle || '').trim()) return;
        const handle =
          byVariant.get(String(row.variant_id || '')) ||
          byProduct.get(String(row.product_id || '')) ||
          '';
        if (!handle || !row.id) return;
        patches.set(row.id, {
          handle,
          product_handle: handle,
          metadata: {
            ...(row.metadata || {}),
            handle,
            product_handle: handle,
          },
        });
      });
      if (!patches.size) return;

      setAllPlans(prev =>
        prev.map(row => {
          const patch = patches.get(row.id);
          return patch ? { ...row, ...patch } : row;
        })
      );
      patches.forEach((patch, id) => {
        try {
          updateInboxPlan(shopDomain, id, patch);
        } catch {
          // local persistence is best-effort
        }
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [shopDomain, experiment?.id, experiment?.plans]);

  useEffect(() => {
    let cancelled = false;
    if (!shopDomain || !experimentTestIds.length) {
      setAnalytics(null);
      setAnalyticsByTestId({});
      setTest(null);
      setQaRuns([]);
      setAnalyticsLoading(false);
      return undefined;
    }

    (async () => {
      setAnalyticsLoading(true);
      let analyticsError = '';
      try {
        const analyticsEntries = await Promise.all(
          experimentTestIds.map(async id => {
            try {
              const data = await getSmartPricingTestAnalytics(shopDomain, id);
              return [id, data];
            } catch (err) {
              if (!analyticsError) {
                analyticsError = err?.message || 'Could not load Smart Pricing analytics.';
              }
              return [id, null];
            }
          })
        );
        if (cancelled) return;

        const nextByTestId = {};
        analyticsEntries.forEach(([id, data]) => {
          if (data) nextByTestId[id] = data;
        });
        setAnalyticsByTestId(nextByTestId);

        const primaryAnalytics =
          (testId && nextByTestId[String(testId)]) || Object.values(nextByTestId)[0] || null;
        const merged = mergeExperimentAnalytics(nextByTestId, primaryAnalytics);
        setAnalytics(merged);

        const [testRes, qaRes] = await Promise.all([
          testId
            ? apiGet(`/tests/${encodeURIComponent(testId)}`)
                .then(res => unwrapTest(unwrapData(res)))
                .catch(() => null)
            : Promise.resolve(null),
          testId
            ? apiGet(`/qa/tests/${encodeURIComponent(testId)}/runs`)
                .then(res => {
                  const body = unwrapData(res);
                  const runs = body?.runs || body;
                  return Array.isArray(runs) ? runs.slice(0, 8) : [];
                })
                .catch(() => [])
            : Promise.resolve([]),
        ]);
        if (cancelled) return;
        setTest(testRes);
        setQaRuns(qaRes);
        // Surface hard failures, but avoid toast spam for transient/empty analytics.
        if (
          analyticsError &&
          !Object.keys(nextByTestId).length &&
          !/not linked to smart pricing/i.test(analyticsError)
        ) {
          setMessageType('error');
          setMessage(analyticsError);
        }
      } finally {
        if (!cancelled) setAnalyticsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [shopDomain, testId, experimentTestIds, experimentTestIdsKey, reloadKey]);

  const kpis = useMemo(
    () => buildOverviewKpis({ analytics, plan, experiment }),
    [analytics, plan, experiment]
  );
  const conversionRows = useMemo(() => buildConversionRows({ analytics, plan }), [analytics, plan]);
  const variationAverages = useMemo(
    () =>
      buildVariationAveragePerformance({
        plan,
        plans: experimentPlans,
        analyticsByTestId,
        analytics,
      }),
    [plan, experimentPlans, analyticsByTestId, analytics]
  );
  const productPerformanceRows = useMemo(
    () =>
      buildProductPerformanceGrid({
        plan,
        plans: experimentPlans,
        analyticsByTestId,
        analytics,
      }),
    [plan, experimentPlans, analyticsByTestId, analytics]
  );
  const variations = useMemo(
    () =>
      buildVariationsSummary(plan, analytics, {
        plans: experimentPlans,
        test,
      }),
    [plan, analytics, experimentPlans, test]
  );
  const audience = useMemo(() => buildAudienceSummary(plan, test), [plan, test]);
  const metrics = useMemo(() => buildMetricsSummary(plan, test), [plan, test]);
  const activity = useMemo(
    () => buildActivityTimeline({ plan, test, analytics, qaRuns }),
    [plan, test, analytics, qaRuns]
  );
  const settings = useMemo(
    () => buildSettingsSummary(plan, test, shopGuardrails),
    [plan, test, shopGuardrails]
  );

  const patchPlanLocal = useCallback(
    patch => {
      if (!plan?.id || !shopDomain) return;
      updateInboxPlan(shopDomain, plan.id, patch);
      setAllPlans(prev => prev.map(row => (row.id === plan.id ? { ...row, ...patch } : row)));
    },
    [plan?.id, shopDomain]
  );

  return {
    loading,
    analyticsLoading,
    allPlans,
    experiment,
    plan,
    test,
    testId,
    analytics,
    analyticsByTestId,
    qaRuns,
    kpis,
    conversionRows,
    variationAverages,
    productPerformanceRows,
    variations,
    audience,
    metrics,
    activity,
    settings,
    message,
    messageType,
    setMessage,
    setMessageType,
    refresh,
    patchPlanLocal,
  };
}
