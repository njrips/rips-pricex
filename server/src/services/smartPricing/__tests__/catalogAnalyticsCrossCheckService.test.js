const {
  buildTrafficCrossCheck,
  enrichSkuRowsWithTrafficCrossCheck,
  summarizeTrafficCrossChecks,
} = require('../catalogAnalyticsCrossCheckService');

describe('catalogAnalyticsCrossCheckService', () => {
  it('flags high drift between measured views and order estimates', () => {
    const check = buildTrafficCrossCheck({
      measured_views_30d: 400,
      visitors_30d: 120,
      units_sold_30d: 6,
      traffic_source: 'storefront_measured',
    });
    expect(check.drift_level).toBe('high_drift');
  });

  it('enriches rows with traffic_cross_check and tag', () => {
    const enriched = enrichSkuRowsWithTrafficCrossCheck([
      {
        variant_id: 'gid://shopify/ProductVariant/1',
        measured_views_30d: 500,
        visitors_30d: 100,
        traffic_source: 'storefront_measured',
        tags: [],
      },
    ]);
    expect(enriched[0].traffic_cross_check.drift_level).toBe('high_drift');
    expect(enriched[0].tags).toContain('traffic_drift');
  });

  it('summarizes cross-check counts', () => {
    const summary = summarizeTrafficCrossChecks([
      { traffic_cross_check: { drift_level: 'high_drift' } },
      { traffic_cross_check: { drift_level: 'aligned' } },
    ]);
    expect(summary).toMatchObject({
      compared_sku_count: 2,
      high_drift_count: 1,
    });
  });
});
