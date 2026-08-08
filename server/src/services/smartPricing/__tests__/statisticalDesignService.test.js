const {
  computeVisitorsPerVariant,
  buildVariantCountOptions,
  buildStatisticalDesign,
} = require('../statisticalDesignService');

describe('statisticalDesignService', () => {
  it('computes positive visitors per variant for valid inputs', () => {
    const n = computeVisitorsPerVariant({
      baselineConversionRate: 0.02,
      mdePercent: 10,
      confidenceLevel: 90,
      power: 80,
    });
    expect(n).toBeGreaterThan(0);
  });

  it('marks higher variant counts as underpowered at low traffic', () => {
    const options = buildVariantCountOptions({
      dailyVisitors: 50,
      baselineConversionRate: 0.02,
      mdePercent: 8,
      targetDays: 14,
    });
    expect(options).toHaveLength(3);
    const fourVariant = options.find(o => o.count === 4);
    expect(fourVariant.power_rating).toBe('underpowered');
    expect(options.some(o => o.recommended)).toBe(true);
  });

  it('builds statistical design aligned with selected variant count', () => {
    const design = buildStatisticalDesign({
      variantCount: 3,
      dailyVisitors: 140,
      baselineConversionRate: 0.024,
      baselinePpv: 1.84,
      mdePercent: 6.5,
    });
    expect(design.primary_metric).toBe('profit_per_visitor');
    expect(design.total_visitors_required).toBe(design.visitors_per_variant_required * 3);
    expect(design.estimated_duration_days).toBeGreaterThan(0);
  });
});
