const { createSalesWindowAccumulator, salesWindowOrderQuery } = require('../orderSalesWindows');

const NOW = Date.parse('2026-10-26T12:00:00Z');
const daysAgo = n => new Date(NOW - n * 86400000).toISOString();
const money = amount => ({ shopMoney: { amount: String(amount) } });

function line({
  variant = 'gid://shopify/ProductVariant/1',
  quantity = 1,
  kept,
  list = 20,
  paid = 20,
} = {}) {
  return {
    node: {
      quantity,
      currentQuantity: kept === undefined ? quantity : kept,
      variant: variant ? { id: variant } : null,
      product: { id: 'gid://shopify/Product/9' },
      originalTotalSet: money(list * quantity),
      discountedUnitPriceAfterAllDiscountsSet: money(paid),
    },
  };
}

function order(createdAt, lines, extra = {}) {
  return {
    createdAt,
    cancelledAt: null,
    test: false,
    lineItems: { edges: lines },
    ...extra,
  };
}

describe('sales in rolling 30-day windows', () => {
  it('splits sales into the last 30 days and the 30 before, per variant and for the store', () => {
    const acc = createSalesWindowAccumulator({ now: NOW });
    acc.addOrder(order(daysAgo(2), [line({ quantity: 2 })]));
    acc.addOrder(
      order(daysAgo(29.9), [line({ variant: 'gid://shopify/ProductVariant/2', paid: 10 })])
    );
    acc.addOrder(order(daysAgo(30.1), [line({ quantity: 3 })]));
    acc.addOrder(order(daysAgo(61), [line({ quantity: 50 })]));
    const { variants, store, coverage } = acc.finish({ exhausted: true });

    expect(variants.get('gid://shopify/ProductVariant/1')).toMatchObject({
      units_30d: 2,
      units_60d: 5,
      net_units_30d: 2,
      net_units_previous_30d: 3,
      net_revenue_30d: 40,
      net_revenue_previous_30d: 60,
      last_order_at: daysAgo(2),
    });
    expect(store).toEqual({
      orders_30d: 2,
      orders_previous_30d: 1,
      net_units_30d: 3,
      net_units_previous_30d: 3,
      net_revenue_30d: 50,
      net_revenue_previous_30d: 60,
    });
    expect(coverage).toMatchObject({
      current_window_complete: true,
      previous_window_complete: true,
      truncated: false,
    });
  });

  it('nets refunds and every discount out of what the store kept, but keeps gross as before', () => {
    const acc = createSalesWindowAccumulator({ now: NOW });
    acc.addOrder(order(daysAgo(1), [line({ quantity: 3, kept: 1, list: 25, paid: 18 })]));
    const row = acc.finish({ exhausted: true }).variants.get('gid://shopify/ProductVariant/1');

    expect(row).toMatchObject({
      units_30d: 3,
      revenue_30d: 75,
      net_units_30d: 1,
      net_revenue_30d: 18,
    });
  });

  it('counts neither cancelled nor test orders', () => {
    const acc = createSalesWindowAccumulator({ now: NOW });
    acc.addOrder(order(daysAgo(1), [line()], { cancelledAt: daysAgo(0.5) }));
    acc.addOrder(order(daysAgo(1), [line()], { test: true }));
    const result = acc.finish({ exhausted: true });

    expect(result.variants.size).toBe(0);
    expect(result.store.orders_30d).toBe(0);
    expect(result.coverage.orders_excluded).toBe(2);
  });

  it('counts a line with no variant toward the store only', () => {
    const acc = createSalesWindowAccumulator({ now: NOW });
    acc.addOrder(order(daysAgo(1), [line({ variant: null, paid: 12 })]));
    const result = acc.finish({ exhausted: true });

    expect(result.variants.size).toBe(0);
    expect(result.store.net_revenue_30d).toBe(12);
  });

  it('calls a window complete only when a capped read reached back past its start', () => {
    const inside = createSalesWindowAccumulator({ now: NOW });
    inside.addOrder(order(daysAgo(10), [line()]));
    expect(inside.finish({ exhausted: false }).coverage).toMatchObject({
      current_window_complete: false,
      previous_window_complete: false,
      complete_since: daysAgo(10),
      truncated: true,
    });

    const between = createSalesWindowAccumulator({ now: NOW });
    between.addOrder(order(daysAgo(45), [line()]));
    expect(between.finish({ exhausted: false }).coverage).toMatchObject({
      current_window_complete: true,
      previous_window_complete: false,
    });
  });

  it('treats a shop with no orders at all as fully read', () => {
    const { coverage, store } = createSalesWindowAccumulator({
      now: NOW,
    }).finish({ exhausted: true });
    expect(coverage.current_window_complete).toBe(true);
    expect(coverage.previous_window_complete).toBe(true);
    expect(store.net_units_30d).toBe(0);
  });

  it('asks Shopify for orders reaching a day past the older window', () => {
    expect(salesWindowOrderQuery(NOW)).toBe('created_at:>=2026-08-26');
  });
});
