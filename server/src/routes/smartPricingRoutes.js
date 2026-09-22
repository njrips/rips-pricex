const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');
const { sendSuccess, sendValidationError, sendError } = require('../utils/response');
const { HTTP_STATUS, ERROR_MESSAGES } = require('../constants');
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
  DEFAULT_GUARDRAILS,
  getShopSmartPricingGuardrails,
  saveShopSmartPricingGuardrails,
  mergePreviewGuardrails,
} = require('../services/smartPricing/smartPricingGuardrailsService');
const {
  countRunningPriceTests,
  resolveLaunchCapacity,
} = require('../services/smartPricing/smartPricingLaunchGuardService');
const {
  applySmartPricingWinnerRollout,
  previewSmartPricingWinnerRollout,
  finishSmartPricingProductWithoutPriceChange,
} = require('../services/smartPricing/smartPricingWinnerRolloutService');
const {
  planApplyBatch,
  batchBudgetExhausted,
} = require('../services/smartPricing/applyReadyBatchPolicy');
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
  getShopWizardDrafts,
  saveShopWizardDraft,
  deleteShopWizardDraft,
} = require('../services/smartPricing/smartPricingWizardDraftStore');
const {
  buildSmartPricingTestPlan,
  buildDemoBatchPlans,
  applyPriceArmOverrides,
} = require('../services/smartPricing/testPlanService');
const {
  syncSmartPricingInboxForTest,
} = require('../services/smartPricing/smartPricingInboxStopSyncService');
const {
  resolveSmartPricingCheckoutReadiness,
} = require('../services/smartPricing/smartPricingCheckoutReadinessService');
const {
  maybeAutoQueueRound2Plan,
} = require('../services/smartPricing/smartPricingAutoRound2Service');
const {
  previewResumeConflicts,
} = require('../services/smartPricing/priceTestEnrollmentService');
const {
  stopSmartPricingProduct,
  resumeSmartPricingProduct,
  releaseSmartPricingProduct,
  revertSmartPricingProductPrice,
  rerunSmartPricingProduct,
  buildSmartPricingProductReport,
} = require('../services/smartPricing/smartPricingProductLifecycleService');
const {
  listProductEvents,
} = require('../models/smartPricingProductEventStore');
const {
  buildSmartPricingTestAnalytics,
} = require('../services/smartPricing/smartPricingTestAnalyticsService');
const {
  suggestGoalsForPlans,
  buildBatchPreviewLaunch,
} = require('../services/smartPricing/smartPricingAudienceGoalService');
const {
  suggestPrices,
} = require('../services/smartPricing/smartPricingAiSuggestService');
const { hasOpenAiKey } = require('../services/smartPricing/smartPricingAiProvider');

const router = express.Router();


router.use((req, res, next) => {
  if (req.method === 'GET' && req.path === '/status') {
    return next();
  }
  if (!isSmartPricingEnabled()) {
    return sendValidationError(res, ['Priceify is disabled for this environment']);
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
    const {
      devEntitleAllEnabled,
      getShopEntitlement,
    } = require('../services/billing/entitlementService');
    // Only the fallback for when the lookup below throws; production ignores
    // the flag, so a failed lookup there reports unentitled rather than free.
    let entitled = devEntitleAllEnabled();
    let upgradeUrl = null;
    try {
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
    const guardrails = mergePreviewGuardrails(shopGuardrails, guardrailsInput);

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
  asyncHandler(async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const currentPrice = Number(body.current_price);
    const presetId = body.scenario_preset || 'recommended';
    const shopGuardrails = await getShopSmartPricingGuardrails(req.shopDomain).catch(() => ({}));
    const preview = applyScenarioPreset(
      currentPrice,
      presetId,
      mergePreviewGuardrails(shopGuardrails, body.guardrails)
    );
    return sendSuccess(res, HTTP_STATUS.OK, { preview });
  })
);

router.get(
  '/checkout-readiness',
  asyncHandler(async (req, res) => {
    const runningPriceTests = await countRunningPriceTests(req.shopDomain).catch(() => 0);
    const accessToken = await resolveShopifyAccessToken(req);
    // Setup's "Check again" is a promise to go and look, so it has to be able
    // to bypass the readiness cache. Without this, a merchant who just changed
    // the theme app embed sees the previous answer for the whole cache window.
    const forceRefresh = ['1', 'true', 'yes'].includes(
      String(req.query?.refresh || '').trim().toLowerCase()
    );
    const readiness = await resolveSmartPricingCheckoutReadiness(req.shopDomain, {
      runningPriceTests,
      accessToken,
      forceRefresh,
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
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Test plan not found in inbox.');
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
 * open /apps/ripspricex/price-preview-bootstrap with a real test_id + byProduct matrix.
 */
router.post(
  '/inbox/plans/:planId/ensure-preview-test',
  asyncHandler(async (req, res) => {
    const planId = String(req.params.planId || '').trim();
    if (!planId) {
      return sendValidationError(res, ['planId is required']);
    }
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const preview = await ensureSmartPricingPlanPreviewTest(req.shopDomain, planId, {
        plan: body.plan && typeof body.plan === 'object' ? body.plan : null,
        plans: Array.isArray(body.plans) ? body.plans : [],
      });
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

/**
 * Unfinished create-wizard experiments.
 *
 * Separate from `/inbox/plans` because a draft this early has no per-SKU plans
 * to put there: the merchant may have named the experiment and nothing else.
 */
router.get(
  '/wizard-drafts',
  asyncHandler(async (req, res) => {
    const drafts = await getShopWizardDrafts(req.shopDomain);
    return sendSuccess(res, HTTP_STATUS.OK, { drafts });
  })
);

/**
 * The body behind a draft the store looked at and turned down.
 *
 * Shaped like `sendValidationError`, plus the reason as a code. The sentence is
 * for the merchant; the code is what the wizard branches on, because it answers
 * an oversized draft by sending it again without its pricing table, and reading
 * that intent out of the sentence would let a copy edit here break the retry
 * there.
 */
function wizardDraftRefusalBody(reason) {
  const messages = {
    draft_too_large: 'Draft is too large to save on the server',
    experiment_id_required: 'draft.experiment_id is required',
    shop_required: 'shop is required',
  };
  return {
    success: false,
    error: ERROR_MESSAGES.VALIDATION_FAILED,
    details: [messages[reason] || 'Could not save draft'],
    reason: reason || 'unknown',
  };
}

router.put(
  '/wizard-drafts',
  asyncHandler(async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const draft = body.draft && typeof body.draft === 'object' ? body.draft : null;
    if (!draft) {
      return sendValidationError(res, ['draft is required']);
    }
    const result = await saveShopWizardDraft(req.shopDomain, draft);
    if (!result.saved) {
      // Refused, not stored. Reported as a failure so the wizard can say the
      // browser still has the work rather than claiming a save it did not get.
      return res.status(HTTP_STATUS.BAD_REQUEST).json(wizardDraftRefusalBody(result.reason));
    }
    return sendSuccess(res, HTTP_STATUS.OK, {
      draft: result.saved,
      drafts: result.drafts,
      // A newer copy was kept instead of this one. The save did not land, so
      // the wizard needs to know rather than being told it did.
      superseded: Boolean(result.superseded),
      // Any draft the five-draft cap pushed out to make room for this one, so
      // the merchant hears about work being discarded instead of finding it
      // gone later.
      evicted: Array.isArray(result.evicted) ? result.evicted : [],
    });
  })
);

router.delete(
  '/wizard-drafts/:experimentId',
  asyncHandler(async (req, res) => {
    const experimentId = String(req.params.experimentId || '').trim();
    if (!experimentId) {
      return sendValidationError(res, ['experimentId is required']);
    }
    const drafts = await deleteShopWizardDraft(req.shopDomain, experimentId);
    return sendSuccess(res, HTTP_STATUS.OK, { drafts });
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

/**
 * A price suggestion has to fit in a wizard the merchant can read.
 *
 * The ceilings are generous against any real catalog selection and exist so a
 * malformed or hostile body cannot turn one click into unbounded work.
 */
const MAX_SUGGEST_VARIANTS = 500;
const MAX_SUGGEST_ARMS = 10;

function suggestPriceRequestLimits(variants, arms) {
  const errors = [];
  if (variants.length > MAX_SUGGEST_VARIANTS) {
    errors.push(
      `variants cannot exceed ${MAX_SUGGEST_VARIANTS} products in one request (received ${variants.length})`
    );
  }
  if (arms.length > MAX_SUGGEST_ARMS) {
    errors.push(
      `arms cannot exceed ${MAX_SUGGEST_ARMS} variations in one request (received ${arms.length})`
    );
  }
  return errors;
}

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
    // Bounded because nothing downstream was. Every product is priced and
    // every arm spread even when only the first 60 products reach the model,
    // so a caller asking for tens of thousands of rows spent the whole request
    // on work no wizard could ever show.
    const limits = suggestPriceRequestLimits(variants, arms);
    if (limits.length) {
      return sendValidationError(res, limits);
    }
    const guardrails = await getShopSmartPricingGuardrails(req.shopDomain).catch(() => ({
      ...DEFAULT_GUARDRAILS,
    }));
    const result = await suggestPrices({
      variants,
      arms,
      // Shop guardrails are price safety limits, so they must win over anything
      // the client sends; body values only fill keys the shop does not define.
      guardrails: { ...(body.guardrails || {}), ...guardrails },
      minPct: body.min_pct ?? body.minPct ?? 10,
      maxPct: body.max_pct ?? body.maxPct ?? 20,
      unit: body.unit === 'amount' ? 'amount' : 'percent',
      minAmount: body.min_amount ?? body.minAmount ?? null,
      maxAmount: body.max_amount ?? body.maxAmount ?? null,
      objective: body.objective || guardrails.objective || 'revenue_per_visitor',
      // The client has always sent use_ai; honouring it gives an operator a way
      // to ask for the deterministic spread without unsetting the API key.
      useAi: body.use_ai !== false && body.useAi !== false,
      regenerate: body.regenerate === true || body.regenerate === 1,
      attempt: Number(body.attempt) || 0,
    });
    return sendSuccess(res, HTTP_STATUS.OK, {
      ...result,
      ai_available: hasOpenAiKey(),
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

/** Inbox sync and round-2 queueing that has to follow any successful apply. */
async function finishAppliedProduct(shopDomain, testId, result) {
  await syncSmartPricingInboxForTest(shopDomain, testId, { reason: 'apply_winner' }).catch(
    () => null
  );
  let planId = result?.test?.metadata?.smart_pricing_plan_id || null;
  if (!planId) {
    const { findInboxPlanByTestId } = require('../models/smartPricingInboxStore');
    const inboxPlan = await findInboxPlanByTestId(shopDomain, testId).catch(() => null);
    planId = inboxPlan?.id || null;
  }
  if (!planId) return null;
  return maybeAutoQueueRound2Plan(shopDomain, planId).catch(() => null);
}

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
    // A multi-product experiment is a group of independent tests, so applying
    // one product stops that product only and leaves its siblings running.
    const stopIfRunning = body.stop_if_running === true || body.stopIfRunning === true;
    try {
      const result = await applySmartPricingWinnerRollout({
        testId: req.params.testId,
        shopDomain: req.shopDomain,
        accessToken,
        variantIndex: body.variant_index ?? body.variantIndex,
        publishToShopify,
        dryRun,
        stopIfRunning,
      });
      let autoRound2 = null;
      if (!dryRun) {
        autoRound2 = await finishAppliedProduct(req.shopDomain, req.params.testId, result);
      }
      const updatedCount = result.publish?.summary?.updated_count ?? 0;
      const errorCount = result.publish?.summary?.error_count ?? 0;
      const publishMessage = () => {
        if (updatedCount > 0) {
          const updatedText = `Winner applied and ${updatedCount} Shopify price${updatedCount === 1 ? '' : 's'} updated`;
          return errorCount > 0
            ? `${updatedText}, but ${errorCount} could not be updated. Check the errors below and retry those variants.`
            : updatedText;
        }
        // Reporting "already in sync" when every write failed sends the
        // merchant away believing their catalog changed.
        return errorCount > 0
          ? `Winner applied to traffic, but no Shopify price could be updated (${errorCount} failed). Your catalog still shows the old prices.`
          : 'Winner applied. Shopify prices were already in sync.';
      };
      const message = dryRun
        ? 'Winner rollout preview ready'
        : publishToShopify
          ? publishMessage()
          : 'Winner applied to 100% of traffic';
      return sendSuccess(res, HTTP_STATUS.OK, { ...result, auto_round2: autoRound2 }, message);
    } catch (err) {
      return sendValidationError(res, [err.message]);
    }
  })
);

router.post(
  '/tests/:testId/finish-product',
  asyncHandler(async (req, res) => {
    try {
      const result = await finishSmartPricingProductWithoutPriceChange({
        testId: req.params.testId,
        shopDomain: req.shopDomain,
      });
      await syncSmartPricingInboxForTest(req.shopDomain, req.params.testId, {
        reason: result.control_retained ? 'merchant_control' : 'merchant_offer_complete',
      }).catch(() => null);
      return sendSuccess(
        res,
        HTTP_STATUS.OK,
        result,
        result.control_retained
          ? 'Product finished on its current price. No catalog change was made.'
          : 'Product finished on its winning offer. No catalog change was made.'
      );
    } catch (err) {
      return sendValidationError(res, [err.message]);
    }
  })
);

/**
 * Applies several finished products in one action.
 *
 * Each product is gated and written on its own, and one failure does not stop
 * the rest — a merchant clearing a queue of ten wants the eight that worked,
 * plus a straight answer about the two that did not.
 */
router.post(
  '/products/apply-ready',
  asyncHandler(async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    // Overflow is reported rather than dropped silently, so the merchant knows
    // there is a second click to make.
    const { requested, testIds } = planApplyBatch(body.test_ids);
    if (requested.length === 0) {
      return sendValidationError(res, ['test_ids must contain at least one test id']);
    }
    const accessToken = await resolveShopifyAccessToken(req);
    if (!accessToken) {
      return sendValidationError(res, ['Missing Shopify access token']);
    }

    const results = [];
    const startedAt = Date.now();
    for (const testId of testIds) {
      if (batchBudgetExhausted(results.length, Date.now() - startedAt)) {
        break;
      }
      try {
        // Each product's own verdict decides what "apply" means for it: a price
        // test writes a catalog price, a control win or an offer just finishes.
        const analytics = await buildSmartPricingTestAnalytics(req.shopDomain, testId);
        const decision = analytics?.product_decision || null;
        if (decision?.can_apply) {
          const result = await applySmartPricingWinnerRollout({
            testId,
            shopDomain: req.shopDomain,
            accessToken,
            publishToShopify: true,
            stopIfRunning: true,
          });
          await finishAppliedProduct(req.shopDomain, testId, result);
          // A batch row that says only "applied" hides a product whose catalog
          // was written for some variants and refused for others — the same
          // partial state the single-product apply already reports.
          const errorCount = Number(result.publish?.summary?.error_count) || 0;
          results.push({
            test_id: testId,
            applied: true,
            action: 'apply_price',
            updated_count: result.publish?.summary?.updated_count ?? 0,
            error_count: errorCount,
            ...(errorCount > 0
              ? {
                  error: `${errorCount} Shopify price${errorCount === 1 ? '' : 's'} could not be updated and still show the old price.`,
                }
              : {}),
            winner_variant_id: result.publish?.winner_variant_id || null,
          });
        } else if (decision?.can_finish) {
          const result = await finishSmartPricingProductWithoutPriceChange({
            testId,
            shopDomain: req.shopDomain,
          });
          await syncSmartPricingInboxForTest(req.shopDomain, testId, {
            reason: result.control_retained ? 'merchant_control' : 'merchant_offer_complete',
          }).catch(() => null);
          results.push({
            test_id: testId,
            applied: true,
            action: result.control_retained ? 'retain_control' : 'finish_offer',
            updated_count: 0,
          });
        } else {
          results.push({
            test_id: testId,
            applied: false,
            error: decision?.detail || 'This product is not ready to apply yet',
          });
        }
      } catch (err) {
        results.push({ test_id: testId, applied: false, error: err.message });
      }
    }

    const applied = results.filter(row => row.applied).length;
    const failed = results.length - applied;
    const deferred = requested.length - results.length;
    const parts = [
      failed
        ? `Applied ${applied} of ${results.length} products. ${failed} could not be applied.`
        : `Applied ${applied} product${applied === 1 ? '' : 's'}.`,
    ];
    if (deferred > 0) {
      parts.push(`${deferred} more were left for the next batch — apply again to continue.`);
    }
    return sendSuccess(
      res,
      HTTP_STATUS.OK,
      { results, applied, failed, deferred },
      parts.join(' ')
    );
  })
);

/**
 * A shared test is a conflict rather than bad input: the request is well formed,
 * the test just spans several products.
 */
function sendProductActionError(res, err) {
  if (err.code === 'SHARED_TEST') {
    return sendError(res, HTTP_STATUS.CONFLICT, err.message, {
      code: 'SHARED_TEST',
      plan_count: err.planCount || null,
    });
  }
  // Also a conflict, not bad input: the request is well formed, another test
  // is simply pricing this product already.
  if (err.code === 'PRODUCT_IN_ANOTHER_TEST') {
    return sendError(res, HTTP_STATUS.CONFLICT, err.message, {
      code: 'PRODUCT_IN_ANOTHER_TEST',
      conflict: err.conflict || null,
    });
  }
  return sendValidationError(res, [err.message]);
}

/**
 * Asked before Resume, so the merchant is told which products another test has
 * taken while this one was paused -- and can start the rest -- rather than
 * meeting one 409 per product after pressing the button.
 */
router.post(
  '/tests/resume-preflight',
  asyncHandler(async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const testIds = Array.isArray(body.test_ids) ? body.test_ids : [];
    const result = await previewResumeConflicts({
      shopDomain: req.shopDomain,
      testIds,
    });
    return sendSuccess(res, HTTP_STATUS.OK, result);
  })
);

router.post(
  '/tests/:testId/stop-product',
  asyncHandler(async (req, res) => {
    try {
      const result = await stopSmartPricingProduct({
        testId: req.params.testId,
        shopDomain: req.shopDomain,
      });
      return sendSuccess(res, HTTP_STATUS.OK, result, 'Product stopped. Sibling products keep running.');
    } catch (err) {
      return sendProductActionError(res, err);
    }
  })
);

router.post(
  '/tests/:testId/resume-product',
  asyncHandler(async (req, res) => {
    try {
      const result = await resumeSmartPricingProduct({
        testId: req.params.testId,
        shopDomain: req.shopDomain,
      });
      return sendSuccess(res, HTTP_STATUS.OK, result, 'Product resumed.');
    } catch (err) {
      return sendProductActionError(res, err);
    }
  })
);

router.post(
  '/tests/:testId/release-product',
  asyncHandler(async (req, res) => {
    try {
      const result = await releaseSmartPricingProduct({
        testId: req.params.testId,
        shopDomain: req.shopDomain,
      });
      return sendSuccess(
        res,
        HTTP_STATUS.OK,
        result,
        result.released
          ? 'Product released. It can be used in a new price test.'
          : 'This product was already free to use in a new price test.'
      );
    } catch (err) {
      return sendProductActionError(res, err);
    }
  })
);

router.post(
  '/tests/:testId/revert-price',
  asyncHandler(async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const accessToken = await resolveShopifyAccessToken(req);
    if (!accessToken) {
      return sendValidationError(res, ['Missing Shopify access token']);
    }
    try {
      const result = await revertSmartPricingProductPrice({
        testId: req.params.testId,
        shopDomain: req.shopDomain,
        accessToken,
        force: body.force === true,
        dryRun: body.dry_run === true || body.dryRun === true,
      });
      // A revert that only half-lands leaves the rest of the catalog at the
      // winning price. Saying "restored 3 prices" and stopping there sends the
      // merchant away believing the test was undone.
      const revertErrors = Array.isArray(result.errors) ? result.errors.length : 0;
      const restored = `Restored ${result.updated_count} Shopify price${result.updated_count === 1 ? '' : 's'}`;
      const truncatedNote = result.baseline_truncated
        ? ' The apply was larger than the snapshot could hold, so variants beyond it keep the applied price and need fixing in Shopify.'
        : '';
      const message = result.already_reverted
        ? 'Prices already match the pre-apply baseline.'
        : result.dry_run
          ? 'Revert preview ready'
          : revertErrors > 0
            ? `${restored}, but ${revertErrors} could not be restored and still show the applied price. Check the errors below and retry those variants.${truncatedNote}`
            : `${restored}.${truncatedNote}`;
      return sendSuccess(res, HTTP_STATUS.OK, result, message);
    } catch (err) {
      if (err.code === 'PRICE_DRIFT') {
        return sendError(res, HTTP_STATUS.CONFLICT, err.message, {
          code: 'PRICE_DRIFT',
          drifted: err.drifted || [],
        });
      }
      if (err.code === 'REVERT_UNVERIFIABLE') {
        return sendError(res, HTTP_STATUS.CONFLICT, err.message, {
          code: 'REVERT_UNVERIFIABLE',
          unverified: err.unverified || [],
        });
      }
      return sendValidationError(res, [err.message]);
    }
  })
);

router.post(
  '/tests/:testId/rerun',
  asyncHandler(async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const accessToken = await resolveShopifyAccessToken(req);
    try {
      const result = await rerunSmartPricingProduct({
        testId: req.params.testId,
        shopDomain: req.shopDomain,
        accessToken,
        armPrices: body.arm_prices || body.armPrices || null,
        useAiSuggestion: body.use_ai_suggestion === true || body.useAiSuggestion === true,
        note: body.note || null,
      });
      if (!result.queued && result.reason === 'round_exists') {
        return sendSuccess(
          res,
          HTTP_STATUS.OK,
          result,
          'A follow-up round is already queued for this product.'
        );
      }
      return sendSuccess(
        res,
        HTTP_STATUS.OK,
        result,
        result.queued
          ? `Round ${result.learning_round} queued. Review and launch when ready.`
          : result.reason || 'Follow-up not queued'
      );
    } catch (err) {
      return sendProductActionError(res, err);
    }
  })
);

router.get(
  '/products/:planId/report',
  asyncHandler(async (req, res) => {
    try {
      const report = await buildSmartPricingProductReport(req.shopDomain, req.params.planId);
      return sendSuccess(res, HTTP_STATUS.OK, report);
    } catch (err) {
      return sendValidationError(res, [err.message]);
    }
  })
);

router.get(
  '/products/:planId/events',
  asyncHandler(async (req, res) => {
    const events = await listProductEvents(req.shopDomain, {
      planId: req.params.planId,
      limit: Number(req.query.limit) || 100,
    });
    return sendSuccess(res, HTTP_STATUS.OK, { events });
  })
);

/**
 * Whether a Smart Pricing request may proceed without a paid plan.
 *
 * Reads are open to every installed shop, which is what gives the upgrade
 * prompt something to argue about. Two kinds of write are open too, and for
 * the same underlying reason: they are how a merchant *leaves*.
 *
 *   - Deleting your own draft or plan is not a paid action, and it is the only
 *     way to clear the row. Charging for it leaves a lapsed shop looking at
 *     drafts it can neither finish nor remove.
 *   - Stopping, finishing or releasing a product's test takes it off the
 *     traffic. These spend nothing and write nothing to Shopify. Gated, they
 *     meant a shop whose plan had lapsed could not turn off tests that were
 *     still pricing their shoppers without subscribing again -- the app
 *     holding a live storefront hostage.
 *
 * Deliberately not free: launching, applying a winner, and anything else that
 * starts new work or writes a price into the merchant's catalog.
 *
 * Lives here rather than inline in the mount so the rule can be read and
 * tested next to the routes it describes.
 */
function isFreeSmartPricingRequest(method, path) {
  const verb = String(method || '').toUpperCase();
  if (verb === 'GET') return true;
  const route = String(path || '');
  if (verb === 'DELETE') {
    return route.startsWith('/wizard-drafts/') || route.startsWith('/inbox/plans/');
  }
  if (verb === 'POST') {
    // Wizard pricing is read-only on the catalog until launch; blocking it behind
    // a plan left the Products table empty even though the deterministic spread
    // is cheap and RipX never gated it.
    if (route === '/plans/suggest-prices') return true;
    return /^\/tests\/[^/]+\/(stop-product|finish-product|release-product)$/.test(route);
  }
  return false;
}

module.exports = router;
module.exports.isFreeSmartPricingRequest = isFreeSmartPricingRequest;
module.exports.suggestPriceRequestLimits = suggestPriceRequestLimits;
module.exports.wizardDraftRefusalBody = wizardDraftRefusalBody;
