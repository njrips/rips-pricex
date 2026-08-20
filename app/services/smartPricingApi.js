import { apiGet, apiPost, apiPut, apiDelete, apiPatch, unwrapData } from './api';

export async function getSmartPricingStatus(domain) {
  const res = await apiGet('/smart-pricing/status', domain ? { domain } : {});
  return unwrapData(res);
}

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
    ...(demo ? { demo: '1' } : {}),
  });
  return unwrapData(res);
}

export async function refreshSmartPricingOpportunities(domain, body = {}) {
  const res = await apiPost(
    '/smart-pricing/opportunities/refresh',
    body,
    domain ? { params: { domain } } : {}
  );
  return unwrapData(res);
}

export async function createSmartPricingBatch(domain, body) {
  const res = await apiPost(
    '/smart-pricing/batches/create',
    body,
    domain ? { params: { domain } } : {}
  );
  return unwrapData(res);
}

export async function applySmartPricingPriceArms(domain, plan, armPrices = {}) {
  const res = await apiPost(
    '/smart-pricing/plans/apply-price-arms',
    { plan, arm_prices: armPrices },
    domain ? { params: { domain } } : {}
  );
  return unwrapData(res);
}

export async function previewSmartPricingPlan(domain, body) {
  const res = await apiPost(
    '/smart-pricing/plans/preview',
    body,
    domain ? { params: { domain } } : {}
  );
  return unwrapData(res);
}

export async function getSmartPricingDemoBatch(domain) {
  const res = await apiGet('/smart-pricing/plans/demo-batch', domain ? { domain } : {});
  return unwrapData(res);
}

export async function getSmartPricingVariantOptions(domain, body) {
  const res = await apiPost(
    '/smart-pricing/variant-options',
    body,
    domain ? { params: { domain } } : {}
  );
  return unwrapData(res);
}

export async function quickStartSmartPricing(domain, body = {}) {
  const res = await apiPost(
    '/smart-pricing/quick-start',
    body,
    domain ? { params: { domain } } : {}
  );
  return unwrapData(res);
}

export async function getSmartPricingLaunchCapacity(domain, { count = 0 } = {}) {
  const res = await apiGet('/smart-pricing/launch-capacity', {
    ...(domain ? { domain } : {}),
    count: String(count),
  });
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
      { plan, status, auto_start: autoStart },
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
        'Launch timed out while starting the test. Open Setup, tap Ensure on the checkout discount, then try again.';
    }
    throw err;
  }
}

export async function previewSmartPricingScenario(domain, body) {
  const res = await apiPost(
    '/smart-pricing/scenario-preview',
    body,
    domain ? { params: { domain } } : {}
  );
  return unwrapData(res);
}

export async function getSmartPricingCogs(domain) {
  const res = await apiGet('/smart-pricing/cogs', domain ? { domain } : {});
  return unwrapData(res);
}

export async function importSmartPricingCogs(domain, csvText) {
  const res = await apiPost(
    '/smart-pricing/cogs/import',
    { csv: csvText },
    domain ? { params: { domain } } : {}
  );
  return unwrapData(res);
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
  { publishToShopify = true, dryRun = false, variantIndex } = {}
) {
  const res = await apiPost(
    `/smart-pricing/tests/${encodeURIComponent(testId)}/apply-winner`,
    {
      publish_to_shopify: publishToShopify,
      dry_run: dryRun,
      ...(variantIndex !== undefined && variantIndex !== null
        ? { variant_index: variantIndex }
        : {}),
    },
    domain ? { params: { domain } } : {}
  );
  return unwrapData(res);
}

export async function syncSmartPricingInbox(domain, plans = []) {
  const res = await apiPost(
    '/smart-pricing/inbox/sync',
    { plans },
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

export async function patchSmartPricingInboxPlan(domain, planId, patch = {}) {
  const res = await apiPatch(
    `/smart-pricing/inbox/plans/${encodeURIComponent(planId)}`,
    patch,
    domain ? { params: { domain } } : {}
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

export async function suggestSmartPricingAudience(domain, plans = [], options = {}) {
  const res = await apiPost(
    '/smart-pricing/plans/suggest-audience',
    {
      plans,
      use_ai: options.useAi === true || options.use_ai === true,
      catalog_hints: options.catalogHints || options.catalog_hints || undefined,
    },
    domain ? { params: { domain } } : {}
  );
  return unwrapData(res);
}

export async function suggestSmartPricingHypothesis(domain, body = {}) {
  const res = await apiPost(
    '/smart-pricing/plans/suggest-hypothesis',
    body,
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
      plans,
      ...(deletedPlanIds.length ? { deleted_plan_ids: deletedPlanIds } : {}),
      ...(revision ? { expected_revision: revision } : {}),
    },
    domain ? { params: { domain } } : {}
  );
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
