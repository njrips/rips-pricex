/**
 * Apply Smart Pricing price test winners to traffic and optionally Shopify catalog.
 */

const { getTestById } = require('../../models/test');
const { applyPersonalization } = require('../personalizationService');
const {
  resolveWinnerVariantForPublish,
  fetchTargetProductsForPublish,
  publishWinnerPricesToShopify,
  buildRolloutRows,
} = require('../priceTestWinnerPublishService');

function isSmartPricingTest(test = {}) {
  const metadata = test.metadata && typeof test.metadata === 'object' ? test.metadata : {};
  return (
    metadata.smart_pricing_source === 'smart_pricing' || Boolean(metadata.smart_pricing_plan_id)
  );
}

function isPriceLikeTestType(type) {
  const t = String(type || '')
    .trim()
    .toLowerCase();
  return t === 'price' || t === 'pricing';
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

async function previewSmartPricingWinnerRollout({
  testId,
  shopDomain,
  accessToken,
  variantIndex,
} = {}) {
  const test = await getTestById(testId, shopDomain);
  if (!test) {
    throw new Error('Test not found');
  }
  if (!isPriceLikeTestType(test.type)) {
    throw new Error('Winner rollout is available only for price tests');
  }
  if (!isSmartPricingTest(test)) {
    throw new Error('This endpoint is for Smart Pricing tests only');
  }

  const selectedVariantIndex = parseVariantIndex(variantIndex);
  const winnerVariant = await resolveWinnerVariantForPublish(
    test,
    shopDomain,
    selectedVariantIndex
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
} = {}) {
  const test = await getTestById(testId, shopDomain);
  if (!test) {
    throw new Error('Test not found');
  }
  if (!isPriceLikeTestType(test.type)) {
    throw new Error('Winner rollout is available only for price tests');
  }
  if (!isSmartPricingTest(test)) {
    throw new Error('This endpoint is for Smart Pricing tests only');
  }
  if (!dryRun && test.status !== 'stopped' && test.status !== 'completed') {
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

  const updatedTest = await applyPersonalization(testId, shopDomain, {
    variantIndex: selectedVariantIndex,
  });

  let publish = null;
  if (publishToShopify) {
    const winnerVariant = await resolveWinnerVariantForPublish(
      updatedTest,
      shopDomain,
      selectedVariantIndex ?? updatedTest.winner_variant_index
    );
    if (!winnerVariant) {
      throw new Error('Could not determine winner variant after personalization');
    }
    const preloadedProducts = await fetchTargetProductsForPublish(
      updatedTest,
      shopDomain,
      accessToken
    );
    publish = await publishWinnerPricesToShopify({
      test: updatedTest,
      winnerVariant,
      shopDomain,
      accessToken,
      preloadedProducts,
      dryRun: false,
    });
  }

  return {
    test: updatedTest,
    publish,
    personalized: true,
    published_to_shopify: Boolean(publishToShopify),
  };
}

module.exports = {
  isSmartPricingTest,
  previewSmartPricingWinnerRollout,
  applySmartPricingWinnerRollout,
};
