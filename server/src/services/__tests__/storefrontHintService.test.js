jest.mock('../../models/shopSession', () => ({
  getShopSession: jest.fn(async () => ({ access_token: 'token' })),
}));
jest.mock('../shopifyService', () => ({
  requestAdminGraphql: jest.fn(),
}));

const shopifyService = require('../shopifyService');
const {
  buildStorefrontHint,
  noteServedStorefrontConfig,
  resetStorefrontHintStateForTests,
  syncStorefrontHint,
} = require('../storefrontHintService');

const SHOP = 'hint-shop.myshopify.com';
const INSTALLATION = 'gid://shopify/AppInstallation/1';

function priceTest(overrides = {}) {
  return { id: 't1', type: 'price', targetType: 'product', targetIds: [], ...overrides };
}

function mockAdmin(existingValue = null) {
  shopifyService.requestAdminGraphql.mockImplementation(async (shop, token, query) => {
    if (query.includes('currentAppInstallation')) {
      return {
        data: {
          currentAppInstallation: {
            id: INSTALLATION,
            hint: existingValue === null ? null : { value: existingValue },
          },
        },
      };
    }
    return { data: { metafieldsSet: { metafields: [{ id: 'm1' }], userErrors: [] } } };
  });
}

const writes = () =>
  shopifyService.requestAdminGraphql.mock.calls.filter(([, , query]) =>
    query.includes('metafieldsSet')
  );

beforeEach(() => {
  resetStorefrontHintStateForTests();
  shopifyService.requestAdminGraphql.mockReset();
});

describe('buildStorefrontHint', () => {
  it('has no price section when no price test runs', () => {
    const hint = buildStorefrontHint(
      [{ id: 'o1', type: 'offer', targetType: 'all-products' }],
      {},
      'https://api.example.com/path'
    );
    expect(hint).toEqual({ v: 1, api_origin: 'https://api.example.com', price: null });
  });

  it('lists targeted products and collections as numeric ids', () => {
    const hint = buildStorefrontHint([
      priceTest({ targetIds: ['gid://shopify/Product/22', '11'] }),
      priceTest({
        id: 't2',
        targetType: 'collection',
        targetIds: ['gid://shopify/Collection/5'],
        antiFlickerTimeoutMs: 1800,
      }),
    ]);
    expect(hint.price).toMatchObject({
      all_products: false,
      product_ids: ['11', '22'],
      collection_ids: ['5'],
      timeout_ms: 1800,
    });
    expect(hint.price.selectors.length).toBeGreaterThan(0);
  });

  it('treats a test without target ids as covering every product', () => {
    const hint = buildStorefrontHint([priceTest({ targetIds: null })]);
    expect(hint.price.all_products).toBe(true);
    expect(hint.price.product_ids).toEqual([]);
  });

  it('only excludes products every all-products test excludes', () => {
    const hint = buildStorefrontHint([
      priceTest({ targetType: 'all-products', excludedProductIds: ['1', '2'] }),
      priceTest({ id: 't2', targetType: 'all-products', excludedProductIds: ['2', '3'] }),
    ]);
    expect(hint.price.excluded_product_ids).toEqual(['2']);
  });

  it('switches to all products past the id limit', () => {
    const ids = Array.from({ length: 300 }, (_, index) => String(index + 1));
    const hint = buildStorefrontHint([priceTest({ targetIds: ids })]);
    expect(hint.price.all_products).toBe(true);
    expect(hint.price.product_ids).toEqual([]);
  });

  it('drops a non-https api origin', () => {
    expect(buildStorefrontHint([], {}, 'http://localhost:3456').api_origin).toBeNull();
  });
});

describe('syncStorefrontHint', () => {
  const hint = buildStorefrontHint([priceTest({ targetIds: ['7'] })], {}, 'https://api.example.com');

  it('writes the hint to the app installation once', async () => {
    mockAdmin();
    await expect(syncStorefrontHint(SHOP, hint)).resolves.toBe('written');
    await expect(syncStorefrontHint(SHOP, hint)).resolves.toBe('unchanged');
    expect(writes()).toHaveLength(1);
    const [metafield] = writes()[0][3].metafields;
    expect(metafield).toMatchObject({
      ownerId: INSTALLATION,
      namespace: 'priceify',
      key: 'storefront_hint',
      type: 'json',
    });
    expect(JSON.parse(metafield.value)).toEqual(hint);
  });

  it('skips the write when Shopify already has the same hint', async () => {
    mockAdmin(JSON.stringify(hint));
    await expect(syncStorefrontHint(SHOP, hint)).resolves.toBe('unchanged');
    expect(writes()).toHaveLength(0);
  });

  it('backs off after a failed write instead of retrying on every page view', async () => {
    shopifyService.requestAdminGraphql.mockRejectedValue(new Error('throttled'));
    await expect(syncStorefrontHint(SHOP, hint)).resolves.toBe('failed');
    await expect(syncStorefrontHint(SHOP, hint)).resolves.toBe('backoff');
    expect(shopifyService.requestAdminGraphql).toHaveBeenCalledTimes(1);
  });

  it('reports user errors as a failure', async () => {
    mockAdmin();
    shopifyService.requestAdminGraphql.mockImplementationOnce(async () => ({
      data: { currentAppInstallation: { id: INSTALLATION, hint: null } },
    }));
    shopifyService.requestAdminGraphql.mockImplementationOnce(async () => ({
      data: { metafieldsSet: { metafields: [], userErrors: [{ message: 'bad value' }] } },
    }));
    await expect(syncStorefrontHint(SHOP, hint)).resolves.toBe('failed');
  });
});

describe('noteServedStorefrontConfig', () => {
  it('writes only when the served tests change the hint', async () => {
    mockAdmin();
    const config = {
      apiUrl: 'https://api.example.com',
      activeTests: [priceTest({ targetIds: ['7'] })],
      priceSurfaceRegistry: { shopMappings: [] },
    };
    noteServedStorefrontConfig(SHOP, config);
    await new Promise(resolve => setImmediate(resolve));
    noteServedStorefrontConfig(SHOP, config);
    await new Promise(resolve => setImmediate(resolve));
    expect(writes()).toHaveLength(1);

    noteServedStorefrontConfig(SHOP, { ...config, activeTests: [priceTest({ targetIds: ['8'] })] });
    await new Promise(resolve => setImmediate(resolve));
    expect(writes()).toHaveLength(2);
  });
});
