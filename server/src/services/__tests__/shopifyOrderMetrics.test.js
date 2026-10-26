process.env.SHOPIFY_API_KEY ||= 'test-key';
process.env.SHOPIFY_API_SECRET ||= 'test-secret';
process.env.SHOPIFY_SCOPES ||= 'read_products,read_orders';

const shopifyService = require('../shopifyService');

const recent = new Date(Date.now() - 2 * 86400000).toISOString();

function page(orders, { next = null } = {}) {
  return {
    data: {
      orders: {
        pageInfo: { hasNextPage: Boolean(next), endCursor: next },
        edges: orders.map(node => ({ node })),
      },
    },
  };
}

const order = {
  createdAt: recent,
  cancelledAt: null,
  test: false,
  lineItems: {
    edges: [
      {
        node: {
          quantity: 2,
          currentQuantity: 2,
          variant: { id: 'gid://shopify/ProductVariant/1' },
          product: { id: 'gid://shopify/Product/1' },
          originalTotalSet: { shopMoney: { amount: '40' } },
          discountedUnitPriceAfterAllDiscountsSet: { shopMoney: { amount: '18' } },
        },
      },
    ],
  },
};

describe('reading recent order sales from Shopify', () => {
  const OriginalGraphql = shopifyService.api.clients.Graphql;
  let responses;
  let calls;

  beforeEach(() => {
    calls = [];
    shopifyService.api.clients.Graphql = class {
      async request(query, { variables }) {
        calls.push(variables);
        const next = responses.shift();
        if (next instanceof Error) throw next;
        return next;
      }
    };
  });

  afterEach(() => {
    shopifyService.api.clients.Graphql = OriginalGraphql;
  });

  it('retries a page Shopify priced over its query limit with smaller pages', async () => {
    responses = [
      new Error('Query cost is 5152, which exceeds the single query max cost limit (1000).'),
      page([order]),
    ];

    const result = await shopifyService.aggregateRecentOrderMetrics('shop.myshopify.com', 'tok');

    expect(calls.map(call => call.first)).toEqual([50, 10]);
    expect(result.variants.get('gid://shopify/ProductVariant/1')).toMatchObject({
      net_units_30d: 2,
      net_revenue_30d: 36,
    });
    expect(result.coverage.current_window_complete).toBe(true);
  });

  it('fails a read that came back without orders instead of calling it a quiet month', async () => {
    responses = [{ data: {} }];

    await expect(
      shopifyService.aggregateRecentOrderMetrics('shop.myshopify.com', 'tok')
    ).rejects.toThrow(/Orders connection missing/);
  });

  it('marks the windows incomplete when the page cap stops the read', async () => {
    responses = [page([order], { next: 'c1' })];

    const result = await shopifyService.aggregateRecentOrderMetrics('shop.myshopify.com', 'tok', {
      maxPages: 1,
    });

    expect(result.coverage.truncated).toBe(true);
    expect(result.coverage.previous_window_complete).toBe(false);
  });

  it('still hands the per-variant map to older callers', async () => {
    responses = [page([order])];

    const map = await shopifyService.aggregateRecentOrderLineMetrics('shop.myshopify.com', 'tok');

    expect(map).toBeInstanceOf(Map);
    expect(map.get('gid://shopify/ProductVariant/1').units_30d).toBe(2);
  });
});
