import { describe, expect, it } from 'vitest';
import {
  computeVisitorsPerVariant,
  inferBaselineConversionRate,
  resolveSampleSizePolicy,
  shopDesignFromGuardrails,
  stampStatisticalFields,
  visitorsForConversionFloor,
} from '../sampleSizePolicy';

describe('sampleSizePolicy', () => {
  it('matches the two-proportion power formula used on the server', () => {
    const n = computeVisitorsPerVariant({
      baselineConversionRate: 0.02,
      mdePercent: 10,
      confidenceLevel: 90,
      power: 80,
    });
    expect(n).toBe(63552);
  });

  it('does not invent a 2% baseline when traffic fields are missing', () => {
    expect(inferBaselineConversionRate({})).toBeNull();
    expect(inferBaselineConversionRate({ visitors_30d: 0, units_sold_30d: 10 })).toBeNull();
  });

  it('does not treat catalog proxy rates as powered baselines', () => {
    expect(
      inferBaselineConversionRate({
        baseline_conversion_rate: 0.02,
        baseline_source: 'units_per_visitor_proxy',
      })
    ).toBeNull();
    expect(
      inferBaselineConversionRate({
        baseline_conversion_rate: 0.02,
        baseline_source: 'assumed_shop_cvr',
      })
    ).toBeNull();
  });

  it('infers conversion rate from 30-day units and visitors', () => {
    expect(inferBaselineConversionRate({ visitors_30d: 1000, units_sold_30d: 40 })).toBe(0.04);
  });

  it('keeps the merchant floor when recommended N is unknown', () => {
    const policy = resolveSampleSizePolicy({ merchantMin: 2000 });
    expect(policy.recommendedPerVariant).toBeNull();
    expect(policy.planningPerVariant).toBe(2000);
    expect(policy.powerRating).toBe('insufficient_data');
  });

  it('reads shop statistical defaults without treating confidence as alpha', () => {
    expect(shopDesignFromGuardrails({ confidence_level: 95, mde_percent: 8 })).toEqual({
      confidenceLevel: 95,
      mdePercent: 8,
      power: 80,
      significanceLevel: 0.95,
      minConversions: 100,
    });
  });

  it('reads nested API guardrails payloads', () => {
    expect(shopDesignFromGuardrails({ guardrails: { confidence_level: 95, mde_percent: 15 } })).toEqual({
      confidenceLevel: 95,
      mdePercent: 15,
      power: 80,
      significanceLevel: 0.95,
      minConversions: 100,
    });
  });

  it('does not accept a conversion floor the analysis would override', () => {
    expect(shopDesignFromGuardrails({ min_conversions_per_variation: 3 })).toMatchObject({
      minConversions: 100,
    });
    expect(shopDesignFromGuardrails({ min_conversions_per_variation: 250 })).toMatchObject({
      minConversions: 250,
    });
  });

  it('uses the configured 90% statistical power', () => {
    expect(
      shopDesignFromGuardrails({
        confidence_level: 90,
        mde_percent: 10,
        statistical_power: 90,
      })
    ).toMatchObject({ power: 90 });
  });

  it('stamps shop 95% when the plan has no statistical fields', () => {
    expect(stampStatisticalFields({}, { confidence_level: 95, mde_percent: 8 })).toEqual({
      analysis_method: 'sequential',
      mde_percent: 8,
      statistical_power: 80,
      significance_level: 0.95,
      confidence_level: 95,
    });
  });

  it('keeps batch-stamped 95% when shop guardrails have not loaded yet', () => {
    expect(
      stampStatisticalFields(
        {
          goal: { significance_level: 0.95, mde_percent: 8 },
          statistical_design: { confidence_level: 95, mde_percent: 8 },
        },
        {}
      )
    ).toMatchObject({
      significance_level: 0.95,
      confidence_level: 95,
      mde_percent: 8,
    });
  });

  it('keeps plan-stamped confidence over shop defaults', () => {
    expect(
      stampStatisticalFields(
        { goal: { significance_level: 0.9, mde_percent: 10 } },
        { confidence_level: 95, mde_percent: 8 }
      )
    ).toMatchObject({
      significance_level: 0.9,
      confidence_level: 90,
      mde_percent: 10,
    });
  });

  it('recomputes a stale stored recommendation when baseline data is available', () => {
    const policy = resolveSampleSizePolicy({
      merchantMin: 1000,
      baselineConversionRate: 0.02,
      storedRecommended: 2500,
    });
    expect(policy.recommendedPerVariant).toBe(63552);
    expect(policy.planningPerVariant).toBe(63552);
    expect(policy.recommendationSource).toBe('computed');
  });

  it('uses a stored recommendation only when no baseline exists', () => {
    const policy = resolveSampleSizePolicy({
      merchantMin: 1000,
      baselineConversionRate: null,
      storedRecommended: 2500,
    });
    expect(policy.recommendedPerVariant).toBe(2500);
    expect(policy.recommendationSource).toBe('stored');
  });

  it('raises the earliest call when the conversion floor takes longer than visitors', () => {
    // 100 conversions at a 0.5% baseline needs 20,000 visitors, so a 5,000
    // visitor floor is not what the merchant is actually waiting for.
    const policy = resolveSampleSizePolicy({
      merchantMin: 5000,
      minConversions: 100,
      baselineConversionRate: 0.005,
    });
    expect(policy.merchantMin).toBe(5000);
    expect(policy.conversionFloorVisitors).toBe(20000);
    expect(policy.earliestCallPerVariant).toBe(20000);
    expect(policy.floorLimitedBy).toBe('conversions');
  });

  it('leaves the visitor floor in charge when it already yields the conversions', () => {
    const policy = resolveSampleSizePolicy({
      merchantMin: 5000,
      minConversions: 100,
      baselineConversionRate: 0.04,
    });
    expect(policy.conversionFloorVisitors).toBe(2500);
    expect(policy.earliestCallPerVariant).toBe(5000);
    expect(policy.floorLimitedBy).toBe('visitors');
  });

  it('does not invent a conversion floor without a measured baseline', () => {
    expect(visitorsForConversionFloor(100, null)).toBeNull();
    expect(visitorsForConversionFloor(0, 0.02)).toBeNull();
    const policy = resolveSampleSizePolicy({ merchantMin: 5000, minConversions: 100 });
    expect(policy.conversionFloorVisitors).toBeNull();
    expect(policy.earliestCallPerVariant).toBe(5000);
  });

  it('never lets the conversion floor exceed the powered planning sample', () => {
    const policy = resolveSampleSizePolicy({
      merchantMin: 5000,
      minConversions: 100,
      baselineConversionRate: 0.02,
    });
    expect(policy.planningPerVariant).toBe(policy.recommendedPerVariant);
    expect(policy.earliestCallPerVariant).toBe(5000);
  });

  it('accounts for every challenger in a multi-arm test', () => {
    const twoArm = computeVisitorsPerVariant({
      baselineConversionRate: 0.02,
      mdePercent: 10,
      confidenceLevel: 90,
      power: 80,
      comparisonCount: 1,
    });
    const fourArm = computeVisitorsPerVariant({
      baselineConversionRate: 0.02,
      mdePercent: 10,
      confidenceLevel: 90,
      power: 80,
      comparisonCount: 3,
    });
    expect(fourArm).toBe(90652);
    expect(fourArm).toBeGreaterThan(twoArm);
  });
});
