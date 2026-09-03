import { describe, expect, it } from 'vitest';
import {
  estimateDaysForSku,
  estimateSignificanceDuration,
  formatPracticalDurationRange,
  formatTestDuration,
  inferDailyVisitors,
  inferTrafficEvidence,
  slowestVariationTrafficPercent,
} from '../estimateSignificanceDuration';

describe('formatTestDuration', () => {
  it('scales the unit so low-traffic estimates stay readable', () => {
    expect(formatTestDuration(1)).toBe('1 day');
    expect(formatTestDuration(12)).toBe('12 days');
    expect(formatTestDuration(30)).toBe('4 weeks');
    expect(formatTestDuration(200)).toBe('7 months');
    expect(formatTestDuration(5000)).toBe('13 years 8 months');
    expect(formatTestDuration(75763)).toMatch(/^over \d+ years$/);
    expect(formatTestDuration(0)).toBe('');
  });

  it('uses a bounded whole-week range only for practical forecasts', () => {
    expect(formatPracticalDurationRange(30, 'measured')).toBe('4 weeks–6 weeks');
    expect(formatPracticalDurationRange(30, 'estimated')).toBe('3 weeks–8 weeks');
    expect(formatPracticalDurationRange(365, 'measured')).toBe('');
  });
});

describe('estimateSignificanceDuration', () => {
  it('infers daily visitors from SKU traffic fields', () => {
    expect(inferDailyVisitors({ daily_visitors: 40 })).toBe(40);
    expect(inferDailyVisitors({ visitors_30d: 300 })).toBe(10);
    expect(inferDailyVisitors({ units_sold_30d: 30, baseline_conversion_rate: 0.05 })).toBe(20);
    expect(inferDailyVisitors({ units_sold_30d: 30 })).toBe(0);
  });

  it('distinguishes measured traffic from sparse-store planning priors', () => {
    expect(inferTrafficEvidence({ traffic_source: 'storefront_measured' })).toBe('measured');
    expect(inferTrafficEvidence({ traffic_source: 'orders_estimated' })).toBe('modeled');
    expect(inferTrafficEvidence({ traffic_source: 'shop_prior_estimated' })).toBe('estimated');
  });

  it('scales days by traffic, sample size, and variation count', () => {
    expect(
      estimateDaysForSku({
        dailyVisitors: 100,
        trafficAllocation: 50,
        minSampleSize: 5000,
        variantCount: 2,
      })
    ).toBe(200);
    expect(
      estimateDaysForSku({
        dailyVisitors: 100,
        trafficAllocation: 100,
        minSampleSize: 5000,
        variantCount: 2,
      })
    ).toBe(100);
    expect(
      estimateDaysForSku({
        dailyVisitors: 100,
        trafficAllocation: 50,
        minSampleSize: 1000,
        variantCount: 3,
      })
    ).toBe(60);
  });

  it('uses the least-allocated variation instead of assuming an equal split', () => {
    expect(
      estimateDaysForSku({
        dailyVisitors: 100,
        trafficAllocation: 50,
        minSampleSize: 1000,
        variantCount: 3,
        slowestVariationPercent: 20,
      })
    ).toBe(100);
    expect(
      slowestVariationTrafficPercent(
        [{ traffic: 50 }, { traffic: 30 }, { traffic: 20 }],
        3
      )
    ).toBe(20);
  });

  it('uses the slowest selected SKU instead of a fixed day count', () => {
    const result = estimateSignificanceDuration({
      plans: [
        { daily_visitors: 200, statistical_design: { visitors_per_variant_required: 2000 } },
        { daily_visitors: 40, statistical_design: { visitors_per_variant_required: 2000 } },
      ],
      variations: [{ id: 'control' }, { id: 'a' }],
      trafficAllocation: 50,
      minSampleSize: 1000,
    });
    expect(result.days).toBe(200);
    expect(result.recommendedSampleSize).toBe(2000);
    expect(result.planningSampleSize).toBe(2000);
    expect(result.detail).toMatch(/40 visitors\/day/);
    expect(result.detail).toMatch(/50% experiment traffic/);
    expect(result.slowestVariationPercent).toBe(50);
  });

  it('hydrates plan traffic from catalog opportunities when plans omit visitors', () => {
    const result = estimateSignificanceDuration({
      plans: [{ variant_id: 'v1' }],
      opportunities: [{ variant_id: 'v1', daily_visitors: 80 }],
      variations: [{ id: 'control' }, { id: 'a' }],
      trafficAllocation: 50,
      minSampleSize: 2000,
    });
    expect(result.days).toBe(100);
    expect(result.detail).toMatch(/80 visitors\/day/);
  });

  it('does not promote an opportunity proxy baseline into powered planning', () => {
    const result = estimateSignificanceDuration({
      plans: [{ variant_id: 'v1' }],
      opportunities: [
        {
          variant_id: 'v1',
          daily_visitors: 80,
          baseline_conversion_rate: 0.02,
          baseline_source: 'assumed_shop_cvr',
          traffic_source: 'shop_prior_estimated',
          traffic_confidence: 'estimated',
        },
      ],
      variations: [{ id: 'control', traffic: 50 }, { id: 'a', traffic: 50 }],
      trafficAllocation: 100,
      minSampleSize: 2000,
    });

    expect(result.recommendedSampleSize).toBeNull();
    expect(result.planningSampleSize).toBe(2000);
    expect(result.powerRating).toBe('insufficient_data');
    expect(result.trafficEvidence).toBe('estimated');
    expect(result.detail).toMatch(/qualified conversion baseline/i);
  });

  it('returns no day count when there is no traffic data', () => {
    const result = estimateSignificanceDuration({
      plans: [],
      opportunities: [],
      variations: [{ id: 'control' }, { id: 'a' }],
      trafficAllocation: 50,
      minSampleSize: 5000,
    });
    expect(result.days).toBeNull();
    expect(result.detail).toMatch(/timeline is unavailable/i);
  });

  it('does not hide a selected product with missing traffic', () => {
    const result = estimateSignificanceDuration({
      plans: [
        { variant_id: 'known', daily_visitors: 100 },
        { variant_id: 'unknown' },
      ],
      variations: [{ id: 'control', traffic: 50 }, { id: 'a', traffic: 50 }],
      trafficAllocation: 50,
      minSampleSize: 5000,
    });
    expect(result.days).toBeNull();
    expect(result.detail).toMatch(/one or more selected products lack visitor data/i);
  });

  it('rejects a zero-traffic variation as impossible to complete', () => {
    const result = estimateSignificanceDuration({
      plans: [{ variant_id: 'v1', daily_visitors: 100 }],
      variations: [{ id: 'control', traffic: 100 }, { id: 'a', traffic: 0 }],
      trafficAllocation: 50,
      minSampleSize: 5000,
    });
    expect(result.days).toBeNull();
    expect(result.detail).toMatch(/variation has 0% traffic/i);
  });

  it('plans from a real baseline conversion rate when it exceeds the merchant floor', () => {
    const result = estimateSignificanceDuration({
      plans: [{ daily_visitors: 200, baseline_conversion_rate: 0.05 }],
      variations: [{ id: 'control' }, { id: 'a' }],
      trafficAllocation: 50,
      minSampleSize: 500,
    });
    expect(result.recommendedSampleSize).toBeGreaterThan(500);
    expect(result.planningSampleSize).toBe(result.recommendedSampleSize);
    expect(result.powerRating).toBe('underpowered');
    expect(result.days).toBeGreaterThan(result.earliestDays);
    expect(result.detail).toMatch(/10% relative conversion lift/);
  });

  it('leads with the merchant floor and the lift that floor can resolve', () => {
    const result = estimateSignificanceDuration({
      plans: [{ daily_visitors: 8, baseline_conversion_rate: 0.0245 }],
      variations: [{ id: 'control' }, { id: 'a' }, { id: 'b' }, { id: 'c' }],
      trafficAllocation: 50,
      minSampleSize: 5000,
    });
    // The chosen floor must be quoted as the merchant typed it, not silently
    // replaced by the far larger powered sample.
    expect(result.detail).toMatch(/5,000-visitor minimum/);
    expect(result.detectableLiftAtFloorPercent).toBeGreaterThan(10);
    expect(result.detail).toMatch(/fixed-horizon conversion-rate sensitivity/);
    // No raw five-digit day counts in the copy.
    expect(result.detail).not.toMatch(/\d{4,} days/);
  });

  it('does not present century-scale sparse-store scenarios as duration forecasts', () => {
    const result = estimateSignificanceDuration({
      plans: [
        {
          daily_visitors: 8,
          traffic_source: 'shop_prior_estimated',
          traffic_confidence: 'estimated',
        },
      ],
      variations: [{ id: 'control', traffic: 50 }, { id: 'a', traffic: 50 }],
      trafficAllocation: 50,
      minSampleSize: 5000,
    });

    expect(result.durationFeasibility).toBe('not_feasible');
    expect(result.practicalDurationRange).toBe('');
    expect(result.trafficEvidence).toBe('estimated');
    expect(result.requiredDailyVisitorsForPracticalWindow).toBeGreaterThan(300);
    expect(result.detail).toMatch(/cannot be reached inside a practical/i);
    expect(result.detail).toMatch(/planning prior—not an AI promise/i);
    expect(result.detail).toMatch(/needs about .+ eligible visitors\/day/i);
    expect(result.detail).not.toMatch(/years?/i);
  });

  it('says the floor is already sufficient when it exceeds the powered sample', () => {
    const result = estimateSignificanceDuration({
      plans: [{ daily_visitors: 20000, baseline_conversion_rate: 0.05 }],
      variations: [{ id: 'control' }, { id: 'a' }],
      trafficAllocation: 100,
      minSampleSize: 60000,
    });
    expect(result.recommendedSampleSize).toBeLessThan(60000);
    expect(result.detail).toMatch(/meets the fixed-horizon planning reference/);
  });

  it('times the earliest call from the conversion floor when that binds', () => {
    // 100 conversions at a 1% baseline needs 10,000 visitors/variation, so a
    // 5,000-visitor floor would promise a call the gate will not make.
    const withFloor = estimateSignificanceDuration({
      plans: [{ daily_visitors: 4000, baseline_conversion_rate: 0.01 }],
      variations: [{ id: 'control', traffic: 50 }, { id: 'a', traffic: 50 }],
      trafficAllocation: 100,
      minSampleSize: 5000,
      minConversionsPerVariation: 100,
    });
    const visitorsOnly = estimateSignificanceDuration({
      plans: [{ daily_visitors: 4000, baseline_conversion_rate: 0.01 }],
      variations: [{ id: 'control', traffic: 50 }, { id: 'a', traffic: 50 }],
      trafficAllocation: 100,
      minSampleSize: 5000,
    });
    expect(withFloor.earliestCallSampleSize).toBe(10000);
    expect(withFloor.floorLimitedBy).toBe('conversions');
    expect(withFloor.earliestDays).toBeGreaterThan(visitorsOnly.earliestDays);
    expect(withFloor.detail).toMatch(/100-conversion minimum per variation/);
    expect(withFloor.detail).toMatch(/about 10,000 visitors\/variation/);
  });

  it('keeps quoting the visitor floor when it already yields the conversions', () => {
    const result = estimateSignificanceDuration({
      plans: [{ daily_visitors: 4000, baseline_conversion_rate: 0.05 }],
      variations: [{ id: 'control', traffic: 50 }, { id: 'a', traffic: 50 }],
      trafficAllocation: 100,
      minSampleSize: 5000,
      minConversionsPerVariation: 100,
    });
    expect(result.earliestCallSampleSize).toBe(5000);
    expect(result.floorLimitedBy).toBe('visitors');
    expect(result.detail).toMatch(/5,000-visitor minimum per variation/);
  });

  it('uses shop confidence and target lift when provided', () => {
    const at90 = estimateSignificanceDuration({
      plans: [{ daily_visitors: 200, baseline_conversion_rate: 0.05 }],
      variations: [{ id: 'control' }, { id: 'a' }],
      trafficAllocation: 50,
      minSampleSize: 500,
      mdePercent: 10,
      confidenceLevel: 90,
    });
    const at95 = estimateSignificanceDuration({
      plans: [{ daily_visitors: 200, baseline_conversion_rate: 0.05 }],
      variations: [{ id: 'control' }, { id: 'a' }],
      trafficAllocation: 50,
      minSampleSize: 500,
      mdePercent: 8,
      confidenceLevel: 95,
    });
    expect(at95.recommendedSampleSize).toBeGreaterThan(at90.recommendedSampleSize);
    expect(at95.detail).toMatch(/8% relative conversion lift/);
    expect(at95.detail).toMatch(/95% family-wise confidence/);
  });

  it('keeps per-SKU planning estimates for launch persistence', () => {
    const result = estimateSignificanceDuration({
      plans: [
        { variant_id: 'v1', daily_visitors: 200, baseline_conversion_rate: 0.02 },
        { variant_id: 'v2', daily_visitors: 200, baseline_conversion_rate: 0.08 },
      ],
      variations: [{ id: 'control', traffic: 50 }, { id: 'a', traffic: 50 }],
      trafficAllocation: 100,
      minSampleSize: 500,
    });
    expect(result.perSkuEstimates).toHaveLength(2);
    expect(result.perSkuEstimates.map(row => row.key)).toEqual(['v1', 'v2']);
    expect(result.perSkuEstimates[0].recommendedSampleSize).not.toBe(
      result.perSkuEstimates[1].recommendedSampleSize
    );
    expect(result.perSkuEstimates.every(row => row.durationFeasibility)).toBe(true);
  });
});
