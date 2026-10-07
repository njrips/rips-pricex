/**
 * Read what a test points at: which variants its config prices, and whether it
 * covers a given product. `priceTestEnrollmentService` turns those answers into
 * who currently holds a product.
 */

const { normalizeVariantGid } = require('./smartPricingCatalogUtils');

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

module.exports = {
  collectVariantIdsFromConfig,
};
