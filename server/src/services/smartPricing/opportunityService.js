/**
 * Stage A — product opportunity list from live catalog + order metrics.
 */

const logger = require('../../utils/logger');
const { getShopSession } = require('../../models/shopSession');
const { buildCatalogMetricsSnapshot } = require('./catalogMetricsService');
const { scoreSkuRows, buildFilterCounts } = require('./opportunityScoringService');
const { normalizeShopDomain, normalizeVariantGid } = require('./smartPricingCatalogUtils');
const {
  readOpportunityCache,
  writeOpportunityCache,
  clearOpportunityCache: clearPersistentOpportunityCache,
  buildCacheScope,
} = require('./smartPricingOpportunityStore');
const {
  enrichOpportunitiesWithAiRanking,
  isAiRankingEnabled,
} = require('./smartPricingAiRankingService');
const { getShopSmartPricingGuardrails } = require('./smartPricingGuardrailsService');

const CACHE_TTL_MS =
  Number.parseInt(process.env.SMART_PRICING_OPPORTUNITY_CACHE_TTL_MS || '', 10) ||
  12 * 60 * 60 * 1000;
const opportunityCache = new Map();

const DEMO_OPPORTUNITIES = [
  {
    product_id: 'gid://shopify/Product/101',
    variant_id: 'gid://shopify/ProductVariant/1001',
    title: 'Classic Hoodie — M',
    sku: 'HD-M-BLK',
    current_price: 59,
    currency: 'USD',
    margin_percent: 52,
    margin_known: true,
    daily_visitors: 140,
    baseline_conversion_rate: 0.024,
    baseline_ppv: 1.84,
    units_sold_30d: 42,
    opportunity_score: 0.91,
    ai_reason: 'High margin, strong traffic, price unchanged 90 days',
    recommended: true,
    tags: ['high_margin', 'high_traffic', 'ai_pick'],
    confidence_level: 'high',
    risk_level: 'low',
    source: 'demo',
  },
  {
    product_id: 'gid://shopify/Product/102',
    variant_id: 'gid://shopify/ProductVariant/1002',
    title: 'Organic Tee — L',
    sku: 'TE-L-WHT',
    current_price: 34,
    currency: 'USD',
    margin_percent: 48,
    margin_known: true,
    daily_visitors: 95,
    baseline_conversion_rate: 0.031,
    baseline_ppv: 0.92,
    units_sold_30d: 29,
    opportunity_score: 0.84,
    ai_reason: 'Steady conversions; room to test +5–8% without traffic loss',
    recommended: true,
    tags: ['high_margin', 'ai_pick'],
    confidence_level: 'high',
    risk_level: 'low',
    source: 'demo',
  },
  {
    product_id: 'gid://shopify/Product/103',
    variant_id: 'gid://shopify/ProductVariant/1003',
    title: 'Canvas Tote',
    sku: 'TB-CNV',
    current_price: 28,
    currency: 'USD',
    margin_percent: 41,
    margin_known: true,
    daily_visitors: 52,
    baseline_conversion_rate: 0.019,
    baseline_ppv: 0.61,
    units_sold_30d: 12,
    opportunity_score: 0.72,
    ai_reason: 'Lower traffic — use 2 price options for faster results',
    recommended: true,
    tags: ['ai_pick'],
    confidence_level: 'medium',
    risk_level: 'medium',
    source: 'demo',
  },
  {
    product_id: 'gid://shopify/Product/104',
    variant_id: 'gid://shopify/ProductVariant/1004',
    title: 'Wool Beanie',
    sku: 'BN-WOL',
    current_price: 22,
    currency: 'USD',
    margin_percent: 55,
    margin_known: true,
    daily_visitors: 38,
    baseline_conversion_rate: 0.028,
    baseline_ppv: 0.48,
    units_sold_30d: 9,
    opportunity_score: 0.65,
    ai_reason: 'High margin accessory; seasonal uplift possible',
    recommended: false,
    tags: ['high_margin'],
    confidence_level: 'medium',
    risk_level: 'medium',
    source: 'demo',
  },
  {
    product_id: 'gid://shopify/Product/105',
    variant_id: 'gid://shopify/ProductVariant/1005',
    title: 'Running Shorts — S',
    sku: 'RS-S-BLU',
    current_price: 45,
    currency: 'USD',
    margin_percent: 44,
    margin_known: true,
    daily_visitors: 78,
    baseline_conversion_rate: 0.022,
    baseline_ppv: 0.88,
    units_sold_30d: 18,
    opportunity_score: 0.68,
    ai_reason: 'Competitive category; test carefully with Safe preset',
    recommended: false,
    tags: ['high_traffic'],
    confidence_level: 'medium',
    risk_level: 'medium',
    source: 'demo',
  },
];

function normalizeFilter(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function memoryCacheKey(shopDomain, scope = 'all') {
  return `${normalizeShopDomain(shopDomain)}::${scope || 'all'}`;
}

function getCacheEntry(shopDomain, scope = 'all') {
  const key = memoryCacheKey(shopDomain, scope);
  const entry = opportunityCache.get(key);
  if (!entry) {
    return null;
  }
  if (Date.now() > entry.expiresAt) {
    opportunityCache.delete(key);
    return null;
  }
  return entry.payload;
}

function setCacheEntry(shopDomain, payload, scope = 'all') {
  const key = memoryCacheKey(shopDomain, scope);
  if (!key || key.startsWith('::')) {
    return;
  }
  opportunityCache.set(key, {
    payload,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

function resolveCatalogScopeOptions(options = {}) {
  const collectionId = String(options.collectionId || options.collection_id || '').trim();
  const productSearch = String(options.productSearch || options.product_search || '').trim();
  const focusCollectionIds =
    options.focusCollectionIds || (collectionId ? [collectionId] : undefined);
  const cacheScope = buildCacheScope({
    collectionId: collectionId || (Array.isArray(focusCollectionIds) ? focusCollectionIds[0] : ''),
    productSearch,
  });
  return {
    collectionId,
    productSearch,
    focusCollectionIds: Array.isArray(focusCollectionIds) ? focusCollectionIds : undefined,
    cacheScope,
  };
}

function applyFilters(rows, { filter = 'all', search = '' } = {}) {
  let filtered = [...rows];
  const q = normalizeFilter(search);
  if (q) {
    filtered = filtered.filter(row => {
      const hay = [row.title, row.sku, row.ai_reason].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }
  if (filter === 'high_margin') {
    filtered = filtered.filter(row => row.tags?.includes('high_margin'));
  } else if (filter === 'high_traffic') {
    filtered = filtered.filter(row => row.tags?.includes('high_traffic'));
  } else if (filter === 'ai_pick') {
    filtered = filtered.filter(row => row.recommended);
  } else if (filter === 'low_data') {
    filtered = filtered.filter(row => row.tags?.includes('low_data'));
  } else if (filter === 'estimated_traffic') {
    filtered = filtered.filter(row => row.tags?.includes('estimated_traffic'));
  } else if (filter === 'measured_traffic') {
    filtered = filtered.filter(row => row.tags?.includes('measured_traffic'));
  }
  filtered.sort((a, b) => b.opportunity_score - a.opportunity_score);
  return filtered;
}

function buildDefaultSelectedVariantIds(opportunities = []) {
  const recommendedIds = opportunities.filter(row => row.recommended).map(row => row.variant_id);
  if (recommendedIds.length > 0) {
    return recommendedIds.slice(0, 3);
  }
  return opportunities
    .slice()
    .sort((a, b) => (Number(b.opportunity_score) || 0) - (Number(a.opportunity_score) || 0))
    .slice(0, 3)
    .map(row => row.variant_id)
    .filter(Boolean);
}

function buildListPayload(opportunities, meta = {}) {
  const generatedAt = meta.generated_at || new Date().toISOString();
  const generatedMs = new Date(generatedAt).getTime();
  const cacheAgeHours =
    Number.isFinite(generatedMs) && generatedMs > 0
      ? Number(((Date.now() - generatedMs) / (60 * 60 * 1000)).toFixed(1))
      : null;
  const recommendedPickCount = opportunities.filter(row => row.recommended).length;
  return {
    opportunities,
    default_selected_variant_ids: buildDefaultSelectedVariantIds(opportunities),
    generated_at: generatedAt,
    cache_age_hours: cacheAgeHours,
    cache_fresh: cacheAgeHours === null ? null : cacheAgeHours < 12,
    source: meta.source || 'catalog',
    cache_scope: meta.cache_scope || 'all',
    ai_summary: meta.ai_summary || null,
    ai_source: meta.ai_source || null,
    connection: meta.connection || null,
    summary: {
      eligible_count: meta.eligible_count ?? opportunities.length,
      catalog_product_count: meta.catalog_product_count ?? null,
      sku_count: meta.sku_count ?? null,
      order_metrics_variant_count: meta.order_metrics_variant_count ?? null,
      shop_conversion_rate: meta.shop_conversion_rate ?? null,
      recommended_pick_count: recommendedPickCount,
      measured_view_sku_count: meta.measured_view_sku_count ?? null,
      catalog_view_metrics_available: meta.catalog_view_metrics_available ?? null,
      imported_cogs_sku_count: meta.imported_cogs_sku_count ?? null,
      collection_view_metrics_available: meta.collection_view_metrics_available ?? null,
      collection_views_30d: meta.collection_views_30d ?? null,
      traffic_cross_check: meta.traffic_cross_check || null,
      guardrails: meta.guardrails || null,
      focus_collection_ids: meta.focus_collection_ids || null,
      product_search: meta.product_search || null,
    },
    filters: buildFilterCounts(opportunities),
    warnings: meta.warnings || [],
  };
}

function listDemoOpportunities(options = {}) {
  const rows = applyFilters(DEMO_OPPORTUNITIES, options);
  return buildListPayload(rows, {
    source: 'demo',
    eligible_count: DEMO_OPPORTUNITIES.length,
    warnings: options.warnings || [
      'Showing sample data — connect Shopify catalog to see live opportunities.',
    ],
  });
}

function buildCatalogUnavailablePayload({
  shopDomain = '',
  reason = 'Live catalog unavailable.',
  code = 'catalog_unavailable',
  cacheScope = 'all',
  warnings = [],
} = {}) {
  return {
    opportunities: [],
    byVariantId: new Map(),
    generated_at: new Date().toISOString(),
    source: 'catalog_unavailable',
    cache_scope: cacheScope,
    ai_summary: null,
    ai_source: null,
    eligible_count: 0,
    catalog_product_count: 0,
    sku_count: 0,
    order_metrics_variant_count: 0,
    measured_view_sku_count: 0,
    catalog_view_metrics_available: false,
    imported_cogs_sku_count: 0,
    collection_view_metrics_available: false,
    collection_views_30d: null,
    traffic_cross_check: null,
    shop_conversion_rate: null,
    guardrails: null,
    focus_collection_ids: [],
    product_search: null,
    connection: {
      connected: false,
      shop: shopDomain || null,
      code,
      message: reason,
      action: code === 'shopify_token_missing' ? 'reconnect' : 'retry',
    },
    warnings: [...warnings, reason],
  };
}

async function resolveAccessToken(shopDomain, accessToken) {
  const token = String(accessToken || '').trim();
  if (token) {
    return token;
  }
  const session = await getShopSession(shopDomain);
  return String(session?.access_token || process.env.SHOPIFY_ACCESS_TOKEN || '').trim();
}

async function loadCatalogOpportunities(shopDomain, accessToken, options = {}) {
  const normalizedShop = normalizeShopDomain(shopDomain);
  const scopeOptions = resolveCatalogScopeOptions(options);
  const { cacheScope, productSearch, focusCollectionIds } = scopeOptions;

  if (!normalizedShop) {
    return buildCatalogUnavailablePayload({
      reason: 'Select a connected Shopify store to load live product opportunities.',
      code: 'shop_domain_missing',
      cacheScope,
    });
  }

  const { forceRefresh = false } = options;

  if (!forceRefresh) {
    const cached = getCacheEntry(normalizedShop, cacheScope);
    if (cached) {
      return cached;
    }
    const persisted = await readOpportunityCache(normalizedShop, cacheScope);
    if (persisted) {
      setCacheEntry(normalizedShop, persisted, cacheScope);
      return persisted;
    }
  }

  const token = await resolveAccessToken(normalizedShop, accessToken);
  if (!token) {
    logger.warn('Smart pricing opportunities: missing Shopify access token', {
      shopDomain: normalizedShop,
    });
    return buildCatalogUnavailablePayload({
      shopDomain: normalizedShop,
      reason: 'Shopify connection required to load live product opportunities.',
      code: 'shopify_token_missing',
      cacheScope,
    });
  }

  try {
    const guardrails =
      options.guardrails || (await getShopSmartPricingGuardrails(normalizedShop).catch(() => null));

    const snapshot = await buildCatalogMetricsSnapshot(normalizedShop, token, {
      focusCollectionIds,
      productSearch,
      guardrails,
    });
    let scored = scoreSkuRows(snapshot.sku_rows).map(row => ({
      ...row,
      source: 'catalog',
    }));

    const aiEnabled = guardrails?.ai_ranking_enabled !== false && isAiRankingEnabled();
    let aiSummary = null;
    let aiSource = 'deterministic';
    if (aiEnabled && scored.length > 0) {
      const aiResult = await enrichOpportunitiesWithAiRanking({
        shopDomain: normalizedShop,
        opportunities: scored,
        guardrails: guardrails || {},
        scope: cacheScope,
        forceRefresh,
      });
      scored = aiResult.opportunities;
      aiSummary = aiResult.ai_summary;
      aiSource = aiResult.ai_source;
    }

    const payload = {
      opportunities: scored,
      byVariantId: new Map(scored.map(row => [normalizeVariantGid(row.variant_id), row])),
      generated_at: snapshot.generated_at,
      source: 'catalog',
      cache_scope: cacheScope,
      ai_summary: aiSummary,
      ai_source: aiSource,
      eligible_count: scored.length,
      catalog_product_count: snapshot.catalog_product_count,
      sku_count: snapshot.sku_count,
      order_metrics_variant_count: snapshot.order_metrics_variant_count,
      measured_view_sku_count: snapshot.measured_view_sku_count,
      catalog_view_metrics_available: snapshot.catalog_view_metrics_available,
      imported_cogs_sku_count: snapshot.imported_cogs_sku_count,
      collection_view_metrics_available: snapshot.collection_view_metrics_available,
      collection_views_30d: snapshot.collection_views_30d,
      traffic_cross_check: snapshot.traffic_cross_check,
      shop_conversion_rate: snapshot.shop_conversion_rate,
      guardrails: snapshot.guardrails || guardrails || null,
      focus_collection_ids: snapshot.focus_collection_ids || focusCollectionIds || [],
      product_search: snapshot.product_search || productSearch || null,
      warnings: [],
    };

    if (scored.length === 0) {
      payload.warnings.push(
        'No eligible products found yet. Add active products with prices, or adjust collection/search filters.'
      );
    }

    setCacheEntry(normalizedShop, payload, cacheScope);
    await writeOpportunityCache(normalizedShop, payload, cacheScope).catch(err => {
      logger.warn('Smart pricing opportunity persist failed', {
        shopDomain: normalizedShop,
        error: err.message,
      });
    });
    return payload;
  } catch (error) {
    logger.error('Smart pricing opportunities failed', {
      shopDomain: normalizedShop,
      error: error.message,
    });
    return buildCatalogUnavailablePayload({
      shopDomain: normalizedShop,
      reason: `Could not load catalog metrics (${error.message}).`,
      code: 'catalog_fetch_failed',
      cacheScope,
    });
  }
}

async function listOpportunities({
  shopDomain = '',
  accessToken = '',
  filter = 'all',
  search = '',
  collectionId = '',
  productSearch = '',
  forceRefresh = false,
  useDemo = false,
} = {}) {
  if (useDemo) {
    return listDemoOpportunities({ filter, search });
  }

  const catalogPayload = await loadCatalogOpportunities(shopDomain, accessToken, {
    forceRefresh,
    collectionId,
    productSearch,
  });
  const opportunities = applyFilters(catalogPayload.opportunities || [], { filter, search });
  return buildListPayload(opportunities, {
    generated_at: catalogPayload.generated_at,
    source: catalogPayload.source,
    cache_scope: catalogPayload.cache_scope,
    ai_summary: catalogPayload.ai_summary,
    ai_source: catalogPayload.ai_source,
    eligible_count: catalogPayload.eligible_count,
    catalog_product_count: catalogPayload.catalog_product_count,
    sku_count: catalogPayload.sku_count,
    order_metrics_variant_count: catalogPayload.order_metrics_variant_count,
    shop_conversion_rate: catalogPayload.shop_conversion_rate,
    guardrails: catalogPayload.guardrails,
    focus_collection_ids: catalogPayload.focus_collection_ids,
    product_search: catalogPayload.product_search,
    connection: catalogPayload.connection || null,
    warnings: catalogPayload.warnings,
  });
}

async function getOpportunityByVariantId(variantId, { shopDomain = '', accessToken = '' } = {}) {
  const id = normalizeVariantGid(variantId);
  if (!id) {
    return null;
  }

  if (!shopDomain) {
    return null;
  }

  const catalogPayload = await loadCatalogOpportunities(shopDomain, accessToken);
  if (catalogPayload.source === 'catalog_unavailable') {
    return null;
  }
  return catalogPayload.byVariantId?.get(id) || null;
}

function clearOpportunityCache(shopDomain) {
  if (shopDomain) {
    const prefix = `${normalizeShopDomain(shopDomain)}::`;
    for (const key of opportunityCache.keys()) {
      if (key.startsWith(prefix)) {
        opportunityCache.delete(key);
      }
    }
    clearPersistentOpportunityCache(shopDomain).catch(() => null);
    return;
  }
  opportunityCache.clear();
}

module.exports = {
  DEMO_OPPORTUNITIES,
  listOpportunities,
  getOpportunityByVariantId,
  loadCatalogOpportunities,
  clearOpportunityCache,
  listDemoOpportunities,
  buildCatalogUnavailablePayload,
  buildDefaultSelectedVariantIds,
};
