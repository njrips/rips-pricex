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
  toProductGid,
  PRODUCT_CONTEXT_QUERY,
} = require('../smartPricingProductContextService');

function productNode(id, extra = {}) {
  return {
    id,
    description: '  Full-grain   leather. ',
    vendor: 'Atelier',
    totalInventory: 12,
    tracksInventory: true,
    featuredMedia: { preview: { image: { url: `https://cdn.shopify.com/${id.split('/').pop()}.jpg` } } },
    ...extra,
  };
}

describe('fetchProductContextForSuggest', () => {
  beforeEach(() => mockRequestAdminGraphql.mockReset());

  it('returns description, vendor, image and stock keyed by the id the caller used', async () => {
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
    });
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
