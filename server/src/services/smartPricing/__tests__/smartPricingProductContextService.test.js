const mockRequestAdminGraphql = jest.fn();

jest.mock('../../shopifyService', () => ({
  requestAdminGraphql: (...args) => mockRequestAdminGraphql(...args),
}));

jest.mock('../../../utils/logger', () => ({
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const {
  fetchProductContextForSuggest,
  fetchVariantContextForSuggest,
  fetchShopMarketForSuggest,
  __shopMarketCache,
  toProductGid,
  PRODUCT_CONTEXT_QUERY,
  VARIANT_CONTEXT_QUERY,
} = require('../smartPricingProductContextService');

function productNode(id, extra = {}) {
  return {
    id,
    description: '  Full-grain   leather. ',
    vendor: 'Atelier',
    totalInventory: 12,
    tracksInventory: true,
    featuredMedia: { preview: { image: { url: `https://cdn.shopify.com/${id.split('/').pop()}.jpg` } } },
    productType: 'Bags',
    tags: ['leather', ' handmade '],
    createdAt: '2026-01-02T10:00:00Z',
    publishedAt: '2026-01-05T10:00:00Z',
    category: { fullName: 'Apparel & Accessories > Handbags' },
    ...extra,
  };
}

describe('fetchProductContextForSuggest', () => {
  beforeEach(() => mockRequestAdminGraphql.mockReset());

  it('returns what the product is, how it looks, when it listed and its stock, keyed by the id the caller used', async () => {
    mockRequestAdminGraphql.mockResolvedValue({
      data: { nodes: [productNode('gid://shopify/Product/9')] },
    });

    const result = await fetchProductContextForSuggest({
      shopDomain: 'shop.myshopify.com',
      accessToken: 'tok',
      productIds: ['9'],
    });

    expect(mockRequestAdminGraphql.mock.calls[0][3]).toEqual({ ids: ['gid://shopify/Product/9'] });
    expect(result.get('9')).toEqual({
      description: 'Full-grain leather.',
      vendor: 'Atelier',
      image_url: 'https://cdn.shopify.com/9.jpg',
      inventory: 12,
      product_type: 'Bags',
      category: 'Apparel & Accessories > Handbags',
      tags: ['leather', 'handmade'],
      created_at: '2026-01-02T10:00:00.000Z',
      published_at: '2026-01-05T10:00:00.000Z',
    });
  });

  it('leaves an unpublished product without a listing date', async () => {
    mockRequestAdminGraphql.mockResolvedValue({
      data: { nodes: [productNode('gid://shopify/Product/3', { publishedAt: null, category: null })] },
    });
    const result = await fetchProductContextForSuggest({
      shopDomain: 'shop.myshopify.com',
      accessToken: 'tok',
      productIds: ['3'],
    });
    expect(result.get('3')).toMatchObject({ published_at: null, category: null });
  });

  it('reports untracked stock as unknown rather than zero', async () => {
    mockRequestAdminGraphql.mockResolvedValue({
      data: {
        nodes: [productNode('gid://shopify/Product/1', { tracksInventory: false, totalInventory: 0 })],
      },
    });

    const result = await fetchProductContextForSuggest({
      shopDomain: 'shop.myshopify.com',
      accessToken: 'tok',
      productIds: ['gid://shopify/Product/1'],
    });

    expect(result.get('gid://shopify/Product/1').inventory).toBeNull();
  });

  it('asks in batches of 100 and keeps the batches that answered', async () => {
    mockRequestAdminGraphql
      .mockResolvedValueOnce({ data: { nodes: [productNode('gid://shopify/Product/1')] } })
      .mockRejectedValueOnce(new Error('throttled'));

    const ids = Array.from({ length: 150 }, (_, i) => `gid://shopify/Product/${i + 1}`);
    const result = await fetchProductContextForSuggest({
      shopDomain: 'shop.myshopify.com',
      accessToken: 'tok',
      productIds: ids,
    });

    expect(mockRequestAdminGraphql).toHaveBeenCalledTimes(2);
    expect(mockRequestAdminGraphql.mock.calls[0][3].ids).toHaveLength(100);
    expect(mockRequestAdminGraphql.mock.calls[1][3].ids).toHaveLength(50);
    expect(result.size).toBe(1);
  });

  it('does nothing without a token or usable ids', async () => {
    await expect(
      fetchProductContextForSuggest({ shopDomain: 's', accessToken: '', productIds: ['1'] })
    ).resolves.toEqual(new Map());
    await expect(
      fetchProductContextForSuggest({ shopDomain: 's', accessToken: 't', productIds: ['abc'] })
    ).resolves.toEqual(new Map());
    expect(mockRequestAdminGraphql).not.toHaveBeenCalled();
  });

  it('uses featuredMedia, not the deprecated featuredImage', () => {
    expect(PRODUCT_CONTEXT_QUERY).toContain('featuredMedia');
    expect(PRODUCT_CONTEXT_QUERY).not.toContain('featuredImage');
    expect(PRODUCT_CONTEXT_QUERY).toContain('maxWidth: 1024, maxHeight: 1024');
  });

  it('normalises numeric and gid product ids', () => {
    expect(toProductGid('42')).toBe('gid://shopify/Product/42');
    expect(toProductGid('gid://shopify/Product/42')).toBe('gid://shopify/Product/42');
    expect(toProductGid('gid://shopify/ProductVariant/42')).toBeNull();
  });
});

describe('fetchVariantContextForSuggest', () => {
  beforeEach(() => mockRequestAdminGraphql.mockReset());

  function variantNode(id, extra = {}) {
    return {
      id,
      title: 'Large / Black',
      sku: 'BAG-L-BLK',
      barcode: '5012345678900',
      price: '49.00',
      compareAtPrice: '59.00',
      inventoryQuantity: 7,
      inventoryPolicy: 'DENY',
      availableForSale: true,
      selectedOptions: [
        { name: 'Size', value: 'Large' },
        { name: 'Colour', value: 'Black' },
      ],
      inventoryItem: { tracked: true },
      ...extra,
    };
  }

  it('returns identifiers, options and variant stock keyed by the id the caller used', async () => {
    mockRequestAdminGraphql.mockResolvedValue({
      data: { nodes: [variantNode('gid://shopify/ProductVariant/77')] },
    });
    const result = await fetchVariantContextForSuggest({
      shopDomain: 'shop.myshopify.com',
      accessToken: 'tok',
      variantIds: ['77'],
    });
    expect(mockRequestAdminGraphql.mock.calls[0][2]).toBe(VARIANT_CONTEXT_QUERY);
    expect(mockRequestAdminGraphql.mock.calls[0][3]).toEqual({
      ids: ['gid://shopify/ProductVariant/77'],
    });
    expect(result.get('77')).toEqual({
      variant_title: 'Large / Black',
      sku: 'BAG-L-BLK',
      barcode: '5012345678900',
      options: [
        { name: 'Size', value: 'Large' },
        { name: 'Colour', value: 'Black' },
      ],
      price: 49,
      compare_at_price: 59,
      inventory_tracked: true,
      inventory_quantity: 7,
      inventory_policy: 'DENY',
      available_for_sale: true,
    });
  });

  it('reports untracked stock as unknown and drops the placeholder option', async () => {
    mockRequestAdminGraphql.mockResolvedValue({
      data: {
        nodes: [
          variantNode('gid://shopify/ProductVariant/5', {
            inventoryItem: { tracked: false },
            inventoryQuantity: 0,
            barcode: '',
            selectedOptions: [{ name: 'Title', value: 'Default Title' }],
          }),
        ],
      },
    });
    const result = await fetchVariantContextForSuggest({
      shopDomain: 'shop.myshopify.com',
      accessToken: 'tok',
      variantIds: ['gid://shopify/ProductVariant/5'],
    });
    expect(result.get('gid://shopify/ProductVariant/5')).toMatchObject({
      inventory_tracked: false,
      inventory_quantity: null,
      barcode: null,
      options: [],
    });
  });

  it('ignores product ids and keeps batches that answered', async () => {
    mockRequestAdminGraphql
      .mockResolvedValueOnce({ data: { nodes: [variantNode('gid://shopify/ProductVariant/1')] } })
      .mockRejectedValueOnce(new Error('throttled'));
    const ids = Array.from({ length: 120 }, (_, i) => `gid://shopify/ProductVariant/${i + 1}`);
    const result = await fetchVariantContextForSuggest({
      shopDomain: 'shop.myshopify.com',
      accessToken: 'tok',
      variantIds: [...ids, 'gid://shopify/Product/9'],
    });
    expect(mockRequestAdminGraphql).toHaveBeenCalledTimes(2);
    expect(mockRequestAdminGraphql.mock.calls[0][3].ids).toHaveLength(100);
    expect(result.size).toBe(1);
  });
});

describe('fetchShopMarketForSuggest', () => {
  beforeEach(() => {
    mockRequestAdminGraphql.mockReset();
    __shopMarketCache.clear();
  });

  it('returns the shop country and timezone, and reuses the answer', async () => {
    mockRequestAdminGraphql.mockResolvedValue({
      data: { shop: { ianaTimezone: 'Europe/London', shopAddress: { countryCodeV2: 'GB' } } },
    });
    const args = { shopDomain: 'uk.myshopify.com', accessToken: 'tok' };
    await expect(fetchShopMarketForSuggest(args)).resolves.toEqual({
      country: 'GB',
      timezone: 'Europe/London',
    });
    await fetchShopMarketForSuggest(args);
    expect(mockRequestAdminGraphql).toHaveBeenCalledTimes(1);
  });

  // Production pins Admin API 2025-10, where `shopAddress` does not exist yet;
  // every lookup failed and search ran unlocalised.
  it('falls back to billingAddress on an API version without shopAddress', async () => {
    mockRequestAdminGraphql
      .mockRejectedValueOnce(new Error("Field 'shopAddress' doesn't exist on type 'Shop'"))
      .mockResolvedValueOnce({
        data: { shop: { ianaTimezone: 'Europe/Berlin', billingAddress: { countryCodeV2: 'DE' } } },
      });

    await expect(
      fetchShopMarketForSuggest({ shopDomain: 'de.myshopify.com', accessToken: 'tok' })
    ).resolves.toEqual({ country: 'DE', timezone: 'Europe/Berlin' });
    expect(mockRequestAdminGraphql.mock.calls[1][2]).toContain('billingAddress');
  });

  it('drops values that are not a country code or a zone name', async () => {
    mockRequestAdminGraphql.mockResolvedValue({
      data: { shop: { ianaTimezone: 'UTC', shopAddress: { countryCodeV2: 'Great Britain' } } },
    });
    await expect(
      fetchShopMarketForSuggest({ shopDomain: 'odd.myshopify.com', accessToken: 'tok' })
    ).resolves.toBeNull();
  });

  it('resolves to null when the lookup fails or there is no token', async () => {
    mockRequestAdminGraphql.mockRejectedValue(new Error('401'));
    await expect(
      fetchShopMarketForSuggest({ shopDomain: 'gone.myshopify.com', accessToken: 'tok' })
    ).resolves.toBeNull();
    await expect(fetchShopMarketForSuggest({ shopDomain: 'x.myshopify.com' })).resolves.toBeNull();
  });
});
