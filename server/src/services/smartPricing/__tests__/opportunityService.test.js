jest.mock('../catalogMetricsService', () => ({
  buildCatalogMetricsSnapshot: jest.fn(),
}));

jest.mock('../smartPricingOpportunityStore', () => ({
  readOpportunityCache: jest.fn().mockResolvedValue(null),
  writeOpportunityCache: jest.fn().mockResolvedValue(undefined),
  clearOpportunityCache: jest.fn().mockResolvedValue(undefined),
  buildCacheScope: jest.fn(({ collectionId = '', productSearch = '' } = {}) => {
    const collection = String(collectionId || '').trim() || 'all';
    const search = String(productSearch || '')
      .trim()
      .toLowerCase();
    return search ? `${collection}:${search}` : collection;
  }),
}));

jest.mock('../smartPricingAiRankingService', () => ({
  enrichOpportunitiesWithAiRanking: jest.fn(async ({ opportunities }) => ({
    opportunities,
    ai_summary: null,
    ai_source: 'deterministic',
  })),
  isAiRankingEnabled: jest.fn(() => false),
}));

jest.mock('../../../models/shopSession', () => ({
  getShopSession: jest.fn().mockResolvedValue({ access_token: 'token' }),
}));

jest.mock('../smartPricingGuardrailsService', () => ({
  getShopSmartPricingGuardrails: jest.fn().mockResolvedValue({
    default_cogs_percent: 55,
    min_margin_percent: 35,
    max_price_change_percent: 15,
    max_parallel_tests: 5,
    ai_ranking_enabled: true,
    focus_collection_ids: [],
  }),
}));

const { buildCatalogMetricsSnapshot } = require('../catalogMetricsService');
const {
  listOpportunities,
  getOpportunityByVariantId,
  clearOpportunityCache,
} = require('../opportunityService');

describe('opportunityService', () => {
  beforeEach(() => {
    clearOpportunityCache();
    buildCatalogMetricsSnapshot.mockReset();
  });

  it('returns ranked catalog opportunities with default selection', async () => {
    buildCatalogMetricsSnapshot.mockResolvedValue({
      generated_at: '2026-07-01T00:00:00.000Z',
      catalog_product_count: 2,
      sku_count: 2,
      order_metrics_variant_count: 1,
      sku_rows: [
        {
          product_id: 'gid://shopify/Product/1',
          variant_id: 'gid://shopify/ProductVariant/11',
          title: 'Hoodie — M',
          sku: 'HD-M',
          current_price: 59,
          currency: 'USD',
          margin_percent: 55,
          margin_known: true,
          daily_visitors: 120,
          visitors_30d: 3600,
          units_sold_30d: 36,
          units_sold_60d: 70,
          revenue_30d: 2100,
          baseline_conversion_rate: 0.01,
          baseline_ppv: 0.32,
          has_active_price_test: false,
        },
        {
          product_id: 'gid://shopify/Product/2',
          variant_id: 'gid://shopify/ProductVariant/22',
          title: 'Tee — L',
          sku: 'TE-L',
          current_price: 34,
          currency: 'USD',
          margin_percent: 48,
          margin_known: true,
          daily_visitors: 90,
          visitors_30d: 2700,
          units_sold_30d: 24,
          units_sold_60d: 40,
          revenue_30d: 816,
          baseline_conversion_rate: 0.009,
          baseline_ppv: 0.15,
          has_active_price_test: false,
        },
      ],
    });

    const result = await listOpportunities({
      shopDomain: 'demo.myshopify.com',
      accessToken: 'token',
    });

    expect(result.source).toBe('catalog');
    expect(result.opportunities.length).toBeGreaterThan(0);
    expect(result.default_selected_variant_ids.length).toBeLessThanOrEqual(3);
    expect(result.opportunities[0].opportunity_score).toBeGreaterThanOrEqual(
      result.opportunities[1].opportunity_score
    );
  });

  it('filters by ai_pick', async () => {
    buildCatalogMetricsSnapshot.mockResolvedValue({
      generated_at: '2026-07-01T00:00:00.000Z',
      catalog_product_count: 1,
      sku_count: 1,
      order_metrics_variant_count: 1,
      sku_rows: [
        {
          product_id: 'gid://shopify/Product/1',
          variant_id: 'gid://shopify/ProductVariant/11',
          title: 'Hoodie — M',
          current_price: 59,
          currency: 'USD',
          margin_percent: 55,
          margin_known: true,
          daily_visitors: 120,
          visitors_30d: 3600,
          units_sold_30d: 36,
          units_sold_60d: 70,
          revenue_30d: 2100,
          baseline_conversion_rate: 0.01,
          baseline_ppv: 0.32,
          has_active_price_test: false,
        },
      ],
    });

    const result = await listOpportunities({
      shopDomain: 'demo.myshopify.com',
      accessToken: 'token',
      filter: 'ai_pick',
    });
    expect(result.opportunities.every(row => row.recommended)).toBe(true);
  });

  it('finds opportunity by variant id from catalog cache', async () => {
    buildCatalogMetricsSnapshot.mockResolvedValue({
      generated_at: '2026-07-01T00:00:00.000Z',
      catalog_product_count: 1,
      sku_count: 1,
      order_metrics_variant_count: 1,
      sku_rows: [
        {
          product_id: 'gid://shopify/Product/1',
          variant_id: 'gid://shopify/ProductVariant/11',
          title: 'Hoodie — M',
          current_price: 59,
          currency: 'USD',
          margin_percent: 55,
          margin_known: true,
          daily_visitors: 120,
          visitors_30d: 3600,
          units_sold_30d: 36,
          units_sold_60d: 70,
          revenue_30d: 2100,
          baseline_conversion_rate: 0.01,
          baseline_ppv: 0.32,
          has_active_price_test: false,
        },
      ],
    });

    await listOpportunities({ shopDomain: 'demo.myshopify.com', accessToken: 'token' });
    const row = await getOpportunityByVariantId('gid://shopify/ProductVariant/11', {
      shopDomain: 'demo.myshopify.com',
      accessToken: 'token',
    });
    expect(row?.title).toContain('Hoodie');
  });

  it('falls back to demo data when requested', async () => {
    const result = await listOpportunities({ useDemo: true });
    expect(result.source).toBe('demo');
    expect(result.opportunities.length).toBeGreaterThan(0);
  });

  it('returns catalog_unavailable instead of demo when token is missing', async () => {
    const { getShopSession } = require('../../../models/shopSession');
    getShopSession.mockResolvedValueOnce(null);
    const previousToken = process.env.SHOPIFY_ACCESS_TOKEN;
    delete process.env.SHOPIFY_ACCESS_TOKEN;
    const result = await listOpportunities({
      shopDomain: 'demo.myshopify.com',
      accessToken: '',
    });
    if (previousToken) {
      process.env.SHOPIFY_ACCESS_TOKEN = previousToken;
    }
    expect(result.source).toBe('catalog_unavailable');
    expect(result.opportunities).toEqual([]);
    expect(result.connection?.code).toBe('shopify_token_missing');
  });

  it('returns catalog_unavailable when catalog metrics fail', async () => {
    buildCatalogMetricsSnapshot.mockRejectedValueOnce(new Error('GraphQL denied'));
    const result = await listOpportunities({
      shopDomain: 'demo.myshopify.com',
      accessToken: 'token',
    });
    expect(result.source).toBe('catalog_unavailable');
    expect(result.opportunities).toEqual([]);
  });

  it('selects top scored variants when none are recommended', async () => {
    buildCatalogMetricsSnapshot.mockResolvedValue({
      generated_at: '2026-07-01T00:00:00.000Z',
      catalog_product_count: 2,
      sku_count: 2,
      order_metrics_variant_count: 0,
      sku_rows: [
        {
          product_id: 'gid://shopify/Product/1',
          variant_id: 'gid://shopify/ProductVariant/11',
          title: 'Hoodie — M',
          current_price: 59,
          currency: 'USD',
          margin_percent: 55,
          margin_known: true,
          daily_visitors: 20,
          visitors_30d: 600,
          units_sold_30d: 0,
          units_sold_60d: 0,
          revenue_30d: 0,
          baseline_conversion_rate: 0.01,
          baseline_ppv: 0.32,
          has_active_price_test: false,
          traffic_source: 'shop_prior_estimated',
          traffic_confidence: 'estimated',
        },
        {
          product_id: 'gid://shopify/Product/2',
          variant_id: 'gid://shopify/ProductVariant/22',
          title: 'Tee — L',
          current_price: 34,
          currency: 'USD',
          margin_percent: 48,
          margin_known: true,
          daily_visitors: 10,
          visitors_30d: 300,
          units_sold_30d: 0,
          units_sold_60d: 0,
          revenue_30d: 0,
          baseline_conversion_rate: 0.009,
          baseline_ppv: 0.15,
          has_active_price_test: false,
          traffic_source: 'shop_prior_estimated',
          traffic_confidence: 'estimated',
        },
      ],
    });

    const result = await listOpportunities({
      shopDomain: 'demo.myshopify.com',
      accessToken: 'token',
    });
    expect(result.source).toBe('catalog');
    expect(result.default_selected_variant_ids.length).toBeGreaterThan(0);
    expect(result.summary.recommended_pick_count).toBe(0);
  });
});
