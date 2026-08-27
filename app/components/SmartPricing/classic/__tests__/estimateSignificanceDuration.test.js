import { describe, expect, it } from 'vitest';
import {
  estimateDaysForSku,
  estimateSignificanceDuration,
  inferDailyVisitors,
} from '../estimateSignificanceDuration';

describe('estimateSignificanceDuration', () => {
  it('infers daily visitors from SKU traffic fields', () => {
    expect(inferDailyVisitors({ daily_visitors: 40 })).toBe(40);
    expect(inferDailyVisitors({ visitors_30d: 300 })).toBe(10);
    expect(inferDailyVisitors({ units_sold_30d: 30, baseline_conversion_rate: 0.05 })).toBe(20);
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
    expect(result.detail).toMatch(/40 visitors\/day/);
    expect(result.detail).toMatch(/50% traffic/);
    expect(result.detail).toMatch(/2 variations/);
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

  it('returns no day count when there is no traffic data', () => {
    const result = estimateSignificanceDuration({
      plans: [],
      opportunities: [],
      variations: [{ id: 'control' }, { id: 'a' }],
      trafficAllocation: 50,
      minSampleSize: 5000,
    });
    expect(result.days).toBeNull();
    expect(result.detail).toMatch(/not enough product traffic/i);
  });
});
