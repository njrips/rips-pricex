/**
 * Shop-level PDP view rollups for Smart Pricing measured traffic.
 */

const { query } = require('../utils/database');
const {
  normalizeProductGid,
  normalizeVariantGid,
  normalizeCollectionGid,
} = require('../services/smartPricing/smartPricingCatalogUtils');
const {
  getProductCollectionMap,
  resolveCollectionsForProduct,
} = require('../services/smartPricing/smartPricingProductCollectionMapService');

function normalizeShopDomain(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function normalizeVisitorKey(value) {
  return String(value || '')
    .trim()
    .slice(0, 128);
}

async function recordCatalogProductView({
  shopDomain = '',
  productId = '',
  variantId = '',
  visitorKey = '',
} = {}) {
  const shop = normalizeShopDomain(shopDomain);
  const product = normalizeProductGid(productId);
  const variant = normalizeVariantGid(variantId) || '';
  const visitor = normalizeVisitorKey(visitorKey);
  if (!shop || !product || !visitor) {
    return { recorded: false, reason: 'missing_fields' };
  }

  const sessionInsert = await query(
    `INSERT INTO catalog_product_view_sessions (event_date, shop_domain, product_id, visitor_key, variant_id)
     VALUES (CURRENT_DATE, $1, $2, $3, $4)
     ON CONFLICT (event_date, shop_domain, product_id, visitor_key) DO NOTHING
     RETURNING visitor_key`,
    [shop, product, visitor, variant]
  );
  if (!sessionInsert.rows?.length) {
    return { recorded: false, reason: 'duplicate_session' };
  }

  await query(
    `INSERT INTO catalog_product_view_daily_rollups (
       event_date, shop_domain, product_id, variant_id, view_count, last_seen_at, updated_at
     )
     VALUES (CURRENT_DATE, $1, $2, $3, 1, NOW(), NOW())
     ON CONFLICT (event_date, shop_domain, product_id, variant_id)
     DO UPDATE SET
       view_count = catalog_product_view_daily_rollups.view_count + 1,
       last_seen_at = NOW(),
       updated_at = NOW()`,
    [shop, product, variant]
  );

  try {
    const collectionMap = await getProductCollectionMap(shop);
    const collectionIds = resolveCollectionsForProduct(product, collectionMap);
    for (const collectionId of collectionIds) {
      const normalizedCollection = normalizeCollectionGid(collectionId);
      if (!normalizedCollection) {
        continue;
      }
      await query(
        `INSERT INTO catalog_collection_view_daily_rollups (
           event_date, shop_domain, collection_id, view_count, last_seen_at, updated_at
         )
         VALUES (CURRENT_DATE, $1, $2, 1, NOW(), NOW())
         ON CONFLICT (event_date, shop_domain, collection_id)
         DO UPDATE SET
           view_count = catalog_collection_view_daily_rollups.view_count + 1,
           last_seen_at = NOW(),
           updated_at = NOW()`,
        [shop, normalizedCollection]
      );
    }
  } catch {
    /* collection rollups are best-effort */
  }

  return { recorded: true, reason: null };
}

async function fetchCatalogProductViewMetrics(shopDomain, { daysBack = 60 } = {}) {
  const shop = normalizeShopDomain(shopDomain);
  if (!shop) {
    return new Map();
  }
  const days = Math.max(1, Math.min(Number(daysBack) || 60, 120));
  const result = await query(
    `SELECT
       product_id,
       variant_id,
       SUM(CASE WHEN event_date >= CURRENT_DATE - INTERVAL '30 days' THEN view_count ELSE 0 END)::bigint AS views_30d,
       SUM(CASE WHEN event_date >= CURRENT_DATE - INTERVAL '60 days' THEN view_count ELSE 0 END)::bigint AS views_60d,
       MAX(last_seen_at) AS last_view_at
     FROM catalog_product_view_daily_rollups
     WHERE shop_domain = $1
       AND event_date >= CURRENT_DATE - ($2::int * INTERVAL '1 day')
     GROUP BY product_id, variant_id`,
    [shop, days]
  );

  const map = new Map();
  const productTotals = new Map();
  (result.rows || []).forEach(row => {
    const productId = normalizeProductGid(row.product_id);
    const variantId = normalizeVariantGid(row.variant_id) || '';
    const payload = {
      product_id: productId,
      variant_id: variantId || null,
      views_30d: Number(row.views_30d) || 0,
      views_60d: Number(row.views_60d) || 0,
      last_view_at: row.last_view_at || null,
    };
    if (variantId) {
      map.set(variantId, payload);
    }
    const existing = productTotals.get(productId) || {
      product_id: productId,
      variant_id: null,
      views_30d: 0,
      views_60d: 0,
      last_view_at: null,
    };
    existing.views_30d += payload.views_30d;
    existing.views_60d += payload.views_60d;
    if (
      payload.last_view_at &&
      (!existing.last_view_at || payload.last_view_at > existing.last_view_at)
    ) {
      existing.last_view_at = payload.last_view_at;
    }
    productTotals.set(productId, existing);
  });
  productTotals.forEach((value, productId) => {
    if (Number(value.views_30d) > 0) {
      map.set(productId, value);
    }
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
       SUM(CASE WHEN event_date >= CURRENT_DATE - INTERVAL '30 days' THEN view_count ELSE 0 END)::bigint AS views_30d,
       SUM(CASE WHEN event_date >= CURRENT_DATE - INTERVAL '60 days' THEN view_count ELSE 0 END)::bigint AS views_60d,
       MAX(last_seen_at) AS last_view_at
     FROM catalog_collection_view_daily_rollups
     WHERE shop_domain = $1
       AND event_date >= CURRENT_DATE - ($2::int * INTERVAL '1 day')${collectionFilter}
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
  recordCatalogProductView,
  fetchCatalogProductViewMetrics,
  fetchCatalogCollectionViewMetrics,
};
