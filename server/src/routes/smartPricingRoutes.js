const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');
const { sendSuccess, sendValidationError, sendError } = require('../utils/response');
const { HTTP_STATUS } = require('../constants');
const { getShopSession } = require('../models/shopSession');
const { buildVariantCountOptions } = require('../services/smartPricing/statisticalDesignService');
const { applyScenarioPreset } = require('../services/smartPricing/priceBandService');
const {
  listOpportunities,
  clearOpportunityCache,
} = require('../services/smartPricing/opportunityService');
const { createBatchFromSelection } = require('../services/smartPricing/batchService');
const { quickStartBatch } = require('../services/smartPricing/quickStartService');
const {
  launchSmartPricingPlanAsTest,
} = require('../services/smartPricing/smartPricingLaunchService');
const {
  ensureSmartPricingPlanPreviewTest,
} = require('../services/smartPricing/smartPricingPlanPreviewService');
const {
  getShopSmartPricingGuardrails,
  saveShopSmartPricingGuardrails,
} = require('../services/smartPricing/smartPricingGuardrailsService');
const {
  countRunningPriceTests,
  resolveLaunchCapacity,
} = require('../services/smartPricing/smartPricingLaunchGuardService');
const {
  applySmartPricingWinnerRollout,
  previewSmartPricingWinnerRollout,
} = require('../services/smartPricing/smartPricingWinnerRolloutService');
const {
  getSkuCogsOverrides,
  importSkuCogsFromCsv,
  resolveUnitCostWithOverrides,
} = require('../services/smartPricing/smartPricingCogsService');
const { syncInboxPlans } = require('../services/smartPricing/smartPricingInboxSyncService');
const { isSmartPricingEnabled } = require('../services/smartPricing/smartPricingFeatureService');
const {
  listInboxPlans,
  saveInboxPlans,
  deleteInboxPlan,
  patchInboxPlan,
  patchInboxPlansFromSync,
  getInboxPlanById,
  summarizeInboxPlans,
} = require('../models/smartPricingInboxStore');
const {
  buildSmartPricingTestPlan,
  buildDemoBatchPlans,
  applyPriceArmOverrides,
} = require('../services/smartPricing/testPlanService');
const {
  scheduleSmartPricingInboxSync,
} = require('../services/smartPricing/smartPricingInboxStopSyncService');
const {
  resolveSmartPricingCheckoutReadiness,
} = require('../services/smartPricing/smartPricingCheckoutReadinessService');
const {
  maybeAutoQueueRound2Plan,
} = require('../services/smartPricing/smartPricingAutoRound2Service');
const {
  buildSmartPricingTestAnalytics,
} = require('../services/smartPricing/smartPricingTestAnalyticsService');
const {
  suggestAudienceForPlans,
  suggestGoalsForPlans,
  buildBatchPreviewLaunch,
} = require('../services/smartPricing/smartPricingAudienceGoalService');
const {
  suggestHypothesis,
  suggestPrices,
  suggestAudienceAdvanced,
} = require('../services/smartPricing/smartPricingAiSuggestService');
const { hasOpenAiKey } = require('../services/smartPricing/smartPricingAiProvider');

const router = express.Router();

router.use((req, res, next) => {
  if (req.method === 'GET' && req.path === '/status') {
    return next();
  }
  if (!isSmartPricingEnabled()) {
    return sendValidationError(res, ['Smart Pricing is disabled for this environment']);
  }
  next();
});

async function resolveShopifyAccessToken(req) {
  if (req.shopifyAccessToken) {
    return req.shopifyAccessToken;
  }
  const session = await getShopSession(req.shopDomain);
  return session?.access_token || process.env.SHOPIFY_ACCESS_TOKEN || '';
}

router.get(
  '/launch-capacity',
  asyncHandler(async (req, res) => {
    const requestedCount = Number.parseInt(
      String(req.query.count || req.query.requested || '0'),
      10
    );
    const capacity = await resolveLaunchCapacity(req.shopDomain, {
      requestedCount: Number.isFinite(requestedCount) ? requestedCount : 0,
    });
    return sendSuccess(res, HTTP_STATUS.OK, { capacity });
  })
);

router.get(
  '/guardrails',
  asyncHandler(async (req, res) => {
    const guardrails = await getShopSmartPricingGuardrails(req.shopDomain);
    const runningPriceTests = await countRunningPriceTests(req.shopDomain).catch(() => 0);
    return sendSuccess(res, HTTP_STATUS.OK, {
      guardrails,
      running_price_tests: runningPriceTests,
    });
  })
);

router.post(
  '/guardrails',
  asyncHandler(async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const guardrails = await saveShopSmartPricingGuardrails(req.shopDomain, body);
    return sendSuccess(res, HTTP_STATUS.OK, { guardrails });
  })
);

router.get(
  '/status',
  asyncHandler(async (req, res) => {
    let entitled = process.env.RIPSPRICEX_DEV_ENTITLE_ALL === 'true';
    let upgradeUrl = null;
    try {
      const {
        getShopEntitlement,
      } = require('../services/billing/entitlementService');
      const entitlement = await getShopEntitlement(req.shopDomain);
      entitled = Boolean(entitlement?.entitled);
      upgradeUrl = entitlement?.upgradeUrl || null;
    } catch {
      // billing module optional during early boot
    }
    return sendSuccess(res, HTTP_STATUS.OK, {
      enabled: isSmartPricingEnabled(),
      entitled,
      upgradeUrl,
      capabilities: {
        create: entitled,
        launch: entitled,
        preview: entitled,
        apply_winner: entitled,
      },
      phase: 'catalog_v21',
      shop_domain: req.shopDomain || null,
      schema_version: '1.21.0',
      capability_list: [
        'opportunities',
        'catalog_metrics',
        'guardrails',
        'opportunity_refresh',
        'collection_scoped_catalog',
        'ai_ranking',
        'launch_guardrails',
        'launch_capacity',
        'storefront_measured_traffic',
        'traffic_estimation_v2',
        'traffic_cross_check',
        'collection_view_rollups',
        'cogs_import',
        'winner_rollout',
        'inbox_sync',
        'inbox_persistence',
        'inbox_stop_sync',
        'inbox_summary',
        'inbox_archive',
        'inbox_search',
        'command_center',
        'create_wizard_v4',
        'audience_per_sku',
        'goal_suggestions',
        'batch_preview_launch',
        'checkout_readiness_probe',
        'checkout_readiness_cache',
        'checkout_launch_gate',
        'inbox_conflict_merge',
        'inbox_per_plan_merge',
        'inbox_field_merge',
        'test_detail_inline_apply',
        'test_detail_server_persist',
        'launch_inbox_link',
        'launch_cogs_goal',
        'live_checkout_api_probe',
        'auto_round2',
        'winner_ready_detection',
        'plan_preview',
        'batch_create',
        'quick_start',
        'plan_launch',
        'variant_count_options',
        'scenario_presets',
        'demo_batch',
        'background_catalog_refresh',
        'winner_preview_modal',
        'studio_tabs',
        'test_analytics_panel',
        'price_arm_editing',
        'browser_audience_pattern',
        'contextual_guide',
        'sectioned_command_center',
      ],
    });
  })
);

router.get(
  '/opportunities',
  asyncHandler(async (req, res) => {
    const filter = String(req.query.filter || 'all').trim();
    const search = String(req.query.search || '').trim();
    const collectionId = String(req.query.collection_id || req.query.collectionId || '').trim();
    const productSearch = String(req.query.product_search || req.query.productSearch || '').trim();
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const useDemo = req.query.demo === '1' || req.query.demo === 'true';
    const accessToken = await resolveShopifyAccessToken(req);
    const payload = await listOpportunities({
      shopDomain: req.shopDomain,
      accessToken,
      filter,
      search,
      collectionId,
      productSearch,
      forceRefresh,
      useDemo,
    });
    return sendSuccess(res, HTTP_STATUS.OK, payload);
  })
);

router.post(
  '/opportunities/refresh',
  asyncHandler(async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const collectionId = String(body.collection_id || req.query.collection_id || '').trim();
    const productSearch = String(body.product_search || req.query.product_search || '').trim();
    if (!collectionId && !productSearch) {
      clearOpportunityCache(req.shopDomain);
    }
    const accessToken = await resolveShopifyAccessToken(req);
    const payload = await listOpportunities({
      shopDomain: req.shopDomain,
      accessToken,
      collectionId,
      productSearch,
      forceRefresh: true,
    });
    return sendSuccess(res, HTTP_STATUS.OK, payload);
  })
);

router.post(
  '/batches/create',
  asyncHandler(async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const accessToken = await resolveShopifyAccessToken(req);
    const batch = await createBatchFromSelection({
      shopDomain: req.shopDomain,
      accessToken,
      variantIds: body.variant_ids,
      scenarioPreset: body.scenario_preset,
      variantCountBySku: body.variant_count_by_sku,
      scenarioPresetBySku: body.scenario_preset_by_sku,
    });
    return sendSuccess(res, HTTP_STATUS.OK, batch);
  })
);

router.post(
  '/quick-start',
  asyncHandler(async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const accessToken = await resolveShopifyAccessToken(req);
    const batch = await quickStartBatch({
      shopDomain: req.shopDomain,
      accessToken,
      variantIds: body.variant_ids,
      scenarioPreset: body.scenario_preset,
    });
    return sendSuccess(res, HTTP_STATUS.OK, batch);
  })
);

router.post(
  '/plans/launch',
  asyncHandler(async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const plan = body.plan;
    if (!plan || typeof plan !== 'object') {
      return sendValidationError(res, ['plan is required']);
    }
    try {
      const result = await launchSmartPricingPlanAsTest(plan, req.shopDomain, {
        status: body.status || 'draft',
        autoStart: body.auto_start === true,
      });
      return sendSuccess(res, HTTP_STATUS.CREATED, {
        test: result.test,
        plan_id: plan.id || null,
        started: result.started,
        inbox_plan: result.inbox_plan || null,
      });
    } catch (err) {
      if (err.isValidation) {
        return sendValidationError(res, err.errors || [err.message]);
      }
      throw err;
    }
  })
);

router.post(
  '/plans/preview',
  asyncHandler(async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const guardrailsInput =
      body.guardrails && typeof body.guardrails === 'object' ? body.guardrails : {};
    const shopGuardrails = await getShopSmartPricingGuardrails(req.shopDomain).catch(() => ({}));
    const guardrails = { ...shopGuardrails, ...guardrailsInput };

    let unitCost = body.unit_cost ?? body.unitCost ?? null;
    let marginSource = body.margin_source ?? body.marginSource ?? null;
    const variantId = body.variant_id ?? body.variantId;
    if ((unitCost === null || unitCost === undefined) && variantId) {
      const cogsStore = await getSkuCogsOverrides(req.shopDomain).catch(() => ({ overrides: {} }));
      const resolved = resolveUnitCostWithOverrides(
        variantId,
        body.shopify_unit_cost ?? body.shopifyUnitCost,
        cogsStore.overrides || {}
      );
      if (resolved?.unit_cost !== null && resolved?.unit_cost !== undefined) {
        unitCost = resolved.unit_cost;
        marginSource = resolved.margin_source;
      }
    }

    const runningPriceTests = await countRunningPriceTests(req.shopDomain).catch(() => 0);
    const accessToken = await resolveShopifyAccessToken(req);
    const checkoutReadiness = await resolveSmartPricingCheckoutReadiness(req.shopDomain, {
      runningPriceTests,
      accessToken,
    });

    const plan = buildSmartPricingTestPlan({
      shopDomain: req.shopDomain,
      productId: body.product_id,
      variantId,
      title: body.title,
      currentPrice: body.current_price,
      currency: body.currency,
      scenarioPreset: body.scenario_preset,
      variantCount: body.variant_count,
      dailyVisitors: body.daily_visitors,
      baselineConversionRate: body.baseline_conversion_rate,
      baselinePpv: body.baseline_ppv,
      mdePercent: body.mde_percent,
      confidenceLevel: body.confidence_level,
      power: body.statistical_power,
      guardrails,
      planId: body.plan_id,
      imageUrl: body.image_url ?? body.imageUrl,
      unitCost,
      marginSource,
      checkoutPriceFunctionActive:
        body.checkout_price_function_active ??
        body.checkoutPriceFunctionActive ??
        checkoutReadiness.ready,
    });
    return sendSuccess(res, HTTP_STATUS.OK, { plan, checkout_readiness: checkoutReadiness });
  })
);

router.post(
  '/plans/apply-price-arms',
  asyncHandler(async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const plan = body.plan;
    if (!plan || typeof plan !== 'object') {
      return sendValidationError(res, ['plan is required']);
    }
    const armPrices = body.arm_prices && typeof body.arm_prices === 'object' ? body.arm_prices : {};
    const guardrails = await getShopSmartPricingGuardrails(req.shopDomain).catch(() => ({}));
    try {
      const updated = applyPriceArmOverrides(plan, armPrices, guardrails);
      return sendSuccess(res, HTTP_STATUS.OK, { plan: updated });
    } catch (err) {
      return sendValidationError(res, [err.message || 'Invalid price arms']);
    }
  })
);

router.get(
  '/plans/demo-batch',
  asyncHandler((req, res) => {
    const plans = buildDemoBatchPlans(req.shopDomain);
    return sendSuccess(res, HTTP_STATUS.OK, {
      plans,
      batch_id: `batch-${Date.now()}`,
      source: 'demo',
    });
  })
);

router.post(
  '/variant-options',
  asyncHandler((req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const options = buildVariantCountOptions({
      dailyVisitors: body.daily_visitors,
      baselineConversionRate: body.baseline_conversion_rate,
      mdePercent: body.mde_percent,
      confidenceLevel: body.confidence_level,
      power: body.statistical_power,
      targetDays: body.target_days,
    });
    return sendSuccess(res, HTTP_STATUS.OK, { options });
  })
);

router.post(
  '/scenario-preview',
  asyncHandler((req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const currentPrice = Number(body.current_price);
    const presetId = body.scenario_preset || 'recommended';
    const preview = applyScenarioPreset(currentPrice, presetId, body.guardrails || {});
    return sendSuccess(res, HTTP_STATUS.OK, { preview });
  })
);

router.get(
  '/checkout-readiness',
  asyncHandler(async (req, res) => {
    const runningPriceTests = await countRunningPriceTests(req.shopDomain).catch(() => 0);
    const accessToken = await resolveShopifyAccessToken(req);
    const readiness = await resolveSmartPricingCheckoutReadiness(req.shopDomain, {
      runningPriceTests,
      accessToken,
    });
    return sendSuccess(res, HTTP_STATUS.OK, { readiness });
  })
);

router.get(
  '/inbox/summary',
  asyncHandler(async (req, res) => {
    const payload = await listInboxPlans(req.shopDomain);
    return sendSuccess(res, HTTP_STATUS.OK, {
      revision: payload.revision,
      updated_at: payload.updated_at,
      counts: payload.counts || summarizeInboxPlans(payload.plans),
      source: 'server',
    });
  })
);

router.get(
  '/inbox/plans',
  asyncHandler(async (req, res) => {
    const archivedRaw = req.query.archived;
    let archived;
    if (archivedRaw === 'true' || archivedRaw === '1') {
      archived = true;
    } else if (archivedRaw === 'false' || archivedRaw === '0') {
      archived = false;
    }
    const payload = await listInboxPlans(req.shopDomain, {
      q: req.query.q || req.query.search || '',
      status: req.query.status || '',
      archived,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    return sendSuccess(res, HTTP_STATUS.OK, {
      ...payload,
      source: 'server',
    });
  })
);

router.get(
  '/inbox/plans/:planId',
  asyncHandler(async (req, res) => {
    const planId = String(req.params.planId || '').trim();
    if (!planId) {
      return sendValidationError(res, ['planId is required']);
    }
    const plan = await getInboxPlanById(req.shopDomain, planId);
    if (!plan) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Smart Pricing plan not found in inbox.');
    }
    return sendSuccess(res, HTTP_STATUS.OK, {
      plan,
      source: 'server',
    });
  })
);

router.patch(
  '/inbox/plans/:planId',
  asyncHandler(async (req, res) => {
    const planId = String(req.params.planId || '').trim();
    if (!planId) {
      return sendValidationError(res, ['planId is required']);
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    try {
      const result = await patchInboxPlan(req.shopDomain, planId, body);
      return sendSuccess(res, HTTP_STATUS.OK, {
        ...result,
        source: 'server',
      });
    } catch (err) {
      if (err.code === 'PLAN_NOT_FOUND') {
        return sendValidationError(res, [err.message]);
      }
      throw err;
    }
  })
);

/**
 * Create/reuse a draft price test for a queued inbox plan so Classic Preview can
 * open /apps/ripx/price-preview-bootstrap with a real test_id + byProduct matrix.
 */
router.post(
  '/inbox/plans/:planId/ensure-preview-test',
  asyncHandler(async (req, res) => {
    const planId = String(req.params.planId || '').trim();
    if (!planId) {
      return sendValidationError(res, ['planId is required']);
    }
    try {
      const preview = await ensureSmartPricingPlanPreviewTest(req.shopDomain, planId);
      return sendSuccess(res, HTTP_STATUS.OK, {
        ...preview,
        source: 'server',
      });
    } catch (err) {
      if (err.isValidation || err.code === 'PLAN_NOT_FOUND') {
        return sendValidationError(res, err.errors || [err.message]);
      }
      throw err;
    }
  })
);

router.put(
  '/inbox/plans',
  asyncHandler(async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const plans = Array.isArray(body.plans) ? body.plans : [];
    const deletedPlanIds = Array.isArray(body.deleted_plan_ids)
      ? body.deleted_plan_ids
      : Array.isArray(body.deletedPlanIds)
        ? body.deletedPlanIds
        : [];
    if (!plans.length && !deletedPlanIds.length) {
      return sendValidationError(res, ['plans or deleted_plan_ids is required']);
    }
    const expectedRevision =
      body.expected_revision ?? body.expectedRevision ?? body.revision ?? null;
    try {
      const payload = await saveInboxPlans(req.shopDomain, plans, {
        deletedPlanIds,
        expectedRevision,
      });
      return sendSuccess(res, HTTP_STATUS.OK, {
        ...payload,
        source: 'server',
      });
    } catch (err) {
      if (err.code === 'INBOX_REVISION_CONFLICT') {
        return sendError(res, HTTP_STATUS.CONFLICT, err.message, {
          revision: err.current?.revision || null,
          counts: err.current?.counts || null,
          plans: err.current?.plans || [],
        });
      }
      throw err;
    }
  })
);

router.delete(
  '/inbox/plans/:planId',
  asyncHandler(async (req, res) => {
    const planId = String(req.params.planId || '').trim();
    if (!planId) {
      return sendValidationError(res, ['planId is required']);
    }
    const result = await deleteInboxPlan(req.shopDomain, planId);
    return sendSuccess(res, HTTP_STATUS.OK, result);
  })
);

router.post(
  '/inbox/sync',
  asyncHandler(async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const plans = Array.isArray(body.plans) ? body.plans : [];
    const payload = await syncInboxPlans(req.shopDomain, plans);
    const persist =
      body.persist !== false && body.persist_to_server !== false && body.persistToServer !== false;
    let stored = null;
    if (persist && payload?.plans?.length) {
      stored = await patchInboxPlansFromSync(req.shopDomain, payload.plans);
    }
    return sendSuccess(res, HTTP_STATUS.OK, {
      ...payload,
      stored_plans: stored?.plans || null,
      stored_updated_at: stored?.updated_at || null,
    });
  })
);

router.get(
  '/cogs',
  asyncHandler(async (req, res) => {
    const data = await getSkuCogsOverrides(req.shopDomain);
    return sendSuccess(res, HTTP_STATUS.OK, data);
  })
);

router.post(
  '/cogs/import',
  asyncHandler(async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const csvText = String(body.csv || body.csv_text || body.text || '').trim();
    if (!csvText) {
      return sendValidationError(res, ['csv text is required']);
    }
    try {
      const result = await importSkuCogsFromCsv(req.shopDomain, csvText);
      clearOpportunityCache(req.shopDomain);
      return sendSuccess(res, HTTP_STATUS.OK, result, 'COGS overrides imported');
    } catch (err) {
      return sendValidationError(res, [err.message]);
    }
  })
);

router.post(
  '/plans/suggest-hypothesis',
  asyncHandler(async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const result = await suggestHypothesis({
      name: body.name,
      experimentType: body.experiment_type || body.experimentType || 'price_test',
      hypothesisHint: body.hint || body.hypothesis_hint || '',
      objective: body.objective || 'profit_per_visitor',
      variants: Array.isArray(body.variants) ? body.variants : [],
    });
    return sendSuccess(res, HTTP_STATUS.OK, {
      ...result,
      ai_available: hasOpenAiKey(),
    });
  })
);

router.post(
  '/plans/suggest-prices',
  asyncHandler(async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const variants = Array.isArray(body.variants) ? body.variants : [];
    const arms = Array.isArray(body.arms) ? body.arms : [];
    if (!variants.length) {
      return sendValidationError(res, ['variants is required']);
    }
    if (!arms.length) {
      return sendValidationError(res, ['arms is required']);
    }
    const guardrails = await getShopSmartPricingGuardrails(req.shopDomain).catch(() => ({}));
    const result = await suggestPrices({
      variants,
      arms,
      guardrails: { ...guardrails, ...(body.guardrails || {}) },
      minPct: body.min_pct ?? body.minPct ?? 10,
      maxPct: body.max_pct ?? body.maxPct ?? 20,
      objective: body.objective || guardrails.objective || 'profit_per_visitor',
    });
    return sendSuccess(res, HTTP_STATUS.OK, {
      ...result,
      ai_available: hasOpenAiKey(),
    });
  })
);

router.post(
  '/plans/suggest-audience',
  asyncHandler(async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const plans = Array.isArray(body.plans) ? body.plans : [];
    const guardrails = await getShopSmartPricingGuardrails(req.shopDomain).catch(() => ({}));
    const useAi = body.use_ai === true || body.useAi === true || body.mode === 'ai';

    if (useAi) {
      const advanced = await suggestAudienceAdvanced({
        plans,
        guardrails,
        catalogHints: body.catalog_hints || body.catalogHints || {},
      });
      const legacy = suggestAudienceForPlans(plans, guardrails);
      return sendSuccess(res, HTTP_STATUS.OK, {
        audience: {
          ...advanced.audience,
          segments: advanced.audience.segments || legacy.segments,
          inherit_from_shop_defaults: true,
        },
        source: advanced.source,
        ai_available: hasOpenAiKey(),
        guardrails_defaults: true,
      });
    }

    const audience = suggestAudienceForPlans(plans, guardrails);
    return sendSuccess(res, HTTP_STATUS.OK, {
      audience,
      source: 'deterministic',
      ai_available: hasOpenAiKey(),
      guardrails_defaults: true,
    });
  })
);

router.post(
  '/plans/suggest-goals',
  asyncHandler(async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const plans = Array.isArray(body.plans) ? body.plans : [];
    const guardrails = await getShopSmartPricingGuardrails(req.shopDomain).catch(() => ({}));
    const suggestions = suggestGoalsForPlans(plans, guardrails);
    return sendSuccess(res, HTTP_STATUS.OK, { suggestions });
  })
);

router.post(
  '/plans/batch-preview-launch',
  asyncHandler(async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const plans = Array.isArray(body.plans) ? body.plans : [];
    if (!plans.length) {
      return sendValidationError(res, ['plans is required']);
    }
    const guardrails = await getShopSmartPricingGuardrails(req.shopDomain).catch(() => ({}));
    const accessToken = await resolveShopifyAccessToken(req);
    const preview = await buildBatchPreviewLaunch({
      shopDomain: req.shopDomain,
      plans,
      accessToken,
      guardrails,
    });
    return sendSuccess(res, HTTP_STATUS.OK, preview);
  })
);

router.get(
  '/tests/:testId/analytics',
  asyncHandler(async (req, res) => {
    try {
      const analytics = await buildSmartPricingTestAnalytics(req.shopDomain, req.params.testId);
      res.set('Cache-Control', 'no-store');
      return sendSuccess(res, HTTP_STATUS.OK, analytics);
    } catch (err) {
      return sendValidationError(res, [err.message]);
    }
  })
);

router.get(
  '/tests/:testId/winner-preview',
  asyncHandler(async (req, res) => {
    const accessToken = await resolveShopifyAccessToken(req);
    if (!accessToken) {
      return sendValidationError(res, ['Missing Shopify access token']);
    }
    try {
      const preview = await previewSmartPricingWinnerRollout({
        testId: req.params.testId,
        shopDomain: req.shopDomain,
        accessToken,
        variantIndex: req.query.variant_index ?? req.query.variantIndex,
      });
      return sendSuccess(res, HTTP_STATUS.OK, preview);
    } catch (err) {
      return sendValidationError(res, [err.message]);
    }
  })
);

router.post(
  '/tests/:testId/apply-winner',
  asyncHandler(async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const accessToken = await resolveShopifyAccessToken(req);
    if (!accessToken) {
      return sendValidationError(res, ['Missing Shopify access token']);
    }
    const dryRun = body.dry_run === true || body.dryRun === true;
    const publishToShopify = body.publish_to_shopify !== false && body.publishToShopify !== false;
    try {
      const result = await applySmartPricingWinnerRollout({
        testId: req.params.testId,
        shopDomain: req.shopDomain,
        accessToken,
        variantIndex: body.variant_index ?? body.variantIndex,
        publishToShopify,
        dryRun,
      });
      if (!dryRun) {
        scheduleSmartPricingInboxSync(req.shopDomain, req.params.testId, {
          reason: 'apply_winner',
        });
      }
      let autoRound2 = null;
      if (!dryRun && result?.test?.metadata?.smart_pricing_plan_id) {
        autoRound2 = await maybeAutoQueueRound2Plan(
          req.shopDomain,
          result.test.metadata.smart_pricing_plan_id
        ).catch(() => null);
      }
      const updatedCount = result.publish?.summary?.updated_count ?? 0;
      const message = dryRun
        ? 'Winner rollout preview ready'
        : publishToShopify
          ? updatedCount > 0
            ? `Winner applied and ${updatedCount} Shopify price${updatedCount === 1 ? '' : 's'} updated`
            : 'Winner applied. Shopify prices were already in sync.'
          : 'Winner applied to 100% of traffic';
      return sendSuccess(res, HTTP_STATUS.OK, { ...result, auto_round2: autoRound2 }, message);
    } catch (err) {
      return sendValidationError(res, [err.message]);
    }
  })
);

module.exports = router;
