jest.mock('../smartPricingAiProvider', () => ({
  hasOpenAiKey: jest.fn(() => false),
  chatJson: jest.fn(async () => null),
}));

const { hasOpenAiKey, chatJson } = require('../smartPricingAiProvider');
const {
  suggestHypothesis,
  suggestPrices,
  suggestAudienceAdvanced,
  deterministicPriceSuggestions,
} = require('../smartPricingAiSuggestService');

describe('smartPricingAiSuggestService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    hasOpenAiKey.mockReturnValue(false);
  });

  it('returns deterministic hypothesis without OpenAI', async () => {
    const result = await suggestHypothesis({
      name: 'Hoodie lift',
      experimentType: 'price_test',
      variants: [{ variant_id: 'v1', title: 'Hoodie', current_price: 59 }],
    });
    expect(result.source).toBe('deterministic');
    expect(result.hypothesis).toMatch(/Hoodie/);
  });

  it('builds guardrail-clamped price suggestions for each test arm', () => {
    const result = deterministicPriceSuggestions({
      variants: [
        {
          variant_id: 'gid://shopify/ProductVariant/1',
          title: 'Tee',
          current_price: 20,
          margin_percent: 55,
        },
      ],
      arms: [{ id: 'var_b' }, { id: 'var_c' }],
      guardrails: { min_margin_percent: 35, max_price_change_percent: 20 },
      minPct: 10,
      maxPct: 20,
    });
    expect(result.suggestions).toHaveLength(2);
    result.suggestions.forEach(row => {
      expect(row.price).toBeGreaterThan(20);
      expect(row.delta_percent).toBeGreaterThanOrEqual(10);
      expect(row.delta_percent).toBeLessThanOrEqual(20);
    });
  });

  it('uses OpenAI hypothesis when chatJson returns content', async () => {
    hasOpenAiKey.mockReturnValue(true);
    chatJson.mockResolvedValue({
      hypothesis: 'If we raise price modestly, profit per visitor rises because value holds.',
      rationale: 'Margin headroom',
    });
    const result = await suggestHypothesis({
      name: 'Test',
      variants: [{ variant_id: 'v1', title: 'Mug', current_price: 12 }],
    });
    expect(result.source).toBe('openai');
    expect(result.hypothesis).toMatch(/profit per visitor/i);
  });

  it('suggestPrices falls back when OpenAI returns empty', async () => {
    hasOpenAiKey.mockReturnValue(true);
    chatJson.mockResolvedValue({ suggestions: [] });
    const result = await suggestPrices({
      variants: [
        {
          variant_id: 'gid://shopify/ProductVariant/1',
          title: 'Tee',
          current_price: 20,
          margin_percent: 50,
        },
      ],
      arms: [{ id: 'var_b' }],
      minPct: 10,
      maxPct: 15,
    });
    expect(result.source).toBe('deterministic');
    expect(result.suggestions.length).toBe(1);
  });

  it('suggestPrices resolves shortened arm ids from the model', async () => {
    hasOpenAiKey.mockReturnValue(true);
    chatJson.mockResolvedValue({
      summary: 'Lift tee price modestly.',
      suggestions: [
        {
          variant_id: 'gid://shopify/ProductVariant/1',
          arm_id: 'b',
          delta_percent: 12,
          reason: 'Healthy margin',
        },
      ],
    });
    const result = await suggestPrices({
      variants: [
        {
          variant_id: 'gid://shopify/ProductVariant/1',
          title: 'Tee',
          current_price: 20,
          margin_percent: 50,
        },
      ],
      arms: [{ id: 'var_b', label: 'Variation A' }],
      minPct: 10,
      maxPct: 15,
      guardrails: { min_margin_percent: 35, max_price_change_percent: 20 },
    });
    expect(result.source).toBe('openai');
    expect(result.suggestions[0].arm_id).toBe('var_b');
    expect(result.suggestions[0].price).toBeGreaterThan(20);
  });

  it('suggestAudienceAdvanced returns openai audience when available', async () => {
    hasOpenAiKey.mockReturnValue(true);
    chatJson.mockResolvedValue({
      segment: 'new_visitors',
      traffic_allocation: 40,
      primary_metric: 'paid_conversion_rate',
      devices: ['Mobile'],
      sources: ['Paid ads'],
      countries: ['us', 'ca'],
      device_mode: 'include',
      source_mode: 'include',
      country_mode: 'include',
      min_sample_size: 4000,
      rationale: 'New visitors convert more on mobile ads',
    });
    const result = await suggestAudienceAdvanced({
      plans: [{ title: 'Tee', current_price: 20 }],
      guardrails: { min_sample_size_per_variation: 5000 },
    });
    expect(result.source).toBe('openai');
    expect(result.audience.segment).toBe('new_visitors');
    expect(result.audience.trafficAllocation).toBe(40);
    expect(result.audience.primaryMetric).toBe('conversion_rate');
    expect(result.audience.countries).toEqual(['US', 'CA']);
    expect(result.audience.deviceMode).toBe('include');
    expect(result.audience.segments.customer).toBe('new');
    expect(result.audience.segments.device).toBe('mobile');
    expect(result.audience.segments.traffic_source_rules).toEqual([
      { type: 'include', value: 'paid' },
    ]);
    expect(result.audience.segments.traffic_ramp_percent).toBe(40);
    expect(result.audience.segments.countries).toEqual(['US', 'CA']);
  });

  it('suggestAudienceAdvanced deterministic maps include targeting', async () => {
    hasOpenAiKey.mockReturnValue(false);
    const result = await suggestAudienceAdvanced({
      plans: [{ title: 'Tee', current_price: 20, margin_percent: 55 }],
      guardrails: {
        objective: 'profit_per_visitor',
        min_sample_size_per_variation: 5000,
      },
      catalogHints: { top_countries: ['gb'], typical_traffic_share: 60 },
    });
    expect(result.source).toBe('deterministic');
    expect(result.audience.primaryMetric).toBe('revenue_per_visitor');
    expect(result.audience.trafficAllocation).toBe(60);
    expect(result.audience.segments.traffic_ramp_percent).toBe(60);
    expect(result.audience.segments.countries).toEqual(['GB']);
    expect(result.audience.segments.device).toBe('all');
  });
});
