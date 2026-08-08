/**
 * Durable Smart Pricing opportunity cache (survives process restarts).
 */

const { query } = require('../../utils/database');
const { normalizeShopDomain } = require('./smartPricingCatalogUtils');

const DEFAULT_TTL_MS =
  Number.parseInt(process.env.SMART_PRICING_OPPORTUNITY_CACHE_TTL_MS || '', 10) ||
  12 * 60 * 60 * 1000;

function kvKey(shopDomain, scope = 'all') {
  const base = normalizeShopDomain(shopDomain);
  const suffix = String(scope || 'all')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '_')
    .slice(0, 80);
  return `smart_pricing_opportunities.${base}.${suffix || 'all'}`;
}

function buildCacheScope({ collectionId = '', productSearch = '' } = {}) {
  const collection = String(collectionId || '').trim() || 'all';
  const search = String(productSearch || '')
    .trim()
    .toLowerCase();
  return search ? `${collection}:${search}` : collection;
}

function isFresh(entry, ttlMs = DEFAULT_TTL_MS) {
  if (!entry?.generated_at) {
    return false;
  }
  const generatedAt = new Date(entry.generated_at).getTime();
  if (!Number.isFinite(generatedAt)) {
    return false;
  }
  return Date.now() - generatedAt < ttlMs;
}

async function readOpportunityCache(shopDomain, scope = 'all') {
  const key = kvKey(shopDomain, scope);
  if (!key.endsWith('.')) {
    try {
      const result = await query(
        'SELECT value, updated_at FROM key_value_store WHERE key = $1 LIMIT 1',
        [key]
      );
      const rawValue = result.rows?.[0]?.value;
      if (rawValue === null || rawValue === undefined) {
        return null;
      }
      const parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
      if (!parsed || typeof parsed !== 'object') {
        return null;
      }
      if (!isFresh(parsed)) {
        return null;
      }
      const opportunities = Array.isArray(parsed.opportunities) ? parsed.opportunities : [];
      const byVariantId = new Map(
        opportunities.map(row => [String(row.variant_id || '').trim(), row]).filter(([id]) => id)
      );
      return {
        ...parsed,
        opportunities,
        byVariantId,
      };
    } catch {
      return null;
    }
  }
  return null;
}

async function writeOpportunityCache(shopDomain, payload = {}, scope = 'all') {
  const key = kvKey(shopDomain, scope);
  if (!key.endsWith('.')) {
    const body = {
      ...payload,
      shop_domain: normalizeShopDomain(shopDomain),
      generated_at: payload.generated_at || new Date().toISOString(),
      opportunities: Array.isArray(payload.opportunities) ? payload.opportunities : [],
    };
    delete body.byVariantId;
    await query(
      `INSERT INTO key_value_store (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key)
       DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, JSON.stringify(body)]
    );
  }
}

async function clearOpportunityCache(shopDomain, scope = null) {
  if (shopDomain && scope) {
    await query('DELETE FROM key_value_store WHERE key = $1', [kvKey(shopDomain, scope)]).catch(
      () => null
    );
    return;
  }
  if (shopDomain) {
    const prefix = `smart_pricing_opportunities.${normalizeShopDomain(shopDomain)}.`;
    await query('DELETE FROM key_value_store WHERE key LIKE $1', [`${prefix}%`]).catch(() => null);
    return;
  }
}

module.exports = {
  readOpportunityCache,
  writeOpportunityCache,
  clearOpportunityCache,
  buildCacheScope,
  isFresh,
  DEFAULT_TTL_MS,
};
