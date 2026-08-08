const {
  buildShopTrafficProfile,
  buildMeasuredTrafficMetrics,
  resolveSkuTrafficMetrics,
  resolveTrafficConfidence,
  enrichSkuRowsWithTraffic,
} = require('../catalogTrafficService');

describe('catalogTrafficService', () => {
  it('derives high confidence from solid sales volume', () => {
    expect(
      resolveTrafficConfidence({
        units30d: 20,
        visitors30d: 400,
        trafficSource: 'orders_estimated',
      })
    ).toBe('high');
  });

  it('uses order-based traffic when units sold exist', () => {
    const traffic = resolveSkuTrafficMetrics({
      units30d: 10,
      shopConversionRate: 0.05,
      shopProfile: {},
    });
    expect(traffic.traffic_source).toBe('orders_estimated');
    expect(traffic.daily_visitors).toBeGreaterThan(0);
    expect(traffic.traffic_confidence).not.toBe('estimated');
  });

  it('falls back to shop prior when a SKU has no sales', () => {
    const profile = buildShopTrafficProfile([
      { units_sold_30d: 12, daily_visitors: 40 },
      { units_sold_30d: 6, daily_visitors: 20 },
    ]);
    const traffic = resolveSkuTrafficMetrics({
      units30d: 0,
      shopConversionRate: 0.03,
      shopProfile: profile,
    });
    expect(traffic.traffic_source).toBe('shop_prior_estimated');
    expect(traffic.traffic_confidence).toBe('estimated');
    expect(traffic.daily_visitors).toBeGreaterThanOrEqual(8);
  });

  it('enriches mixed catalog rows with traffic metadata', () => {
    const enriched = enrichSkuRowsWithTraffic(
      [
        { variant_id: 'a', units_sold_30d: 15, current_price: 50 },
        { variant_id: 'b', units_sold_30d: 0, current_price: 40 },
      ],
      0.04
    );
    expect(enriched[0].traffic_source).toBe('orders_estimated');
    expect(enriched[1].traffic_source).toBe('shop_prior_estimated');
  });

  it('prefers storefront measured views over order estimates', () => {
    const traffic = resolveSkuTrafficMetrics({
      units30d: 10,
      shopConversionRate: 0.05,
      shopProfile: {},
      measuredViews: { views_30d: 300, views_60d: 420 },
    });
    expect(traffic.traffic_source).toBe('storefront_measured');
    expect(traffic.visitors_30d).toBe(300);
    expect(traffic.measured_views_30d).toBe(300);
    expect(traffic.traffic_confidence).toBe('high');
  });

  it('builds measured traffic confidence tiers from view volume', () => {
    expect(
      resolveTrafficConfidence({
        trafficSource: 'storefront_measured',
        measuredViews30d: 200,
      })
    ).toBe('high');
    expect(
      resolveTrafficConfidence({
        trafficSource: 'storefront_measured',
        measuredViews30d: 50,
      })
    ).toBe('medium');
    expect(buildMeasuredTrafficMetrics({ measuredViews: { views_30d: 0 } })).toBeNull();
  });

  it('overrides order-based traffic when view metrics are present in enrichment', () => {
    const viewMetrics = new Map([
      [
        'gid://shopify/ProductVariant/2',
        { views_30d: 180, views_60d: 220, last_view_at: '2026-07-01T00:00:00.000Z' },
      ],
    ]);
    const enriched = enrichSkuRowsWithTraffic(
      [
        {
          product_id: 'gid://shopify/Product/1',
          variant_id: 'gid://shopify/ProductVariant/2',
          units_sold_30d: 5,
        },
      ],
      0.04,
      viewMetrics
    );
    expect(enriched[0].traffic_source).toBe('storefront_measured');
    expect(enriched[0].measured_views_30d).toBe(180);
  });
});
