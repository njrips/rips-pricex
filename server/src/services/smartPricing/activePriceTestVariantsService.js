/**
 * Read what a test points at: which variants its config prices, and whether it
 * covers a given product. `priceTestEnrollmentService` turns those answers into
 * who currently holds a product.
 */

const { normalizeVariantGid, normalizeProductGid } = require('./smartPricingCatalogUtils');

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

module.exports = {
  collectVariantIdsFromConfig,
  testTargetsProduct,
};
