/**
 * Shop-level PDP view rollups for Smart Pricing measured traffic.
 *
 * These read the tables the storefront tracker writes: catalog_product_view_daily
 * for page views and catalog_product_view_sessions for one row per unique
 * visitor per product per day. Both are per product; the tracker has no variant
 * granularity, so callers resolve a SKU through its product.
 *
 * Visitor counts come from the sessions table rather than the `sessions` column
 * on the daily rollup, which is authoritative for every row ever written — the
 * tracker only ever set that column on the day's first view.
 */

const { query } = require('../utils/database');
const {
  normalizeProductGid,
  normalizeCollectionGid,
} = require('../services/smartPricing/smartPricingCatalogUtils');

function normalizeShopDomain(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

async function fetchCatalogProductViewMetrics(shopDomain, { daysBack = 60 } = {}) {
  const shop = normalizeShopDomain(shopDomain);
  if (!shop) {
    return new Map();
  }
  const days = Math.max(1, Math.min(Number(daysBack) || 60, 120));
  const result = await query(
    `WITH views AS (
       SELECT
         product_id,
         SUM(CASE WHEN day >= CURRENT_DATE - INTERVAL '30 days' THEN views ELSE 0 END)::bigint AS views_30d,
         SUM(CASE WHEN day >= CURRENT_DATE - INTERVAL '60 days' THEN views ELSE 0 END)::bigint AS views_60d,
         MAX(day) AS last_view_at
       FROM catalog_product_view_daily
       WHERE shop_domain = $1
         AND day >= CURRENT_DATE - ($2::int * INTERVAL '1 day')
       GROUP BY product_id
     ),
     visitors AS (
       SELECT
         product_id,
         COUNT(*) FILTER (WHERE day >= CURRENT_DATE - INTERVAL '30 days')::bigint AS visitors_30d,
         COUNT(*) FILTER (WHERE day >= CURRENT_DATE - INTERVAL '60 days')::bigint AS visitors_60d
       FROM catalog_product_view_sessions
       WHERE shop_domain = $1
         AND day >= CURRENT_DATE - ($2::int * INTERVAL '1 day')
       GROUP BY product_id
     )
     SELECT v.product_id, v.views_30d, v.views_60d, v.last_view_at,
            COALESCE(s.visitors_30d, 0) AS visitors_30d,
            COALESCE(s.visitors_60d, 0) AS visitors_60d
     FROM views v
     LEFT JOIN visitors s ON s.product_id = v.product_id`,
    [shop, days]
  );

  const map = new Map();
  (result.rows || []).forEach(row => {
    const productId = normalizeProductGid(row.product_id);
    if (!productId) {
      return;
    }
    const views30d = Number(row.views_30d) || 0;
    if (views30d <= 0) {
      return;
    }
    map.set(productId, {
      product_id: productId,
      variant_id: null,
      views_30d: views30d,
      views_60d: Number(row.views_60d) || 0,
      visitors_30d: Number(row.visitors_30d) || 0,
      visitors_60d: Number(row.visitors_60d) || 0,
      last_view_at: row.last_view_at || null,
    });
  });
  return map;
}

async function fetchCatalogCollectionViewMetrics(
  shopDomain,
  { daysBack = 60, collectionIds = [] } = {}
) {
  const shop = normalizeShopDomain(shopDomain);
  if (!shop) {
    return new Map();
  }
  const ids = (Array.isArray(collectionIds) ? collectionIds : [])
    .map(id => normalizeCollectionGid(id))
    .filter(Boolean);
  const days = Math.max(1, Math.min(Number(daysBack) || 60, 120));
  const params = [shop, days];
  let collectionFilter = '';
  if (ids.length > 0) {
    params.push(ids);
    collectionFilter = ' AND collection_id = ANY($3::text[])';
  }
  const result = await query(
    `SELECT
       collection_id,
       SUM(CASE WHEN day >= CURRENT_DATE - INTERVAL '30 days' THEN views ELSE 0 END)::bigint AS views_30d,
       SUM(CASE WHEN day >= CURRENT_DATE - INTERVAL '60 days' THEN views ELSE 0 END)::bigint AS views_60d,
       MAX(day) AS last_view_at
     FROM catalog_collection_view_daily
     WHERE shop_domain = $1
       AND day >= CURRENT_DATE - ($2::int * INTERVAL '1 day')${collectionFilter}
     GROUP BY collection_id`,
    params
  );
  const map = new Map();
  (result.rows || []).forEach(row => {
    const collectionId = normalizeCollectionGid(row.collection_id);
    if (!collectionId) {
      return;
    }
    map.set(collectionId, {
      collection_id: collectionId,
      views_30d: Number(row.views_30d) || 0,
      views_60d: Number(row.views_60d) || 0,
      last_view_at: row.last_view_at || null,
    });
  });
  return map;
}

module.exports = {
  fetchCatalogProductViewMetrics,
  fetchCatalogCollectionViewMetrics,
};
