/**
 * Smart Pricing loads part of a large catalog and used to present that part as
 * the whole thing: a shop with 400 products saw 120 and no sign the rest
 * existed. One experiment covers 250 products, so the old cap could not even
 * fill a single test from the merchant's own catalog.
 */
jest.mock('../../shopifyService', () => ({
  fetchSmartPricingCatalog: jest.fn(),
}));

const { fetchSmartPricingCatalog } = require('../../shopifyService');
const {
  fetchCatalogProducts,
  DEFAULT_MAX_CATALOG_PRODUCTS,
} = require('../catalogMetricsService');

function catalogOf(count, offset = 0) {
  return {
    currency: 'USD',
    products: Array.from({ length: count }, (_, index) => ({
      id: `gid://shopify/Product/${offset + index}`,
      title: `Product ${offset + index}`,
      variants: [],
    })),
  };
}

beforeEach(() => {
  fetchSmartPricingCatalog.mockReset();
});

describe('how much of the catalog is loaded', () => {
  it('loads enough to fill an experiment, which covers 250 products', () => {
    expect(DEFAULT_MAX_CATALOG_PRODUCTS).toBeGreaterThanOrEqual(250);
  });

  it('says so when the shop has more products than it loaded', async () => {
    fetchSmartPricingCatalog.mockResolvedValue(catalogOf(DEFAULT_MAX_CATALOG_PRODUCTS));

    const result = await fetchCatalogProducts('demo.myshopify.com', 'token');

    expect(result.products).toHaveLength(DEFAULT_MAX_CATALOG_PRODUCTS);
    expect(result.truncated).toBe(true);
  });

  it('does not claim truncation when the whole catalog fits', async () => {
    fetchSmartPricingCatalog.mockResolvedValue(catalogOf(12));

    const result = await fetchCatalogProducts('demo.myshopify.com', 'token');

    expect(result.products).toHaveLength(12);
    expect(result.truncated).toBe(false);
  });

  it('asks Shopify for the same number it is willing to keep', async () => {
    fetchSmartPricingCatalog.mockResolvedValue(catalogOf(5));

    await fetchCatalogProducts('demo.myshopify.com', 'token', { maxProducts: 40 });

    expect(fetchSmartPricingCatalog).toHaveBeenCalledWith(
      'demo.myshopify.com',
      'token',
      expect.objectContaining({ maxProducts: 40 })
    );
  });

  it('stops asking once it has enough, rather than walking every collection', async () => {
    // Focus collections are queried one at a time, and a merchant with many of
    // them should not pay for pages nobody will see.
    fetchSmartPricingCatalog.mockResolvedValue(catalogOf(10));

    await fetchCatalogProducts('demo.myshopify.com', 'token', {
      maxProducts: 10,
      focusCollectionIds: ['1', '2', '3'],
    });

    expect(fetchSmartPricingCatalog).toHaveBeenCalledTimes(1);
  });
});
