process.env.SHOPIFY_API_KEY ||= 'test-key';
process.env.SHOPIFY_API_SECRET ||= 'test-secret';
process.env.SHOPIFY_SCOPES ||= 'read_products,read_inventory';

const shopifyService = require('../../shopifyService');

describe('Shopify Smart Pricing catalog fields', () => {
  it('fetches and preserves Shopify availability and inventory tracking', async () => {
    const OriginalGraphql = shopifyService.api.clients.Graphql;
    let sentQuery = '';
    shopifyService.api.clients.Graphql = class {
      async request(query) {
        sentQuery = query;
        return {
          data: {
            shop: { currencyCode: 'USD' },
            products: {
              pageInfo: { hasNextPage: false, endCursor: null },
              edges: [
                {
                  node: {
                    id: 'gid://shopify/Product/1',
                    title: 'Tee',
                    handle: 'tee',
                    status: 'ACTIVE',
                    publishedAt: null,
                    onlineStoreUrl: null,
                    productType: '',
                    tags: [],
                    featuredImage: null,
                    collections: { edges: [] },
                    variants: {
                      edges: [
                        {
                          node: {
                            id: 'gid://shopify/ProductVariant/11',
                            title: 'Default Title',
                            displayName: 'Tee',
                            sku: 'TEE',
                            price: '20.00',
                            compareAtPrice: null,
                            updatedAt: '2026-10-09T00:00:00Z',
                            inventoryQuantity: 0,
                            inventoryPolicy: 'DENY',
                            availableForSale: true,
                            inventoryItem: { tracked: false, unitCost: null },
                          },
                        },
                      ],
                    },
                  },
                },
              ],
            },
          },
        };
      }
    };

    try {
      const catalog = await shopifyService.fetchSmartPricingCatalog(
        'shop.myshopify.com',
        'token',
        { maxProducts: 10 }
      );

      expect(sentQuery).toContain('availableForSale');
      expect(sentQuery).toMatch(/inventoryItem\s*\{\s*tracked/);
      expect(catalog.products[0].variants[0]).toEqual(
        expect.objectContaining({
          availableForSale: true,
          inventoryTracked: false,
          inventoryQuantity: 0,
        })
      );
    } finally {
      shopifyService.api.clients.Graphql = OriginalGraphql;
    }
  });
});
