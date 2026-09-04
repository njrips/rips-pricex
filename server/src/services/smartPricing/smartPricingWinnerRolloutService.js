/**
 * Apply Smart Pricing price test winners to traffic and optionally Shopify catalog.
 */

const { getTestById } = require('../../models/test');
const logger = require('../../utils/logger');
const { applyPersonalization } = require('../personalizationService');
const {
  resolveWinnerVariantForPublish,
  fetchTargetProductsForPublish,
  publishWinnerPricesToShopify,
  buildRolloutRows,
} = require('../priceTestWinnerPublishService');
const { isSmartPricingTest, isPriceLikeTestType } = require('./smartPricingTestIdentity');
const { buildSmartPricingTestAnalytics } = require('./smartPricingTestAnalyticsService');
const { resolveReviewedWinnerIndex } = require('./smartPricingWinnerRolloutPolicy');
const {
  acquireJobLease,
  releaseJobLease,
  productRolloutLeaseName,
  ROLLOUT_LEASE_SECONDS,
} = require('../../utils/jobLease');

async function assertSmartPricingPriceTest(test, shopDomain) {
  if (!test) {
    throw new Error('Test not found');
  }
  if (!isPriceLikeTestType(test.type)) {
    throw new Error('Winner rollout is available only for price tests');
  }
  if (isSmartPricingTest(test)) {
    return;
  }
  const { findInboxPlanByTestId } = require('../../models/smartPricingInboxStore');
  const plan = await findInboxPlanByTestId(shopDomain, test.id).catch(() => null);
  if (plan?.id) {
    return;
  }
  throw new Error('This endpoint is for Smart Pricing tests only');
}

function parseVariantIndex(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return undefined;
  }
  const index = Number(raw);
  if (!Number.isInteger(index) || index < 0) {
    throw new Error('variantIndex must be a non-negative integer');
  }
  return index;
}

async function resolveReviewedWinner(test, shopDomain, requestedIndex) {
  const analytics = await buildSmartPricingTestAnalytics(shopDomain, test.id);
  const significance =
    analytics?.significance && typeof analytics.significance === 'object'
      ? analytics.significance
      : {};
  return {
    analytics,
    significance,
    variantIndex: resolveReviewedWinnerIndex(test, significance, requestedIndex),
  };
}

async function previewSmartPricingWinnerRollout({
  testId,
  shopDomain,
  accessToken,
  variantIndex,
} = {}) {
  const test = await getTestById(testId, shopDomain);
  await assertSmartPricingPriceTest(test, shopDomain);

  const selectedVariantIndex = parseVariantIndex(variantIndex);
  const reviewed = await resolveReviewedWinner(test, shopDomain, selectedVariantIndex);
  const winnerVariant = await resolveWinnerVariantForPublish(
    test,
    shopDomain,
    reviewed.variantIndex
  );
  if (!winnerVariant) {
    throw new Error('Could not determine winner variant');
  }

  const preloadedProducts = await fetchTargetProductsForPublish(test, shopDomain, accessToken);
  const publish = await publishWinnerPricesToShopify({
    test,
    winnerVariant,
    shopDomain,
    accessToken,
    preloadedProducts,
    dryRun: true,
  });

  return {
    test_id: test.id,
    test_status: test.status,
    winner_variant_id: publish.winner_variant_id,
    winner_variant_name: publish.winner_variant_name,
    evidence_validated: reviewed.significance.evidenceValidated === true,
    evidence_method: reviewed.significance.method || null,
    rollout_rows: buildRolloutRows(test, winnerVariant),
    publish,
  };
}

async function applySmartPricingWinnerRollout({
  testId,
  shopDomain,
  accessToken,
  variantIndex,
  publishToShopify = true,
  dryRun = false,
  stopIfRunning = false,
} = {}) {
  let test = await getTestById(testId, shopDomain);
  await assertSmartPricingPriceTest(test, shopDomain);
  const running = test.status !== 'stopped' && test.status !== 'completed';
  if (!dryRun && running && !stopIfRunning) {
    throw new Error('Test must be stopped before applying the winner');
  }
  if (!accessToken) {
    throw new Error('Missing Shopify access token for this store');
  }

  const selectedVariantIndex = parseVariantIndex(variantIndex);

  if (dryRun) {
    return previewSmartPricingWinnerRollout({
      testId,
      shopDomain,
      accessToken,
      variantIndex: selectedVariantIndex,
    });
  }

  // One writer per product. Two tabs, the bulk apply, or the unattended
  // auto-apply could otherwise all resolve the same winner and each publish it.
  const lease = productRolloutLeaseName(shopDomain, testId);
  if (!(await acquireJobLease(lease, ROLLOUT_LEASE_SECONDS, { failClosed: true }))) {
    throw new Error('This product is already being applied. Give it a moment and refresh.');
  }
  try {
    return await performWinnerRollout({
      test,
      testId,
      shopDomain,
      accessToken,
      selectedVariantIndex,
      publishToShopify,
      stopIfRunning,
      running,
    });
  } finally {
    await releaseJobLease(lease);
  }
}

async function performWinnerRollout({
  test,
  testId,
  shopDomain,
  accessToken,
  selectedVariantIndex,
  publishToShopify,
  stopIfRunning,
  running,
}) {
  // Resolve the winner while the test is still running so the gates read the
  // same evidence the merchant saw, then stop only this product. Its siblings in
  // the experiment are separate rows and keep collecting.
  const reviewed = await resolveReviewedWinner(test, shopDomain, selectedVariantIndex);

  if (running && stopIfRunning) {
    const { stopTest } = require('../abTestEngine');
    test = (await stopTest(testId, shopDomain)) || (await getTestById(testId, shopDomain));
  }

  // Catalog first, traffic second — the same order the unattended auto-apply
  // uses. None of the publish steps read personalization state (the winner is
  // resolved from the index the merchant reviewed), so nothing is lost by
  // waiting, and a write that throws now leaves the storefront serving the old
  // price rather than the winner the merchant was just told failed to apply.
  let publish = null;
  if (publishToShopify) {
    const winnerVariant = await resolveWinnerVariantForPublish(
      test,
      shopDomain,
      reviewed.variantIndex
    );
    if (!winnerVariant) {
      throw new Error('Could not determine the winning variation to publish.');
    }
    const preloadedProducts = await fetchTargetProductsForPublish(test, shopDomain, accessToken);
    publish = await publishWinnerPricesToShopify({
      test,
      winnerVariant,
      shopDomain,
      accessToken,
      preloadedProducts,
      dryRun: false,
    });
  }

  // Shopify can refuse individual variants — a deleted SKU, a permission gap, a
  // rate limit — while accepting the rest, and that returns normally. Moving all
  // traffic onto a winner whose price only partly exists would charge some
  // shoppers the old price under a test recorded as decided. Leaving the split
  // in place keeps the catalog and the traffic in step, and leaves the merchant
  // a working retry or revert.
  const publishErrors = Number(publish?.summary?.error_count) || 0;
  const personalized = publishErrors === 0;
  if (!personalized) {
    logger.error('Smart Pricing apply left prices unwritten, so traffic was not personalized', {
      shopDomain,
      testId,
      updatedCount: Number(publish?.summary?.updated_count) || 0,
      errorCount: publishErrors,
    });
  }
  const updatedTest = personalized
    ? await applyPersonalization(testId, shopDomain, { variantIndex: reviewed.variantIndex })
    : test;

  // Persist previous/new prices so the merchant can revert later.
  if (publish) {
    const { recordWinnerApplied } = require('./smartPricingProductLifecycleService');
    await recordWinnerApplied({
      shopDomain,
      testId,
      test: updatedTest,
      publish,
      actor: 'merchant',
      eventType: 'winner_applied',
    }).catch(err => {
      // The prices are already written. Failing the whole apply now would be
      // a lie in the other direction, but a lost snapshot is what leaves
      // Revert with nothing to restore, so it has to be visible.
      logger.error('Smart Pricing apply could not save a revert baseline', {
        shopDomain,
        testId,
        error: err?.message,
      });
      return null;
    });
  }

  return {
    test: updatedTest,
    publish,
    personalized,
    published_to_shopify: Boolean(publishToShopify),
  };
}

/**
 * Ends one product without writing a catalog price.
 *
 * Two cases land here. A control win has no price to write — the current price
 * already is the answer. An offer test's winning discount is delivered at
 * checkout rather than through the catalog, so finishing it keeps the winning
 * offer and just ends the split. Either way the product stops testing and
 * clears out of the merchant's queue while its siblings keep running.
 */
async function finishSmartPricingProductWithoutPriceChange({ testId, shopDomain } = {}) {
  // Shares the apply lock: finishing and applying are two different endings for
  // the same product, and they must not both be in progress.
  const lease = productRolloutLeaseName(shopDomain, testId);
  if (!(await acquireJobLease(lease, ROLLOUT_LEASE_SECONDS, { failClosed: true }))) {
    throw new Error('This product is already being finished. Give it a moment and refresh.');
  }
  try {
    return await performProductFinish({ testId, shopDomain });
  } finally {
    await releaseJobLease(lease);
  }
}

async function performProductFinish({ testId, shopDomain }) {
  const test = await getTestById(testId, shopDomain);
  if (!test) {
    throw new Error('Test not found');
  }
  const isOffer = String(test.type || '').toLowerCase() === 'offer';
  if (!isOffer) {
    await assertSmartPricingPriceTest(test, shopDomain);
  }

  const analytics = await buildSmartPricingTestAnalytics(shopDomain, test.id);
  const significance =
    analytics?.significance && typeof analytics.significance === 'object'
      ? analytics.significance
      : {};
  if (significance.sampleReady !== true) {
    throw new Error('This product has not reached its minimum sample yet');
  }

  const controlWin = significance.controlWin === true;
  let winnerIndex = 0;
  if (!controlWin) {
    if (!isOffer) {
      throw new Error('Control is not the decision for this product');
    }
    // An offer challenger has to clear the same review gate a price rollout does.
    winnerIndex = resolveReviewedWinnerIndex(test, significance);
  }

  const { stopTest } = require('../abTestEngine');
  const { updateTest } = require('../../models/test');
  if (test.status !== 'stopped' && test.status !== 'completed') {
    await stopTest(testId, shopDomain);
  }
  const goal = test.goal && typeof test.goal === 'object' ? test.goal : {};
  const updated = await updateTest(testId, shopDomain, {
    status: 'completed',
    personalization_mode: controlWin ? 'control' : test.personalization_mode || null,
    winner_variant_index: winnerIndex,
    winner_variant_id: test.variants?.[winnerIndex]?.id || null,
    goal: {
      ...goal,
      auto_decision: controlWin ? 'control' : 'challenger',
      auto_decided_at: new Date().toISOString(),
      decided_by: 'merchant',
    },
  });

  if (controlWin) {
    const { recordEventForTest } = require('../../models/smartPricingProductEventStore');
    await recordEventForTest(shopDomain, testId, 'finished_control', {
      actor: 'merchant',
      test: updated || test,
      payload: {
        winner_variant_index: winnerIndex,
        control_retained: true,
      },
    }).catch(() => null);
  }

  return {
    test: updated,
    personalized: false,
    published_to_shopify: false,
    control_retained: controlWin,
  };
}

module.exports = {
  isSmartPricingTest,
  resolveReviewedWinnerIndex,
  previewSmartPricingWinnerRollout,
  applySmartPricingWinnerRollout,
  finishSmartPricingProductWithoutPriceChange,
};
