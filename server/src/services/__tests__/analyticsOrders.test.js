jest.mock('../../models/analytics', () => ({
  getTestAnalytics: jest.fn(),
  getSecondaryEventMetrics: jest.fn(async () => ({})),
  getEventCollectionStats: jest.fn(async () => ({})),
  getCheckoutEventBreakdown: jest.fn(async () => []),
}));
jest.mock('../../models/test', () => ({ getTestById: jest.fn() }));

const { getTestAnalytics } = require('../../models/analytics');
const { getTestById } = require('../../models/test');
const analyticsService = require('../analytics');

describe('secondary metrics counted as storefront events', () => {
  it('skips the standard metrics, which come from orders', () => {
    const names = analyticsService._getSecondaryEventNames({
      secondary: [
        { event_name: 'conversion_rate', source: 'builtin' },
        { event_name: 'aov', source: 'catalog' },
        { event_name: 'add_to_cart', source: 'catalog' },
      ],
    });
    expect(names).toEqual(['add_to_cart']);
  });
});

describe('orders and buyers in test analytics', () => {
  beforeEach(() => {
    getTestById.mockResolvedValue({
      id: 't1',
      type: 'price',
      goal: { cogs: { enabled: true, type: 'fixed_per_order', value: 10 } },
      variants: [{ id: 'control' }, { id: 'b' }],
    });
  });

  it('averages order value over orders and charges per-order cost on each order', async () => {
    getTestAnalytics.mockResolvedValue([
      { variant_id: 'control', variant_name: 'Control', visitors: 100, conversions: 4, orders: 5, revenue: 500 },
      { variant_id: 'b', variant_name: 'B', visitors: 100, conversions: 3, orders: 3, revenue: 330 },
    ]);

    const result = await analyticsService.getTestAnalytics('t1', 'demo.myshopify.com');
    const control = result.variants.find(v => v.id === 'control');

    expect(control.conversions).toBe(4);
    expect(control.conversionRate).toBe(4);
    expect(control.orders).toBe(5);
    expect(control.avgOrderValue).toBe(100);
    expect(control.profit).toBe(450);
    expect(result.summary.totalOrders).toBe(8);
  });

  it("averages the tested product's own revenue over the orders that recorded it", async () => {
    getTestAnalytics.mockResolvedValue([
      { variant_id: 'control', variant_name: 'Control', visitors: 100, conversions: 4, orders: 4, revenue: 400, tested_orders: 2, tested_revenue: 90 },
      { variant_id: 'b', variant_name: 'B', visitors: 100, conversions: 2, orders: 2, revenue: 200, tested_orders: 0, tested_revenue: null },
    ]);

    const result = await analyticsService.getTestAnalytics('t1', 'demo.myshopify.com');
    expect(result.variants.map(v => [v.testedOrders, v.avgTestedRevenue])).toEqual([
      [2, 45],
      [0, null],
    ]);
  });

  it('treats each buyer as one order when the count of orders is missing', async () => {
    getTestAnalytics.mockResolvedValue([
      { variant_id: 'control', variant_name: 'Control', visitors: 100, conversions: 4, revenue: 400 },
      { variant_id: 'b', variant_name: 'B', visitors: 100, conversions: 2, revenue: 200 },
    ]);

    const result = await analyticsService.getTestAnalytics('t1', 'demo.myshopify.com');
    const control = result.variants.find(v => v.id === 'control');
    expect(control.orders).toBe(4);
    expect(control.avgOrderValue).toBe(100);
  });
});
