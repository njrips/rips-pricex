/**
 * Cached product → collection membership for view rollup attribution.
 */

const { query } = require('../../utils/database');
const { normalizeProductGid, normalizeCollectionGid } = require('./smartPricingCatalogUtils');

function kvKey(shopDomain) {
  return `smart_pricing_product_collections.${String(shopDomain || '')
    .trim()
    .toLowerCase()}`;
}

async function getProductCollectionMap(shopDomain) {
  const shop = String(shopDomain || '')
    .trim()
    .toLowerCase();
  if (!shop) {
    return {};
  }
  try {
    const result = await query('SELECT value FROM key_value_store WHERE key = $1 LIMIT 1', [
      kvKey(shop),
    ]);
    const raw = result.rows?.[0]?.value;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return parsed?.map && typeof parsed.map === 'object' ? parsed.map : {};
  } catch {
    return {};
  }
}

async function saveProductCollectionMap(shopDomain, map = {}) {
  const shop = String(shopDomain || '')
    .trim()
    .toLowerCase();
  if (!shop) {
    return { count: 0 };
  }
  const normalized = {};
  Object.entries(map).forEach(([productId, collectionIds]) => {
    const product = normalizeProductGid(productId);
    if (!product) {
      return;
    }
    const ids = (Array.isArray(collectionIds) ? collectionIds : [])
      .map(id => normalizeCollectionGid(id))
      .filter(Boolean);
    if (ids.length) {
      normalized[product] = Array.from(new Set(ids));
    }
  });
  await query(
    `INSERT INTO key_value_store (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [kvKey(shop), JSON.stringify({ map: normalized, updated_at: new Date().toISOString() })]
  );
  return { count: Object.keys(normalized).length };
}

function resolveCollectionsForProduct(productId, map = {}) {
  const product = normalizeProductGid(productId);
  if (!product) {
    return [];
  }
  return Array.isArray(map[product]) ? map[product] : [];
}

module.exports = {
  getProductCollectionMap,
  saveProductCollectionMap,
  resolveCollectionsForProduct,
};
