const { scoreSkuRow, scoreSkuRows, buildFilterCounts } = require('../opportunityScoringService');

describe('opportunityScoringService', () => {
  const baseRow = {
    product_id: 'gid://shopify/Product/1',
    variant_id: 'gid://shopify/ProductVariant/1',
    title: 'Test Product',
    current_price: 50,
    margin_percent: 52,
    margin_known: true,
    daily_visitors: 120,
    visitors_30d: 3600,
    units_sold_30d: 36,
    units_sold_60d: 70,
    revenue_30d: 1800,
    baseline_conversion_rate: 0.01,
    baseline_ppv: 0.26,
    has_active_price_test: false,
  };

  it('scores high-traffic high-margin SKUs highest', () => {
    const scored = scoreSkuRow(baseRow);
    expect(scored.opportunity_score).toBeGreaterThan(0.5);
    expect(scored.recommended).toBe(true);
    expect(scored.tags).toEqual(expect.arrayContaining(['high_margin', 'high_traffic']));
  });

  it('excludes variants with active price tests', () => {
    const scored = scoreSkuRows([
      baseRow,
      { ...baseRow, variant_id: 'gid://shopify/ProductVariant/2', has_active_price_test: true },
    ]);
    expect(scored).toHaveLength(1);
    expect(scored[0].variant_id).toBe('gid://shopify/ProductVariant/1');
  });

  it('flags low-data SKUs with conservative recommendation', () => {
    const scored = scoreSkuRow({
      ...baseRow,
      daily_visitors: 8,
      visitors_30d: 120,
      units_sold_30d: 2,
      units_sold_60d: 4,
      revenue_30d: 80,
    });
    expect(scored.tags).toContain('low_data');
    expect(scored.recommended).toBe(false);
    expect(scored.recommended_scenario_preset).toBe('conservative');
  });

  it('penalizes recently changed prices', () => {
    const stable = scoreSkuRow(baseRow);
    const changed = scoreSkuRow({ ...baseRow, price_changed_recently: true });
    expect(changed.opportunity_score).toBeLessThan(stable.opportunity_score);
    expect(changed.tags).toContain('price_recently_changed');
  });

  it('builds filter counts for inbox chips', () => {
    const counts = buildFilterCounts([
      { tags: ['high_margin', 'high_traffic'], recommended: true },
      { tags: ['low_data'], recommended: false },
      { tags: ['measured_traffic'], recommended: false },
    ]);
    expect(counts).toMatchObject({
      all: 3,
      high_margin: 1,
      high_traffic: 1,
      ai_pick: 1,
      low_data: 1,
      measured_traffic: 1,
    });
  });

  it('tags storefront measured traffic and prefers it in scoring', () => {
    const scored = scoreSkuRow({
      ...baseRow,
      traffic_source: 'storefront_measured',
      measured_views_30d: 450,
      visitors_30d: 450,
      units_sold_30d: 12,
      traffic_confidence: 'high',
    });
    expect(scored.tags).toContain('measured_traffic');
    expect(scored.tags).not.toContain('estimated_traffic');
    expect(scored.ai_reason).toMatch(/Live PDP views/i);
  });
});
