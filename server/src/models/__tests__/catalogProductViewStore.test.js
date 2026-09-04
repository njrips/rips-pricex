/**
 * The measured-traffic reader used to query catalog_product_view_daily_rollups
 * and catalog_collection_view_daily_rollups, which no migration ever created,
 * while the storefront tracker wrote catalog_product_view_daily and
 * catalog_product_view_sessions. Every query raised "relation does not exist",
 * the caller swallowed it, and Smart Pricing silently fell back to order-derived
 * traffic guesses for every shop.
 */

jest.mock('../../utils/database', () => ({
  query: jest.fn(),
}));

const { query } = require('../../utils/database');
const {
  fetchCatalogProductViewMetrics,
  fetchCatalogCollectionViewMetrics,
} = require('../catalogProductViewStore');

describe('catalogProductViewStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reads the tables the storefront tracker actually writes', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await fetchCatalogProductViewMetrics('Demo.myshopify.com');

    const [sql] = query.mock.calls[0];
    expect(sql).toContain('catalog_product_view_daily');
    expect(sql).toContain('catalog_product_view_sessions');
    expect(sql).not.toContain('_rollups');
    expect(sql).not.toContain('event_date');
  });

  it('keys metrics by product gid and carries unique visitors separately', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          product_id: '8899',
          views_30d: '420',
          views_60d: '900',
          visitors_30d: '180',
          visitors_60d: '360',
          last_view_at: '2026-09-01',
        },
      ],
    });

    const map = await fetchCatalogProductViewMetrics('demo.myshopify.com');

    const row = map.get('gid://shopify/Product/8899');
    expect(row).toBeTruthy();
    expect(row.views_30d).toBe(420);
    expect(row.visitors_30d).toBe(180);
    expect(row.visitors_60d).toBe(360);
    expect(row.last_view_at).toBe('2026-09-01');
  });

  it('skips products with no views in the window', async () => {
    query.mockResolvedValueOnce({
      rows: [{ product_id: '1', views_30d: '0', views_60d: '0', visitors_30d: '0' }],
    });

    const map = await fetchCatalogProductViewMetrics('demo.myshopify.com');

    expect(map.size).toBe(0);
  });

  it('returns an empty map without querying for a blank shop', async () => {
    expect((await fetchCatalogProductViewMetrics('')).size).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it('reads collection views from the table the migration creates', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await fetchCatalogCollectionViewMetrics('demo.myshopify.com', {
      collectionIds: ['gid://shopify/Collection/12'],
    });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('catalog_collection_view_daily');
    expect(sql).not.toContain('_rollups');
    expect(sql).toContain('collection_id = ANY($3::text[])');
    expect(params[2]).toEqual(['gid://shopify/Collection/12']);
  });
});
