const { query } = require('../utils/database');
const { normalizePriceSurfaceMappings } = require('../utils/priceSurfaceRegistry');

function isUndefinedColumnError(error) {
  return error?.code === '42703';
}

function kvKeyForShop(shopDomain) {
  return `price_surface_mappings.${String(shopDomain || '')
    .trim()
    .toLowerCase()}`;
}

async function getShopPriceSurfaceMappings(shopDomain, options = {}) {
  const normalizedShopDomain = String(shopDomain || '')
    .trim()
    .toLowerCase();
  if (!normalizedShopDomain) {
    return [];
  }
  try {
    const result = await query(
      `SELECT price_surface_mappings
       FROM shop_settings
       WHERE shop_domain = $1`,
      [normalizedShopDomain]
    );
    const row = result.rows[0];
    if (!row || row.price_surface_mappings === null || row.price_surface_mappings === undefined) {
      return [];
    }
    return normalizePriceSurfaceMappings(row.price_surface_mappings, {
      allowEmptySelector: options.allowEmptySelector === true,
    });
  } catch (error) {
    if (!isUndefinedColumnError(error)) {
      throw error;
    }
  }
  const result = await query('SELECT value FROM key_value_store WHERE key = $1 LIMIT 1', [
    kvKeyForShop(normalizedShopDomain),
  ]);
  const rawValue = result.rows?.[0]?.value;
  if (rawValue === null || rawValue === undefined) {
    return [];
  }
  let parsed;
  try {
    parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
  } catch {
    parsed = [];
  }
  return normalizePriceSurfaceMappings(parsed, {
    allowEmptySelector: options.allowEmptySelector === true,
  });
}

async function saveShopPriceSurfaceMappings(shopDomain, mappings, options = {}) {
  const normalizedShopDomain = String(shopDomain || '')
    .trim()
    .toLowerCase();
  if (!normalizedShopDomain) {
    throw new Error('Shop domain required');
  }
  const normalized = normalizePriceSurfaceMappings(mappings, {
    allowEmptySelector: options.allowEmptySelector === true,
  }).slice(0, 25);
  try {
    await query(
      `INSERT INTO shop_settings (shop_domain, price_surface_mappings, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (shop_domain)
       DO UPDATE SET
         price_surface_mappings = EXCLUDED.price_surface_mappings,
         updated_at = NOW()`,
      [normalizedShopDomain, JSON.stringify(normalized)]
    );
  } catch (error) {
    if (!isUndefinedColumnError(error)) {
      throw error;
    }
    await query(
      `INSERT INTO key_value_store (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key)
       DO UPDATE SET
         value = EXCLUDED.value,
         updated_at = NOW()`,
      [kvKeyForShop(normalizedShopDomain), JSON.stringify(normalized)]
    );
  }
  return normalized;
}

module.exports = {
  getShopPriceSurfaceMappings,
  saveShopPriceSurfaceMappings,
};
