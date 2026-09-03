import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useKeyedState } from './useKeyedState';
import { apiGet, unwrapData } from '../services';
import {
  getSmartPricingGuardrails,
  getSmartPricingInboxPlan,
  getSmartPricingOpportunities,
  getSmartPricingProductEvents,
  getSmartPricingTestAnalytics,
} from '../services/smartPricingApi';
import {
  readInboxPlans,
  updateInboxPlan,
  writeInboxPlans,
} from '../components/SmartPricing/smartPricingConstants';
import { hydrateInboxFromServer, persistInboxPlansNow } from '../components/SmartPricing/smartPricingInboxPersistence';
import {
  findExperimentByPlanId,
  findPlanInCatalog,
} from '../components/SmartPricing/classic/classicExperimentHelpers';
import { mergeInboxPlansById } from '../components/SmartPricing/classic/classicAudienceEdit';
import { mergeQaRuns } from '../components/SmartPricing/classic/classicActivity';
import { mapWithConcurrency } from '../utils/mapWithConcurrency';
import {
  buildActivityTimeline,
  buildAudienceSummary,
  buildConversionRows,
  buildMetricsSummary,
  buildOverviewKpis,
  buildProductPerformanceGrid,
  buildProductRolloutRows,
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
  const [shopGuardrails, setShopGuardrails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('error');
  const [reloadKey, setReloadKey] = useState(0);
  const hydrateOptionsRef = useRef({});
  const handleBackfillKeyRef = useRef('');
  const autoWinnerRefreshKeyRef = useRef('');

  const refresh = useCallback((hydrateOptions = {}) => {
    hydrateOptionsRef.current =
      hydrateOptions && typeof hydrateOptions === 'object' ? hydrateOptions : {};
    setReloadKey(key => key + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const hydrateOptions = hydrateOptionsRef.current || {};
    hydrateOptionsRef.current = {};
    const quiet = Boolean(hydrateOptions.quiet || hydrateOptions.preferLocalIds);
    (async () => {
      if (!quiet) {
        setLoading(true);
        setMessage('');
      }
      try {
        const local = readInboxPlans(shopDomain) || [];
        const hydrated = await hydrateInboxFromServer(shopDomain, local, hydrateOptions).catch(
          () => null
        );
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

        const guardrails = await getSmartPricingGuardrails(shopDomain).catch(() => ({}));
        if (!cancelled) {
          setShopGuardrails(
            guardrails?.guardrails && typeof guardrails.guardrails === 'object'
              ? guardrails.guardrails
              : guardrails && typeof guardrails === 'object'
                ? guardrails
                : {}
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
  // Read the plans off the experiment first so the memo depends on that list
  // rather than on the whole experiment object.
  const rawExperimentPlans = experiment?.plans;
  const experimentPlans = useMemo(
    () =>
      Array.isArray(rawExperimentPlans) && rawExperimentPlans.length
        ? rawExperimentPlans
        : plan
          ? [plan]
          : [],
    [rawExperimentPlans, plan]
  );
  const experimentTestIds = useMemo(
    () => collectExperimentTestIds(experimentPlans, testId),
    [experimentPlans, testId]
  );
  const experimentTestIdsKey = experimentTestIds.join('|');

  // Analytics for the whole experiment, keyed on the shop and the exact set of
  // product tests it covers. When that set changes the panel reads an empty,
  // already-loading state instead of briefly showing the previous experiment's
  // numbers against the new one.
  const analyticsKey = `${shopDomain || ''}|${experimentTestIdsKey}`;
  const [analyticsState, setAnalyticsState] = useKeyedState(analyticsKey, () => ({
    analytics: null,
    analyticsByTestId: {},
    test: null,
    qaRuns: [],
    serverEvents: [],
    loading: Boolean(shopDomain) && experimentTestIds.length > 0,
  }));
  const {
    analytics,
    analyticsByTestId,
    test,
    qaRuns,
    serverEvents,
    loading: analyticsLoading,
  } = analyticsState;

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
      if (!patches.size || cancelled) return;

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
    if (!shopDomain || !experimentTestIds.length) return undefined;
    let cancelled = false;

    (async () => {
      let analyticsError = '';
      try {
        // A few at a time: an experiment can be dozens of products, and each
        // request costs the API several queries against a smaller pool.
        const analyticsEntries = await mapWithConcurrency(experimentTestIds, async id => {
          try {
            const data = await getSmartPricingTestAnalytics(shopDomain, id);
            return [id, data];
          } catch (err) {
            if (!analyticsError) {
              analyticsError = err?.message || 'Could not load Smart Pricing analytics.';
            }
            return [id, null];
          }
        });
        if (cancelled) return;

        const nextByTestId = {};
        analyticsEntries.forEach(([id, data]) => {
          if (data) nextByTestId[id] = data;
        });

        const primaryAnalytics =
          (testId && nextByTestId[String(testId)]) || Object.values(nextByTestId)[0] || null;
        const merged = mergeExperimentAnalytics(nextByTestId, primaryAnalytics);
        setAnalyticsState(prev => ({
          ...prev,
          analyticsByTestId: nextByTestId,
          analytics: merged,
        }));

        const [testRes, productEventLists, ...qaLists] = await Promise.all([
          testId
            ? apiGet(`/tests/${encodeURIComponent(testId)}`)
                .then(res => unwrapTest(unwrapData(res)))
                .catch(() => null)
            : Promise.resolve(null),
          mapWithConcurrency(
            (Array.isArray(experimentPlans) ? experimentPlans : [])
              .map(row => String(row?.id || '').trim())
              .filter(Boolean)
              .slice(0, 50),
            async id => {
              try {
                const data = await getSmartPricingProductEvents(shopDomain, id, { limit: 40 });
                return Array.isArray(data?.events) ? data.events : [];
              } catch {
                return [];
              }
            }
          ).then(lists => lists.flat()),
          ...experimentTestIds.map(id =>
            apiGet(`/qa/tests/${encodeURIComponent(id)}/runs`)
              .then(res => {
                const body = unwrapData(res);
                const runs = body?.runs || body;
                return Array.isArray(runs) ? runs : [];
              })
              .catch(() => [])
          ),
        ]);
        if (cancelled) return;
        setAnalyticsState(prev => ({
          ...prev,
          test: testRes,
          qaRuns: mergeQaRuns(qaLists, 16),
          serverEvents: Array.isArray(productEventLists) ? productEventLists : [],
        }));
        const autoWinnerKey = Object.entries(nextByTestId)
          .filter(
            ([, row]) => row?.auto_winner?.enforced || row?.revenue_guardrail?.enforced
          )
          .map(
            ([id, row]) =>
              `${id}:${row.auto_winner?.action || ''}:${row.revenue_guardrail?.enforced ? 'rail' : ''}`
          )
          .sort()
          .join('|');
        if (autoWinnerKey && autoWinnerRefreshKeyRef.current !== autoWinnerKey) {
          autoWinnerRefreshKeyRef.current = autoWinnerKey;
          refresh({ quiet: true });
        }
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
        if (!cancelled) setAnalyticsState(prev => ({ ...prev, loading: false }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    shopDomain,
    testId,
    experimentTestIds,
    experimentTestIdsKey,
    experimentPlans,
    reloadKey,
    refresh,
    setAnalyticsState,
  ]);

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
  const rolloutRows = useMemo(
    () => buildProductRolloutRows({ plans: experimentPlans, analyticsByTestId }),
    [experimentPlans, analyticsByTestId]
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
    () =>
      buildActivityTimeline({
        plan,
        test,
        analytics,
        qaRuns,
        plans: experimentPlans,
        serverEvents,
      }),
    [plan, test, analytics, qaRuns, experimentPlans, serverEvents]
  );
  const settings = useMemo(
    () => buildSettingsSummary(plan, test, shopGuardrails),
    [plan, test, shopGuardrails]
  );

  // Read the id out first: closing over `plan` itself would tie this callback
  // to every field on the plan, not just the one it uses.
  const currentPlanId = plan?.id || null;
  const patchPlanLocal = useCallback(
    patch => {
      if (!currentPlanId || !shopDomain) return;
      updateInboxPlan(shopDomain, currentPlanId, patch);
      setAllPlans(prev => prev.map(row => (row.id === currentPlanId ? { ...row, ...patch } : row)));
    },
    [currentPlanId, shopDomain]
  );

  const patchExperimentPlansLocal = useCallback(
    async (patch, { persist = true } = {}) => {
      const ids = new Set(
        (Array.isArray(experimentPlans) ? experimentPlans : [])
          .map(row => String(row?.id || '').trim())
          .filter(Boolean)
      );
      if (!ids.size || !shopDomain) return;
      const apply = row => (ids.has(row.id) ? { ...row, ...patch } : row);
      setAllPlans(prev => prev.map(apply));
      const current = readInboxPlans(shopDomain) || [];
      const next = current.map(apply);
      writeInboxPlans(shopDomain, next, { persist: false });
      if (persist) {
        await persistInboxPlansNow(shopDomain, next);
      }
    },
    [experimentPlans, shopDomain]
  );

  const replaceExperimentPlansLocal = useCallback(
    async (nextPlans, { persist = true } = {}) => {
      const updates = (Array.isArray(nextPlans) ? nextPlans : []).filter(row => row?.id);
      if (!updates.length || !shopDomain) {
        throw new Error('No plans to update.');
      }
      setAllPlans(prev => mergeInboxPlansById(prev, updates));
      const current = readInboxPlans(shopDomain) || [];
      const baseline = current.length ? current : updates;
      const next = mergeInboxPlansById(baseline, updates);
      if (!next.length) {
        throw new Error('No plans to update.');
      }
      writeInboxPlans(shopDomain, next, { persist: false });
      if (persist) {
        await persistInboxPlansNow(shopDomain, next);
      }
    },
    [shopDomain]
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
    rolloutRows,
    variations,
    audience,
    metrics,
    activity,
    settings,
    message,
    messageType,
    setMessage,
    setMessageType,
    shopGuardrails,
    experimentPlans,
    experimentTestIds,
    refresh,
    patchPlanLocal,
    patchExperimentPlansLocal,
    replaceExperimentPlansLocal,
  };
}
