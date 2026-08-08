/**
 * Resolve Shopify variant IDs that already have a running RipX price test.
 */

const { getTestsByShop } = require('../../models/test');
const { normalizeVariantGid, normalizeProductGid } = require('./smartPricingCatalogUtils');

const PRICE_TEST_TYPES = new Set(['price', 'pricing', 'smart-pricing']);

function collectVariantIdsFromConfig(config = {}) {
  const ids = new Set();
  const byProduct =
    config?.byProduct && typeof config.byProduct === 'object' ? config.byProduct : {};
  Object.values(byProduct).forEach(productEntry => {
    const byVariant =
      productEntry?.byVariant && typeof productEntry.byVariant === 'object'
        ? productEntry.byVariant
        : {};
    Object.keys(byVariant).forEach(variantKey => {
      const gid = normalizeVariantGid(variantKey);
      if (gid) {
        ids.add(gid);
      }
    });
  });
  return ids;
}

function testTargetsProduct(test = {}, productId) {
  const normalizedProductId = normalizeProductGid(productId);
  if (!normalizedProductId) {
    return false;
  }
  const targetType = String(test?.target_type || '')
    .trim()
    .toLowerCase();
  const targetId = normalizeProductGid(test?.target_id);
  if (targetType === 'all-products' || targetType === 'all_products') {
    return true;
  }
  if (targetId && targetId === normalizedProductId) {
    return true;
  }
  const targetIds = Array.isArray(test?.target_ids) ? test.target_ids : [];
  return targetIds.some(id => normalizeProductGid(id) === normalizedProductId);
}

async function getActivePriceTestVariantIds(shopDomain) {
  const running = await getTestsByShop(shopDomain, 'running');
  const variantIds = new Set();

  running.forEach(test => {
    const type = String(test?.type || '')
      .trim()
      .toLowerCase();
    if (!PRICE_TEST_TYPES.has(type)) {
      return;
    }

    const variants = Array.isArray(test?.variants) ? test.variants : [];
    variants.forEach(variant => {
      const config = variant?.config && typeof variant.config === 'object' ? variant.config : {};
      collectVariantIdsFromConfig(config).forEach(id => variantIds.add(id));
    });

    const targetType = String(test?.target_type || '')
      .trim()
      .toLowerCase();
    if (targetType === 'product' || targetType === 'products') {
      const productId = normalizeProductGid(test?.target_id);
      if (productId) {
        variantIds.add(`product:${productId}`);
      }
    }
  });

  return variantIds;
}

function variantHasActivePriceTest(activeSet, { variantId, productId } = {}) {
  const normalizedVariantId = normalizeVariantGid(variantId);
  const normalizedProductId = normalizeProductGid(productId);
  if (normalizedVariantId && activeSet.has(normalizedVariantId)) {
    return true;
  }
  if (normalizedProductId && activeSet.has(`product:${normalizedProductId}`)) {
    return true;
  }
  return false;
}

module.exports = {
  getActivePriceTestVariantIds,
  variantHasActivePriceTest,
  collectVariantIdsFromConfig,
  testTargetsProduct,
};
