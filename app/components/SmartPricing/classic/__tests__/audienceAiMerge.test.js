import { describe, expect, it } from 'vitest';
import { mergeAudienceAiIntoStatePreservingSample } from '../../targeting/smartPricingAudienceHelpers';

describe('AI audience merge safety', () => {
  it('updates targeting and traffic without changing the merchant sample floor', () => {
    const result = mergeAudienceAiIntoStatePreservingSample(
      {
        segment: 'all_visitors',
        trafficAllocation: 50,
        minSampleSize: '7500',
        primaryMetric: 'revenue_per_visitor',
      },
      {
        segment: 'new_visitors',
        traffic_allocation: 80,
        min_sample_size: 1000,
        primary_metric: 'conversion_rate',
      },
      { source: 'openai' }
    );

    expect(result.segment).toBe('new_visitors');
    expect(result.trafficAllocation).toBe(80);
    expect(result.primaryMetric).toBe('conversion_rate');
    expect(result.minSampleSize).toBe('7500');
    expect(result.aiSource).toBe('openai');
  });
});
