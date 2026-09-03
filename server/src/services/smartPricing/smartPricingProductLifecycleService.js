/**
 * Per-product Smart Pricing lifecycle: stop, resume, revert, re-run, and reports.
 * One inbox plan / one test = one SKU.
 */

const { getTestById } = require('../../models/test');
const {
  findInboxPlanByTestId,
  getInboxPlanById,
  listInboxPlans,
  saveInboxPlans,
  patchInboxPlan,
  countInboxPlansForTest,
} = require('../../models/smartPricingInboxStore');
const {
  recordEventForTest,
  recordProductEvent,
  listProductEvents,
  findLatestApplyEvent,
} = require('../../models/smartPricingProductEventStore');
const { syncSmartPricingInboxForTest } = require('./smartPricingInboxStopSyncService');
const { isSmartPricingTest, isPriceLikeTestType } = require('./smartPricingTestIdentity');
const { buildSmartPricingTestAnalytics } = require('./smartPricingTestAnalyticsService');
const { getShopSmartPricingGuardrails } = require('./smartPricingGuardrailsService');
const {
  buildSmartPricingTestPlan,
  applyPriceArmOverrides,
} = require('./testPlanService');

function getShopifyService() {
  return require('../shopifyService');
}

const RERUN_ELIGIBLE_STATUSES = new Set([
  'stopped',
  'completed',
  'paused',
  'applied',
  'winner_ready',
]);

async function assertSmartPricingProductTest(test, shopDomain) {
  if (!test) {
    throw new Error('Test not found');
  }
  if (!isPriceLikeTestType(test.type) && String(test.type || '').toLowerCase() !== 'offer') {
    throw new Error('This action is available only for Smart Pricing product tests');
  }
  if (isSmartPricingTest(test)) {
    return;
  }
  const plan = await findInboxPlanByTestId(shopDomain, test.id).catch(() => null);
  if (plan?.id) {
    return;
  }
  throw new Error('This endpoint is for Smart Pricing tests only');
}

/**
 * Per-product stop / resume / re-run act on the underlying test, so they are
 * only safe when that test covers exactly one SKU. The UI hides these actions
 * for shared tests; this keeps a direct API call from stopping siblings too.
 */
async function assertTestIsNotShared(shopDomain, testId, action) {
  const planCount = await countInboxPlansForTest(shopDomain, testId).catch(() => 0);
  if (planCount > 1) {
    const err = new Error(
      `This test covers ${planCount} products, so it cannot be ${action} for one product alone. Use the test-level action instead.`
    );
    err.code = 'SHARED_TEST';
    err.planCount = planCount;
    throw err;
  }
}

async function resolvePlanForTest(shopDomain, testId, test = null) {
  const plan =
    (await findInboxPlanByTestId(shopDomain, testId).catch(() => null)) ||
    null;
  if (plan) return plan;
  const meta = test?.metadata && typeof test.metadata === 'object' ? test.metadata : {};
  const planId = String(meta.smart_pricing_plan_id || '').trim();
  if (!planId) return null;
  return getInboxPlanById(shopDomain, planId).catch(() => null);
}

/**
 * Stop one product's test without touching sibling products in the experiment.
 */
async function stopSmartPricingProduct({ testId, shopDomain, reason = 'merchant_stop_product' } = {}) {
  const test = await getTestById(testId, shopDomain);
  await assertSmartPricingProductTest(test, shopDomain);

  const status = String(test.status || '').toLowerCase();
  if (status !== 'running' && status !== 'active' && status !== 'scheduled') {
    throw new Error('Only a running product test can be stopped');
  }
  await assertTestIsNotShared(shopDomain, testId, 'stopped');

  const { stopTest } = require('../abTestEngine');
  const stopped = await stopTest(testId, shopDomain);
  await syncSmartPricingInboxForTest(shopDomain, testId, {
    reason: reason === 'guardrail_breach' ? 'guardrail_breach' : 'merchant_stop_product',
  }).catch(() => null);

  await recordEventForTest(shopDomain, testId, 'stopped', {
    actor: reason === 'guardrail_breach' ? 'guardrail' : 'merchant',
    test: stopped || test,
    payload: { reason },
  }).catch(() => null);

  return {
    test: stopped || (await getTestById(testId, shopDomain)),
    stopped: true,
  };
}

/**
 * Resume one previously paused/stopped product test.
 */
async function resumeSmartPricingProduct({ testId, shopDomain } = {}) {
  const test = await getTestById(testId, shopDomain);
  await assertSmartPricingProductTest(test, shopDomain);

  const status = String(test.status || '').toLowerCase();
  if (status !== 'stopped' && status !== 'paused') {
    throw new Error('Only a paused or stopped product test can be resumed');
  }
  await assertTestIsNotShared(shopDomain, testId, 'resumed');
  // Do not resume after a catalog apply / personalization — that would re-split
  // traffic after the merchant already committed a price.
  const mode = String(test.personalization_mode || '').toLowerCase();
  if (mode === 'personalized' || mode === 'rollout' || mode === 'control') {
    throw new Error('This product has already been decided. Start a re-run instead.');
  }

  const { startTest } = require('../abTestEngine');
  const started = await startTest(testId, shopDomain);
  await syncSmartPricingInboxForTest(shopDomain, testId, {
    reason: 'merchant_resume_product',
  }).catch(() => null);

  await recordEventForTest(shopDomain, testId, 'resumed', {
    actor: 'merchant',
    test: started || test,
    payload: {},
  }).catch(() => null);

  return {
    test: started || (await getTestById(testId, shopDomain)),
    resumed: true,
  };
}

function extractBaselineFromPublish(publish) {
  // Prefer the complete applied list; samples.updated is capped for display and
  // using it would leave later variants unrevertable.
  const updated = Array.isArray(publish?.applied_variants)
    ? publish.applied_variants
    : Array.isArray(publish?.samples?.updated)
      ? publish.samples.updated
      : [];
  return updated
    .filter(row => row?.variant_id)
    .map(row => ({
      product_id: row.product_id || null,
      variant_id: String(row.variant_id),
      previous_price: toFinitePrice(row.previous_price),
      new_price: toFinitePrice(row.new_price),
    }))
    .filter(row => row.previous_price !== null && row.new_price !== null);
}

/**
 * Persist apply baseline on the plan and as a durable event.
 */
async function recordWinnerApplied({
  shopDomain,
  testId,
  test,
  publish,
  actor = 'merchant',
  eventType = 'winner_applied',
} = {}) {
  const baseline = extractBaselineFromPublish(publish);
  const plan = await resolvePlanForTest(shopDomain, testId, test);
  const appliedAt = new Date().toISOString();

  if (plan?.id && baseline.length) {
    await patchInboxPlan(shopDomain, plan.id, {
      applied_baseline: {
        applied_at: appliedAt,
        winner_variant_id: publish?.winner_variant_id || null,
        winner_variant_name: publish?.winner_variant_name || null,
        variants: baseline,
      },
    }).catch(() => null);
  }

  await recordEventForTest(shopDomain, testId, eventType, {
    actor,
    test,
    planId: plan?.id || null,
    productId: plan?.product_id || null,
    variantId: plan?.variant_id || null,
    payload: {
      winner_variant_id: publish?.winner_variant_id || null,
      winner_variant_name: publish?.winner_variant_name || null,
      updated_count: publish?.summary?.updated_count ?? baseline.length,
      variants: baseline,
      applied_at: appliedAt,
    },
  }).catch(() => null);

  return baseline;
}

/**
 * Coerce a stored or Shopify-supplied price to a usable number.
 * Plain `Number()` is unsafe here: `Number(null)` and `Number('')` are both 0,
 * which would turn a missing baseline into a $0 catalog price.
 */
function toFinitePrice(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return null;
  const price = Number(value);
  if (!Number.isFinite(price) || price < 0) return null;
  return price;
}

function pricesMatch(a, b, tolerance = 0.005) {
  const left = toFinitePrice(a);
  const right = toFinitePrice(b);
  if (left === null || right === null) return false;
  return Math.abs(left - right) <= tolerance;
}

/**
 * Revert catalog prices to the snapshot taken at apply time.
 * If Shopify prices drifted from what we applied, require force=true.
 */
async function revertSmartPricingProductPrice({
  testId,
  shopDomain,
  accessToken,
  force = false,
  dryRun = false,
} = {}) {
  if (!accessToken) {
    throw new Error('Missing Shopify access token for this store');
  }
  const test = await getTestById(testId, shopDomain);
  await assertSmartPricingProductTest(test, shopDomain);

  const plan = await resolvePlanForTest(shopDomain, testId, test);
  // plan_id already identifies this SKU, and the two filters are ANDed: also
  // passing testId would hide an apply recorded against an earlier test id.
  const applyEvent = plan?.id
    ? await findLatestApplyEvent(shopDomain, { planId: plan.id })
    : await findLatestApplyEvent(shopDomain, { testId });

  const fromEvent = Array.isArray(applyEvent?.payload?.variants)
    ? applyEvent.payload.variants
    : [];
  const fromPlan = Array.isArray(plan?.applied_baseline?.variants)
    ? plan.applied_baseline.variants
    : [];
  const baseline = fromEvent.length ? fromEvent : fromPlan;

  if (!baseline.length) {
    throw new Error('No apply snapshot found for this product. Nothing to revert.');
  }

  // One fetch per product, not per variant: a multi-variant plan revisits the
  // same product for every row.
  const priceCache = new Map();
  const readCurrentPrice = async (productId, variantId) => {
    if (!priceCache.has(productId)) {
      // getProduct() caps variants at 10, which would leave the current price
      // unreadable — and so the drift guard unenforceable — on larger products.
      const product = await getShopifyService()
        .getProductWithVariants(shopDomain, accessToken, productId, 250)
        .catch(() => null);
      const byVariant = new Map();
      for (const variant of product?.variants || []) {
        byVariant.set(String(variant.id), variant.price);
      }
      priceCache.set(productId, byVariant);
    }
    return toFinitePrice(priceCache.get(productId).get(String(variantId)));
  };

  // Idempotent: if every variant already matches previous_price, treat as done.
  const drifted = [];
  const unverified = [];
  const toRevert = [];
  for (const row of baseline) {
    const productId = row.product_id || plan?.product_id;
    const variantId = row.variant_id;
    if (!productId || !variantId) continue;

    const previousPrice = toFinitePrice(row.previous_price);
    if (previousPrice === null) {
      unverified.push({
        product_id: productId,
        variant_id: variantId,
        reason: 'missing_previous_price',
      });
      continue;
    }

    const currentPrice = await readCurrentPrice(productId, variantId);

    if (pricesMatch(currentPrice, previousPrice)) {
      continue;
    }
    if (currentPrice === null) {
      // The variant is gone or unreadable, so we cannot tell whether the price
      // we applied is still the one live. Never overwrite that blind.
      unverified.push({
        product_id: productId,
        variant_id: variantId,
        reason: 'variant_not_found',
      });
      continue;
    }

    const appliedPrice = toFinitePrice(row.new_price);
    if (appliedPrice !== null && !pricesMatch(currentPrice, appliedPrice)) {
      drifted.push({
        product_id: productId,
        variant_id: variantId,
        expected_applied_price: appliedPrice,
        current_price: currentPrice,
        previous_price: previousPrice,
      });
    }
    toRevert.push({
      product_id: productId,
      variant_id: variantId,
      previous_price: previousPrice,
      current_price: currentPrice,
      new_price: appliedPrice,
    });
  }

  if (!toRevert.length) {
    if (unverified.length) {
      const err = new Error(
        'Could not read the current price for this product in Shopify, so there is nothing safe to revert.'
      );
      err.code = 'REVERT_UNVERIFIABLE';
      err.unverified = unverified;
      throw err;
    }
    return {
      reverted: true,
      already_reverted: true,
      dry_run: Boolean(dryRun),
      updated_count: 0,
      variants: [],
      drifted: [],
      unverified,
    };
  }

  if (drifted.length && !force) {
    const err = new Error(
      'Shopify prices changed after apply. Confirm force=true to overwrite with the pre-apply baseline.'
    );
    err.code = 'PRICE_DRIFT';
    err.drifted = drifted;
    throw err;
  }

  if (dryRun) {
    return {
      reverted: false,
      dry_run: true,
      updated_count: toRevert.length,
      variants: toRevert,
      drifted,
      unverified,
    };
  }

  const updated = [];
  const errors = [];
  for (const row of toRevert) {
    try {
      await getShopifyService().updateProductPrice(
        shopDomain,
        accessToken,
        row.product_id,
        row.variant_id,
        row.previous_price
      );
      updated.push(row);
    } catch (error) {
      errors.push({
        product_id: row.product_id,
        variant_id: row.variant_id,
        error: error.message,
      });
    }
  }

  if (!updated.length) {
    throw new Error(errors[0]?.error || 'Failed to revert any prices');
  }

  const revertedAt = new Date().toISOString();
  if (plan?.id) {
    await patchInboxPlan(shopDomain, plan.id, {
      applied_baseline: {
        ...(plan.applied_baseline || {}),
        reverted_at: revertedAt,
      },
      status: plan.status === 'applied' ? 'completed' : plan.status,
    }).catch(() => null);
  }

  await recordEventForTest(shopDomain, testId, 'reverted', {
    actor: 'merchant',
    test,
    planId: plan?.id || null,
    productId: plan?.product_id || null,
    variantId: plan?.variant_id || null,
    payload: {
      variants: updated.map(row => ({
        product_id: row.product_id,
        variant_id: row.variant_id,
        restored_price: row.previous_price,
        from_price: row.current_price,
      })),
      forced: Boolean(force),
      drifted_count: drifted.length,
      unverified_count: unverified.length,
      errors,
      reverted_at: revertedAt,
    },
  }).catch(() => null);

  return {
    reverted: true,
    dry_run: false,
    updated_count: updated.length,
    variants: updated,
    drifted,
    unverified,
    errors,
  };
}

function inferFollowUpBasePrice(plan = {}, { catalogPrice = null } = {}) {
  if (Number.isFinite(Number(catalogPrice)) && Number(catalogPrice) > 0) {
    return Number(catalogPrice);
  }
  const learningRound = Array.isArray(plan.learning_path)
    ? plan.learning_path.find(row => Number(row.round) === Number(plan.learning_round || 1) + 1)
    : null;
  const previewPrices = learningRound?.candidate_arms_preview;
  if (Array.isArray(previewPrices) && previewPrices.length > 0) {
    const mid = previewPrices[Math.floor(previewPrices.length / 2)];
    if (Number.isFinite(Number(mid))) {
      return Number(mid);
    }
  }
  const arms = Array.isArray(plan.price_arms) ? plan.price_arms : [];
  const nonControl = arms.filter(arm => arm.role !== 'control');
  const pool = nonControl.length ? nonControl : arms;
  if (!pool.length) {
    return Number(plan.current_price) || 0;
  }
  return pool.reduce((best, arm) => (Number(arm.price) > Number(best.price) ? arm : best), pool[0])
    .price;
}

function resolveLearningRound(plan = {}) {
  const current = Number(plan.learning_round);
  if (Number.isFinite(current) && current >= 1) {
    return Math.floor(current);
  }
  return 1;
}

function resolveMaxLearningRounds(plan = {}, guardrails = {}) {
  const fromPlan = Number(plan.launch_preferences?.max_learning_rounds);
  if (Number.isFinite(fromPlan) && fromPlan >= 1) {
    return Math.floor(fromPlan);
  }
  const fromShop = Number(guardrails.max_learning_rounds);
  if (Number.isFinite(fromShop) && fromShop >= 1) {
    return Math.floor(fromShop);
  }
  return 3;
}

function resolveRerunReason(plan = {}, test = null) {
  const status = String(plan.status || test?.status || '')
    .trim()
    .toLowerCase();
  const mode = String(test?.personalization_mode || '')
    .trim()
    .toLowerCase();
  if (status === 'applied' || mode === 'personalized' || mode === 'rollout') {
    return 'winner_iterate';
  }
  return 'loser_retry';
}

/**
 * Build a queued follow-up plan (round N+1) for winners or losers.
 */
async function buildFollowUpPlan({
  shopDomain,
  plan,
  test = null,
  armPrices = null,
  catalogPrice = null,
  note = null,
  autoQueued = false,
} = {}) {
  const guardrails = await getShopSmartPricingGuardrails(shopDomain).catch(() => ({}));
  const currentRound = resolveLearningRound(plan);
  const maxRounds = resolveMaxLearningRounds(plan, guardrails);
  const nextRound = currentRound + 1;

  if (nextRound > maxRounds) {
    const err = new Error(
      `This product has reached the maximum of ${maxRounds} learning rounds.`
    );
    err.code = 'MAX_LEARNING_ROUNDS';
    throw err;
  }

  const stored = await listInboxPlans(shopDomain);
  const existingChild = (stored.plans || []).find(
    row =>
      row.parent_plan_id === plan.id &&
      Number(row.learning_round) === nextRound &&
      row.archived !== true
  );
  if (existingChild) {
    return {
      queued: false,
      reason: 'round_exists',
      follow_up_plan_id: existingChild.id,
      follow_up_plan: existingChild,
    };
  }

  const basePrice = inferFollowUpBasePrice(plan, { catalogPrice });
  const statsInput = plan.statistical_design || {};
  const shopMde = Number(guardrails.mde_percent);
  const shopConf = Number(guardrails.confidence_level);
  const shopPower = Number(guardrails.statistical_power);
  const shopMin = Number(guardrails.min_sample_size_per_variation);

  let rebuilt = buildSmartPricingTestPlan({
    shopDomain,
    productId: plan.product_id,
    variantId: plan.variant_id,
    title: `${String(plan.title || 'Product').replace(/\s·\sRound\s\d+$/i, '')} · Round ${nextRound}`,
    currentPrice: basePrice,
    currency: plan.currency,
    scenarioPreset: 'conservative',
    variantCount: 2,
    dailyVisitors: plan.daily_visitors,
    baselineConversionRate: statsInput.baseline_conversion_rate,
    baselinePpv: statsInput.baseline_ppv,
    mdePercent: Number(statsInput.mde_percent) || (Number.isFinite(shopMde) ? shopMde : 10),
    confidenceLevel: Number(statsInput.confidence_level) || (shopConf === 95 ? 95 : 90),
    power: Number(statsInput.statistical_power) || (Number.isFinite(shopPower) ? shopPower : 80),
    ...(Number.isFinite(shopMin) && shopMin >= 1 ? { minSampleSize: Math.round(shopMin) } : {}),
    guardrails,
    imageUrl: plan.image_url,
  });

  if (armPrices && typeof armPrices === 'object' && Object.keys(armPrices).length) {
    rebuilt = applyPriceArmOverrides(rebuilt, armPrices, guardrails);
  }

  const followUp = {
    ...rebuilt,
    status: 'queued',
    parent_plan_id: plan.id,
    previous_test_id: plan.test_id || test?.id || null,
    learning_round: nextRound,
    image_url: plan.image_url || rebuilt.image_url,
    auto_queued: Boolean(autoQueued),
    rerun_reason: resolveRerunReason(plan, test),
    rerun_note: note ? String(note).trim().slice(0, 500) : null,
    metadata: {
      ...(rebuilt.metadata && typeof rebuilt.metadata === 'object' ? rebuilt.metadata : {}),
      experiment_id:
        plan.metadata?.experiment_id ||
        plan.experiment_id ||
        null,
    },
  };
  // Preserve experiment grouping when present on the parent.
  if (plan.experiment_id || plan.metadata?.experiment_id) {
    followUp.experiment_id = plan.experiment_id || plan.metadata.experiment_id;
  }

  await saveInboxPlans(shopDomain, [...stored.plans, followUp]);

  await recordProductEvent({
    shopDomain,
    planId: plan.id,
    testId: plan.test_id || test?.id || null,
    productId: plan.product_id,
    variantId: plan.variant_id,
    eventType: 'rerun_queued',
    actor: autoQueued ? 'system' : 'merchant',
    payload: {
      follow_up_plan_id: followUp.id,
      learning_round: nextRound,
      rerun_reason: followUp.rerun_reason,
      current_price: basePrice,
      note: followUp.rerun_note,
    },
  }).catch(() => null);

  return {
    queued: true,
    follow_up_plan_id: followUp.id,
    parent_plan_id: plan.id,
    learning_round: nextRound,
    follow_up_plan: followUp,
  };
}

/**
 * Manual re-run: queue a follow-up plan for winners or losers.
 */
async function rerunSmartPricingProduct({
  testId,
  shopDomain,
  accessToken = null,
  armPrices = null,
  useAiSuggestion = false,
  note = null,
} = {}) {
  const test = await getTestById(testId, shopDomain);
  await assertSmartPricingProductTest(test, shopDomain);
  const plan = await resolvePlanForTest(shopDomain, testId, test);
  if (!plan) {
    throw new Error('No Smart Pricing plan linked to this test');
  }

  const planStatus = String(plan.status || '').toLowerCase();
  const testStatus = String(test.status || '').toLowerCase();
  const eligible =
    RERUN_ELIGIBLE_STATUSES.has(planStatus) ||
    RERUN_ELIGIBLE_STATUSES.has(testStatus) ||
    planStatus === 'completed' ||
    testStatus === 'completed';
  if (!eligible && (testStatus === 'running' || testStatus === 'active')) {
    throw new Error('Stop this product before queueing a re-run, or wait for a decision.');
  }
  await assertTestIsNotShared(shopDomain, testId, 're-run');

  let catalogPrice = null;
  if (accessToken && plan.product_id) {
    try {
      const product = await getShopifyService().getProductWithVariants(
        shopDomain,
        accessToken,
        plan.product_id,
        250
      );
      const variants = product?.variants || [];
      // Only fall back to the first variant for product-level plans. Pricing a
      // re-run off an unrelated variant is worse than falling back to the plan.
      const match = plan.variant_id
        ? variants.find(v => String(v.id) === String(plan.variant_id))
        : variants[0];
      catalogPrice = toFinitePrice(match?.price);
    } catch {
      /* fall back to plan price */
    }
  }

  let resolvedArmPrices = armPrices;
  if (useAiSuggestion && !resolvedArmPrices) {
    const { suggestPricesForRerun } = require('./smartPricingAiSuggestService');
    const suggestion = await suggestPricesForRerun({
      shopDomain,
      plan,
      test,
    }).catch(() => null);
    if (suggestion?.arm_prices) {
      resolvedArmPrices = suggestion.arm_prices;
    }
  }

  return buildFollowUpPlan({
    shopDomain,
    plan,
    test,
    armPrices: resolvedArmPrices,
    catalogPrice,
    note,
    autoQueued: false,
  });
}

/**
 * Whether auto round-2 should queue for this plan (env OR plan preference OR shop default).
 */
function shouldAutoQueueFollowUp(plan = {}, guardrails = {}) {
  const envOn =
    String(process.env.SMART_PRICING_AUTO_ROUND2 || '')
      .trim()
      .toLowerCase() === 'true';
  const planPref = plan.launch_preferences?.auto_round2;
  if (planPref === true) return true;
  if (planPref === false) return false;
  if (envOn) return true;
  return guardrails.auto_round2_default === true;
}

async function maybeAutoQueueFollowUpPlan(shopDomain, planId) {
  const id = String(planId || '').trim();
  if (!id) {
    return { queued: false, reason: 'missing_plan_id' };
  }
  const plan = await getInboxPlanById(shopDomain, id).catch(() => null);
  if (!plan) {
    return { queued: false, reason: 'plan_not_found' };
  }
  if (plan.status !== 'applied') {
    return { queued: false, reason: 'plan_not_applied' };
  }

  const guardrails = await getShopSmartPricingGuardrails(shopDomain).catch(() => ({}));
  if (!shouldAutoQueueFollowUp(plan, guardrails)) {
    return { queued: false, reason: 'disabled' };
  }

  try {
    return await buildFollowUpPlan({
      shopDomain,
      plan,
      autoQueued: true,
    });
  } catch (err) {
    if (err.code === 'MAX_LEARNING_ROUNDS') {
      return { queued: false, reason: 'max_rounds', message: err.message };
    }
    throw err;
  }
}

/**
 * Walk parent_plan_id chain and return oldest → newest.
 */
async function resolvePlanLineage(shopDomain, planId) {
  const stored = await listInboxPlans(shopDomain);
  const byId = new Map((stored.plans || []).map(p => [p.id, p]));
  const chain = [];
  let current = byId.get(String(planId || '').trim()) || null;
  const seen = new Set();

  // Walk up to root first.
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current);
    const parentId = String(current.parent_plan_id || '').trim();
    if (!parentId) break;
    current = byId.get(parentId) || null;
  }

  // Then walk children of the leaf forward if any later rounds exist.
  const rows = stored.plans || [];
  const childOf = parentId =>
    rows.find(
      row =>
        String(row.parent_plan_id || '').trim() === parentId &&
        !seen.has(row.id) &&
        row.archived !== true
    ) || null;

  let next = chain.length ? childOf(chain[chain.length - 1].id) : null;
  while (next) {
    seen.add(next.id);
    chain.push(next);
    next = childOf(next.id);
  }

  return chain;
}

/**
 * Full per-product report payload for the drill-down UI.
 */
async function buildSmartPricingProductReport(shopDomain, planId) {
  const plan = await getInboxPlanById(shopDomain, planId);
  if (!plan) {
    throw new Error('Plan not found');
  }

  const lineage = await resolvePlanLineage(shopDomain, plan.id);
  const currentTestId = String(plan.test_id || '').trim();

  // Analytics is a per-test aggregation, so cache by test id: the current round
  // appears both in the lineage and as the panel's headline metrics.
  const analyticsByTestId = new Map();
  const analyticsFor = async testId => {
    if (!testId) return null;
    if (!analyticsByTestId.has(testId)) {
      analyticsByTestId.set(
        testId,
        await buildSmartPricingTestAnalytics(shopDomain, testId).catch(() => null)
      );
    }
    return analyticsByTestId.get(testId);
  };

  const rounds = [];
  for (const row of lineage) {
    const tid = String(row.test_id || '').trim();
    const analytics = await analyticsFor(tid);
    rounds.push({
      plan_id: row.id,
      test_id: tid || null,
      learning_round: resolveLearningRound(row),
      status: row.status || null,
      title: row.title || null,
      current_price: row.current_price ?? null,
      rerun_reason: row.rerun_reason || null,
      parent_plan_id: row.parent_plan_id || null,
      previous_test_id: row.previous_test_id || null,
      auto_queued: row.auto_queued === true,
      analytics,
    });
  }

  // Events for the whole lineage (all plan ids in the chain).
  const eventLists = await Promise.all(
    lineage.map(row =>
      listProductEvents(shopDomain, { planId: row.id, limit: 100 }).catch(() => [])
    )
  );
  const events = eventLists
    .flat()
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

  const currentAnalytics = await analyticsFor(currentTestId);

  return {
    plan,
    product_decision: currentAnalytics?.product_decision || null,
    analytics: currentAnalytics,
    lineage: rounds,
    events,
    applied_baseline: plan.applied_baseline || null,
  };
}

module.exports = {
  stopSmartPricingProduct,
  resumeSmartPricingProduct,
  revertSmartPricingProductPrice,
  recordWinnerApplied,
  extractBaselineFromPublish,
  buildFollowUpPlan,
  rerunSmartPricingProduct,
  maybeAutoQueueFollowUpPlan,
  shouldAutoQueueFollowUp,
  resolvePlanLineage,
  buildSmartPricingProductReport,
  inferFollowUpBasePrice,
  resolveLearningRound,
  resolveMaxLearningRounds,
  RERUN_ELIGIBLE_STATUSES,
};
