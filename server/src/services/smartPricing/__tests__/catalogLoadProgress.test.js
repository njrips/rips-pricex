const {
  createCatalogProgress,
  readCatalogProgress,
  resetCatalogProgress,
} = require('../catalogLoadProgress');
jest.mock('../../shopifyService', () => ({
  fetchSmartPricingCatalog: jest.fn(),
  countSmartPricingCatalogProducts: jest.fn(),
}));
const shopifyService = require('../../shopifyService');
const { fetchCatalogProducts } = require('../catalogMetricsService');

const SHOP = 'demo.myshopify.com';
const ID = 'load-1234abcd';

describe('catalog load progress', () => {
  beforeEach(() => resetCatalogProgress());

  it('reports what a load has got through', () => {
    const progress = createCatalogProgress(ID, SHOP);
    progress.update({ stage: 'catalog', loaded: 100, total: 299 });
    expect(readCatalogProgress(ID, SHOP)).toEqual({ stage: 'catalog', loaded: 100, total: 299, done: false });
    progress.finish();
    expect(readCatalogProgress(ID, SHOP)).toMatchObject({ stage: 'done', done: true });
  });

  it('answers only the shop that started the load', () => {
    createCatalogProgress(ID, SHOP).update({ loaded: 5 });
    expect(readCatalogProgress(ID, 'other.myshopify.com')).toBeNull();
  });

  it('ignores a missing or malformed id without failing the load', () => {
    const progress = createCatalogProgress('../etc', SHOP);
    expect(() => progress.update({ loaded: 1 })).not.toThrow();
    expect(readCatalogProgress('../etc', SHOP)).toBeNull();
    expect(readCatalogProgress('', SHOP)).toBeNull();
  });
});

describe('reading the catalog with progress', () => {
  afterEach(() => jest.clearAllMocks());

  function fakeCatalog(pages) {
    return shopifyService.fetchSmartPricingCatalog.mockImplementation(async (_s, _t, opts) => {
      let loaded = 0;
      const products = [];
      pages.forEach(size => {
        for (let i = 0; i < size; i += 1) products.push({ id: `gid://shopify/Product/${loaded + i}`, variants: [] });
        loaded += size;
        opts.onPage?.(loaded);
      });
      return { products, currency: 'USD', truncated: false };
    });
  }

  it('counts products as each page arrives, against Shopify’s total', async () => {
    fakeCatalog([100, 100, 99]);
    shopifyService.countSmartPricingCatalogProducts.mockResolvedValue({ count: 299, exact: true });
    const updates = [];
    const progress = { update: patch => updates.push(patch), setStage() {}, finish() {} };

    await fetchCatalogProducts(SHOP, 'token', { progress });
    await new Promise(resolve => setImmediate(resolve));

    expect(updates.map(u => u.loaded).filter(n => n !== undefined)).toEqual([0, 100, 200, 299]);
    expect(updates.some(u => u.total === 299)).toBe(true);
  });

  it('leaves the total unknown when several overlapping queries are read', async () => {
    fakeCatalog([10]);
    const count = shopifyService.countSmartPricingCatalogProducts;
    const progress = { update() {}, setStage() {}, finish() {} };

    await fetchCatalogProducts(SHOP, 'token', {
      progress,
      focusCollectionIds: ['gid://shopify/Collection/1', 'gid://shopify/Collection/2'],
    });

    expect(count).not.toHaveBeenCalled();
  });
});
