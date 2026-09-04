const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  computeVisitorsPerVariant,
  buildVariantCountOptions,
  buildStatisticalDesign,
  resolveSampleSizePolicy,
} = require('../statisticalDesignService');

describe('statisticalDesignService', () => {
  it('computes positive visitors per variant for valid inputs', () => {
    const n = computeVisitorsPerVariant({
      baselineConversionRate: 0.02,
      mdePercent: 10,
      confidenceLevel: 90,
      power: 80,
    });
    assert.equal(n, 63552);
  });

  it('Bonferroni-adjusts the planning reference for multiple challengers', () => {
    const oneChallenger = computeVisitorsPerVariant({
      baselineConversionRate: 0.02,
      mdePercent: 10,
      confidenceLevel: 90,
      power: 80,
      comparisonCount: 1,
    });
    const threeChallengers = computeVisitorsPerVariant({
      baselineConversionRate: 0.02,
      mdePercent: 10,
      confidenceLevel: 90,
      power: 80,
      comparisonCount: 3,
    });
    assert.equal(threeChallengers, 90652);
    assert.ok(threeChallengers > oneChallenger);
  });

  it('marks higher variant counts as underpowered at low traffic', () => {
    const options = buildVariantCountOptions({
      dailyVisitors: 50,
      baselineConversionRate: 0.02,
      mdePercent: 8,
      targetDays: 14,
    });
    assert.equal(options.length, 3);
    const fourVariant = options.find(o => o.count === 4);
    assert.equal(fourVariant.power_rating, 'underpowered');
    assert.equal(fourVariant.timeline_rating, 'underpowered');
    assert.equal(options.some(o => o.recommended), true);
  });

  it('builds statistical design aligned with selected variant count', () => {
    const design = buildStatisticalDesign({
      variantCount: 3,
      dailyVisitors: 140,
      baselineConversionRate: 0.024,
      baselinePpv: 1.84,
      mdePercent: 6.5,
    });
    assert.equal(design.primary_metric, 'conversion_rate');
    assert.equal(design.planning_method, 'fixed_horizon_two_proportion');
    // No decisionMetric was passed, so this is the default. It is revenue per
    // visitor: profit is only revenue scaled by an assumed cost percentage, so
    // it cannot be the metric a design falls back to.
    assert.equal(design.decision_metric, 'revenue_per_visitor');
    assert.equal(design.analysis_method, 'sequential');
    assert.equal(design.total_visitors_required, design.visitors_per_variant_required * 3);
    assert.ok(design.estimated_duration_days > 0);
    assert.ok(['practical', 'not_feasible'].includes(design.duration_feasibility));
    assert.equal(design.practical_window_max_days, 56);
  });

  it('keeps the merchant floor when no baseline exists and does not invent 2% CVR', () => {
    const policy = resolveSampleSizePolicy({ merchantMin: 2000, baselineConversionRate: null });
    assert.equal(policy.merchantMin, 2000);
    assert.equal(policy.recommendedPerVariant, null);
    assert.equal(policy.planningPerVariant, 2000);
    assert.equal(policy.powerRating, 'adequate');
  });

  it('recommends power N from a real baseline and marks an undersized floor', () => {
    const policy = resolveSampleSizePolicy({
      merchantMin: 500,
      baselineConversionRate: 0.05,
      mdePercent: 10,
      confidenceLevel: 90,
      power: 80,
    });
    assert.ok(policy.recommendedPerVariant > 500);
    assert.equal(policy.planningPerVariant, policy.recommendedPerVariant);
    assert.equal(policy.powerRating, 'underpowered');
  });
});
