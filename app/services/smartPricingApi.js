import {
  compactInboxPlan,
  compactInboxPlans,
} from '../components/SmartPricing/classic/classicWizardDraftSize';
import { apiGet, apiPost, apiPut, apiDelete, unwrapData } from './api';

export async function getSmartPricingGuardrails(domain) {
  const res = await apiGet('/smart-pricing/guardrails', domain ? { domain } : {});
  return unwrapData(res);
}

export async function saveSmartPricingGuardrails(domain, body) {
  const res = await apiPost(
    '/smart-pricing/guardrails',
    body,
    domain ? { params: { domain } } : {}
  );
  return unwrapData(res);
}

export async function getSmartPricingOpportunities(
  domain,
  {
    filter = 'all',
    search = '',
    collectionId = '',
    productSearch = '',
    refresh = false,
    // 'background' answers without waiting for the AI ranking; 'off' skips it.
    aiRanking = '',
    // Lets `getSmartPricingOpportunitiesProgress` follow this load.
    progressId = '',
    demo = false,
  } = {}
) {
  const res = await apiGet('/smart-pricing/opportunities', {
    ...(domain ? { domain } : {}),
    filter,
    search,
    ...(collectionId ? { collection_id: collectionId } : {}),
    ...(productSearch ? { product_search: productSearch } : {}),
    ...(refresh ? { refresh: '1' } : {}),
    ...(aiRanking ? { ai_ranking: aiRanking } : {}),
    ...(progressId ? { progress_id: progressId } : {}),
    ...(demo ? { demo: '1' } : {}),
  });
  return unwrapData(res);
}

/**
 * How far the load started with `progressId` has got:
 * `{ stage, loaded, total, done }`, or `null` when the server cannot say.
 */
export async function getSmartPricingOpportunitiesProgress(domain, progressId) {
  const res = await apiGet('/smart-pricing/opportunities/progress', {
    ...(domain ? { domain } : {}),
    id: progressId,
  });
  return unwrapData(res)?.progress || null;
}

export async function createSmartPricingBatch(domain, body) {
  const res = await apiPost(
    '/smart-pricing/batches/create',
    body,
    domain ? { params: { domain } } : {}
  );
  return unwrapData(res);
}

export async function launchSmartPricingPlan(
  domain,
  plan,
  { status = 'draft', autoStart = false } = {}
) {
  try {
    const res = await apiPost(
      '/smart-pricing/plans/launch',
      { plan: compactInboxPlan(plan), status, auto_start: autoStart },
      domain ? { params: { domain }, timeout: 45000 } : { timeout: 45000 }
    );
    return unwrapData(res);
  } catch (err) {
    const code = String(err?.code || err?.name || '').toUpperCase();
    if (
      !err?.response &&
      (code === 'ECONNABORTED' || code === 'ERR_CANCELED' || /timeout/i.test(String(err?.message || '')))
    ) {
      err.message =
        'Launch timed out while starting the test. Open Store setup, refresh Checkout pricing functions status, then try again.';
    }
    throw err;
  }
}

export async function previewSmartPricingWinner(domain, testId) {
  const res = await apiGet(`/smart-pricing/tests/${encodeURIComponent(testId)}/winner-preview`, {
    ...(domain ? { domain } : {}),
  });
  return unwrapData(res);
}

export async function applySmartPricingWinner(
  domain,
  testId,
  { publishToShopify = true, dryRun = false, variantIndex, stopIfRunning = false } = {}
) {
  const res = await apiPost(
    `/smart-pricing/tests/${encodeURIComponent(testId)}/apply-winner`,
    {
      publish_to_shopify: publishToShopify,
      dry_run: dryRun,
      // Applying one product in a multi-product experiment stops that product
      // only; the rest of the experiment keeps collecting.
      stop_if_running: stopIfRunning,
      ...(variantIndex !== undefined && variantIndex !== null
        ? { variant_index: variantIndex }
        : {}),
    },
    domain ? { params: { domain } } : {}
  );
  return unwrapData(res);
}

/** Ends one product with no catalog write: a control win or a winning offer. */
export async function finishSmartPricingProduct(domain, testId) {
  const res = await apiPost(
    `/smart-pricing/tests/${encodeURIComponent(testId)}/finish-product`,
    {},
    domain ? { params: { domain } } : {}
  );
  return unwrapData(res);
}

/** Stop one product's test without pausing sibling products. */
export async function stopSmartPricingProduct(domain, testId) {
  const res = await apiPost(
    `/smart-pricing/tests/${encodeURIComponent(testId)}/stop-product`,
    {},
    domain ? { params: { domain } } : {}
  );
  return unwrapData(res);
}

/** Resume one previously paused/stopped product test. */
export async function resumeSmartPricingProduct(domain, testId) {
  const res = await apiPost(
    `/smart-pricing/tests/${encodeURIComponent(testId)}/resume-product`,
    {},
    domain ? { params: { domain } } : {}
  );
  return unwrapData(res);
}

/**
 * Stop serving a decided product's price, so a new test may include it.
 *
 * The catalog keeps the applied price; this only ends the personalization that
 * would otherwise hold the product for ever.
 */
export async function releaseSmartPricingProduct(domain, testId) {
  const res = await apiPost(
    `/smart-pricing/tests/${encodeURIComponent(testId)}/release-product`,
    {},
    domain ? { params: { domain } } : {}
  );
  return unwrapData(res);
}

/** Revert catalog prices to the snapshot taken at apply time. */
export async function revertSmartPricingProductPrice(
  domain,
  testId,
  { force = false, dryRun = false } = {}
) {
  const res = await apiPost(
    `/smart-pricing/tests/${encodeURIComponent(testId)}/revert-price`,
    { force, dry_run: dryRun },
    domain ? { params: { domain } } : {}
  );
  return unwrapData(res);
}

/** Queue a follow-up learning round for winners or losers. */
export async function rerunSmartPricingProduct(
  domain,
  testId,
  { armPrices = null, useAiSuggestion = false, note = null } = {}
) {
  const res = await apiPost(
    `/smart-pricing/tests/${encodeURIComponent(testId)}/rerun`,
    {
      ...(armPrices && typeof armPrices === 'object' ? { arm_prices: armPrices } : {}),
      use_ai_suggestion: useAiSuggestion,
      ...(note ? { note } : {}),
    },
    domain ? { params: { domain } } : {}
  );
  return unwrapData(res);
}

/** Full per-product report: lineage, analytics, events. */
export async function getSmartPricingProductReport(domain, planId) {
  const res = await apiGet(
    `/smart-pricing/products/${encodeURIComponent(planId)}/report`,
    domain ? { domain } : {}
  );
  return unwrapData(res);
}

/** Day-by-day visitors, orders and revenue per variation for one product. */
export async function getSmartPricingProductDaily(domain, planId) {
  const res = await apiGet(
    `/smart-pricing/products/${encodeURIComponent(planId)}/daily`,
    domain ? { domain } : {}
  );
  return unwrapData(res);
}

export async function getSmartPricingProductEvents(domain, planId, { limit = 100 } = {}) {
  const res = await apiGet(`/smart-pricing/products/${encodeURIComponent(planId)}/events`, {
    ...(domain ? { domain } : {}),
    limit: String(limit),
  });
  return unwrapData(res);
}

/** Applies every product that has reached a verdict, one at a time, server side. */
export async function applyReadySmartPricingProducts(domain, testIds = []) {
  const res = await apiPost(
    '/smart-pricing/products/apply-ready',
    { test_ids: testIds },
    domain ? { params: { domain } } : {}
  );
  return unwrapData(res);
}

export async function getSmartPricingInboxPlans(domain, filters = {}) {
  const res = await apiGet('/smart-pricing/inbox/plans', {
    ...(domain ? { domain } : {}),
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.archived !== undefined && filters.archived !== null
      ? { archived: String(filters.archived) }
      : {}),
    ...(filters.limit ? { limit: String(filters.limit) } : {}),
    ...(filters.offset ? { offset: String(filters.offset) } : {}),
  });
  return unwrapData(res);
}

/** Fetch one inbox plan by plan id or linked RipX test id. */
export async function getSmartPricingInboxPlan(domain, planId) {
  const res = await apiGet(
    `/smart-pricing/inbox/plans/${encodeURIComponent(planId)}`,
    domain ? { domain } : {}
  );
  return unwrapData(res);
}

/** Create/reuse a draft price test so Classic Preview works for queued plans. */
export async function ensureSmartPricingPlanPreviewTest(domain, planId, extras = {}) {
  const plan = extras.plan && typeof extras.plan === 'object' ? extras.plan : null;
  const plans = Array.isArray(extras.plans) ? extras.plans : [];
  const res = await apiPost(
    `/smart-pricing/inbox/plans/${encodeURIComponent(planId)}/ensure-preview-test`,
    {
      ...(plan ? { plan } : {}),
      ...(plans.length ? { plans } : {}),
    },
    domain ? { params: { domain } } : {}
  );
  return unwrapData(res);
}

export async function suggestSmartPricingPrices(domain, body = {}) {
  const res = await apiPost(
    '/smart-pricing/plans/suggest-prices',
    body,
    domain ? { params: { domain } } : {}
  );
  return unwrapData(res);
}

export async function suggestSmartPricingGoals(domain, plans = []) {
  const res = await apiPost(
    '/smart-pricing/plans/suggest-goals',
    { plans },
    domain ? { params: { domain } } : {}
  );
  return unwrapData(res);
}

export async function batchPreviewSmartPricingLaunch(domain, plans = []) {
  const res = await apiPost(
    '/smart-pricing/plans/batch-preview-launch',
    { plans },
    domain ? { params: { domain } } : {}
  );
  return unwrapData(res);
}

export async function getSmartPricingInboxSummary(domain) {
  const res = await apiGet('/smart-pricing/inbox/summary', domain ? { domain } : {});
  return unwrapData(res);
}

export async function getSmartPricingCheckoutReadiness(domain) {
  const res = await apiGet('/smart-pricing/checkout-readiness', domain ? { domain } : {});
  return unwrapData(res);
}

export async function saveSmartPricingInboxPlans(
  domain,
  plans,
  { deletedPlanIds = [], revision = null } = {}
) {
  const res = await apiPut(
    '/smart-pricing/inbox/plans',
    {
      plans: compactInboxPlans(plans),
      ...(deletedPlanIds.length ? { deleted_plan_ids: deletedPlanIds } : {}),
      ...(revision ? { expected_revision: revision } : {}),
    },
    domain ? { params: { domain } } : {}
  );
  return unwrapData(res);
}

/** Visitors who entered any test since the start of this month, in local time. */
export async function getSmartPricingMonthVisitors(domain, now = new Date()) {
  const since = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const res = await apiGet('/smart-pricing/visitors/month', {
    since,
    ...(domain ? { domain } : {}),
  });
  return unwrapData(res);
}

export async function getSmartPricingTestAnalytics(domain, testId) {
  const res = await apiGet(`/smart-pricing/tests/${encodeURIComponent(testId)}/analytics`, {
    ...(domain ? { domain } : {}),
  });
  return unwrapData(res);
}

export async function deleteSmartPricingInboxPlan(domain, planId) {
  const res = await apiDelete(
    `/smart-pricing/inbox/plans/${encodeURIComponent(planId)}`,
    domain ? { params: { domain } } : {}
  );
  return unwrapData(res);
}

/** The experiment's tests that are not deleted, as `{ id, status, product_id, plan_id }`. */
export async function getSmartPricingExperimentTests(domain, experimentId) {
  const res = await apiGet(
    `/smart-pricing/experiments/${encodeURIComponent(experimentId)}/tests`,
    domain ? { domain } : {}
  );
  const data = unwrapData(res);
  return Array.isArray(data?.tests) ? data.tests : [];
}

/**
 * Deletes an experiment in one server transaction: archives its tests, removes
 * its plans and its draft, and records the deletion so no stale copy restores
 * it. Safe to repeat.
 */
export async function deleteSmartPricingExperimentCompletely(
  domain,
  { experimentId = '', planIds = [], testIds = [] } = {}
) {
  const res = await apiPost(
    '/smart-pricing/experiments/delete',
    { experiment_id: experimentId || '', plan_ids: planIds, test_ids: testIds },
    domain ? { params: { domain } } : {}
  );
  return unwrapData(res);
}

/** Experiments deleted within the grace period, which can still be restored. */
export async function getRestorableSmartPricingExperiments(domain) {
  const res = await apiGet('/smart-pricing/experiments/deleted', domain ? { domain } : {});
  return unwrapData(res);
}

/** Undo a delete within the grace period; the experiment comes back archived. */
export async function restoreSmartPricingExperiment(
  domain,
  { experimentId = '', testIds = [] } = {}
) {
  const res = await apiPost(
    '/smart-pricing/experiments/restore',
    { experiment_id: experimentId || '', test_ids: testIds },
    domain ? { params: { domain } } : {}
  );
  return unwrapData(res);
}

/** Push settings saved on a paused experiment's plans onto its tests, so Resume uses them. */
export async function applyPausedSmartPricingSettings(domain, testIds = []) {
  const res = await apiPost(
    '/smart-pricing/experiments/apply-paused-settings',
    { test_ids: testIds },
    domain ? { params: { domain } } : {}
  );
  return unwrapData(res);
}

/** Archives every test launched from the experiment and removes its inbox plans. */
export async function deleteSmartPricingExperiment(domain, experimentId) {
  const res = await apiDelete(
    `/smart-pricing/experiments/${encodeURIComponent(experimentId)}`,
    domain ? { params: { domain } } : {}
  );
  return unwrapData(res);
}

/**
 * Unfinished create-wizard experiments. Kept apart from inbox plans because a
 * draft only named and not yet given products has no plans to store there.
 */
export async function getSmartPricingWizardDrafts(domain) {
  const res = await apiGet('/smart-pricing/wizard-drafts', domain ? { domain } : {});
  return unwrapData(res);
}

export async function saveSmartPricingWizardDraft(domain, draft) {
  const res = await apiPut(
    '/smart-pricing/wizard-drafts',
    { draft },
    domain ? { params: { domain } } : {}
  );
  return unwrapData(res);
}

export async function deleteSmartPricingWizardDraft(domain, experimentId) {
  const res = await apiDelete(
    `/smart-pricing/wizard-drafts/${encodeURIComponent(experimentId)}`,
    domain ? { params: { domain } } : {}
  );
  return unwrapData(res);
}
