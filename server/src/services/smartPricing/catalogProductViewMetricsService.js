/**
 * Loads measured storefront PDP views for Smart Pricing catalog rows.
 */

const { fetchCatalogProductViewMetrics } = require('../../models/catalogProductViewStore');
const { normalizeProductGid, normalizeVariantGid } = require('./smartPricingCatalogUtils');

async function loadMeasuredViewMetricsMap(shopDomain, options = {}) {
  if (process.env.SMART_PRICING_CATALOG_VIEWS === 'false') {
    return new Map();
  }
  try {
    return await fetchCatalogProductViewMetrics(shopDomain, options);
  } catch {
    return new Map();
  }
}

function resolveMeasuredViewsForSku(row = {}, viewMetrics = new Map()) {
  if (!(viewMetrics instanceof Map) || viewMetrics.size === 0) {
    return null;
  }
  const variantId = normalizeVariantGid(row.variant_id);
  const productId = normalizeProductGid(row.product_id);
  if (variantId && viewMetrics.has(variantId)) {
    const direct = viewMetrics.get(variantId);
    if (Number(direct?.views_30d) > 0) {
      return direct;
    }
  }
  if (productId && viewMetrics.has(productId)) {
    const productLevel = viewMetrics.get(productId);
    if (Number(productLevel?.views_30d) > 0) {
      return {
        ...productLevel,
        views_30d: Number(productLevel.views_30d) || 0,
        views_60d: Number(productLevel.views_60d) || 0,
      };
    }
  }
  return null;
}

module.exports = {
  loadMeasuredViewMetricsMap,
  resolveMeasuredViewsForSku,
};
