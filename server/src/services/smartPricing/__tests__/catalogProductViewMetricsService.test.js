const {
  loadMeasuredViewMetricsMap,
  resolveMeasuredViewsForSku,
} = require('../catalogProductViewMetricsService');

jest.mock('../../../models/catalogProductViewStore', () => ({
  fetchCatalogProductViewMetrics: jest.fn(),
}));

const { fetchCatalogProductViewMetrics } = require('../../../models/catalogProductViewStore');

describe('catalogProductViewMetricsService', () => {
  const originalEnv = process.env.SMART_PRICING_CATALOG_VIEWS;

  afterEach(() => {
    process.env.SMART_PRICING_CATALOG_VIEWS = originalEnv;
    fetchCatalogProductViewMetrics.mockReset();
  });

  it('returns empty map when catalog views are disabled', async () => {
    process.env.SMART_PRICING_CATALOG_VIEWS = 'false';
    const map = await loadMeasuredViewMetricsMap('demo.myshopify.com');
    expect(map.size).toBe(0);
    expect(fetchCatalogProductViewMetrics).not.toHaveBeenCalled();
  });

  it('prefers variant-level measured views over product totals', () => {
    const viewMetrics = new Map([
      [
        'gid://shopify/ProductVariant/10',
        { views_30d: 80, views_60d: 100, last_view_at: '2026-07-01T00:00:00.000Z' },
      ],
      [
        'gid://shopify/Product/1',
        { views_30d: 120, views_60d: 150, last_view_at: '2026-07-02T00:00:00.000Z' },
      ],
    ]);
    const resolved = resolveMeasuredViewsForSku(
      {
        product_id: 'gid://shopify/Product/1',
        variant_id: 'gid://shopify/ProductVariant/10',
      },
      viewMetrics
    );
    expect(resolved.views_30d).toBe(80);
  });

  it('falls back to product-level views when variant has no direct rollup', () => {
    const viewMetrics = new Map([
      [
        'gid://shopify/Product/1',
        { views_30d: 45, views_60d: 60, last_view_at: '2026-07-02T00:00:00.000Z' },
      ],
    ]);
    const resolved = resolveMeasuredViewsForSku(
      {
        product_id: 'gid://shopify/Product/1',
        variant_id: 'gid://shopify/ProductVariant/99',
      },
      viewMetrics
    );
    expect(resolved.views_30d).toBe(45);
  });
});
