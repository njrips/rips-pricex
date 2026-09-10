jest.mock('../smartPricingAiProvider', () => ({
  hasOpenAiKey: jest.fn(() => false),
  chatJson: jest.fn(async () => null),
}));

const { hasOpenAiKey, chatJson } = require('../smartPricingAiProvider');
const {
  suggestPrices,
  deterministicPriceSuggestions,
} = require('../smartPricingAiSuggestService');

describe('smartPricingAiSuggestService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    hasOpenAiKey.mockReturnValue(false);
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

  it('does not let the merchant band widen past shop max price change', () => {
    const result = deterministicPriceSuggestions({
      variants: [{ variant_id: 'v1', title: 'Tee', current_price: 40, margin_percent: 55 }],
      arms: [{ id: 'var_b' }],
      guardrails: { min_margin_percent: 35, max_price_change_percent: 15 },
      minPct: 10,
      maxPct: 25,
    });
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].delta_percent).toBeLessThanOrEqual(15);
    expect(result.suggestions[0].price).toBeLessThanOrEqual(46.01);
    expect(result.summary).toMatch(/capped by your 15% max price change guardrail/i);
  });

  it('never exceeds the requested max for a high-opportunity product', () => {
    const result = deterministicPriceSuggestions({
      variants: [
        {
          variant_id: 'v1',
          title: 'Tee',
          current_price: 40,
          margin_percent: 80,
          opportunity_score: 0.95,
        },
      ],
      arms: [{ id: 'var_b' }, { id: 'var_c' }, { id: 'var_d' }, { id: 'var_e' }, { id: 'var_f' }],
      guardrails: { min_margin_percent: 35, max_price_change_percent: 30 },
      minPct: 10,
      maxPct: 20,
    });
    result.suggestions.forEach(row => {
      expect(row.delta_percent).toBeLessThanOrEqual(20);
      expect(row.delta_percent).toBeGreaterThanOrEqual(10);
    });
  });

  it('spans the full requested band so variations are far enough apart', () => {
    const result = deterministicPriceSuggestions({
      variants: [{ variant_id: 'v1', title: 'Tee', current_price: 100, margin_percent: 80 }],
      arms: [{ id: 'var_b' }, { id: 'var_c' }, { id: 'var_d' }],
      guardrails: { min_margin_percent: 35, max_price_change_percent: 30 },
      minPct: 10,
      maxPct: 20,
    });
    expect(result.suggestions.map(row => row.delta_percent)).toEqual([10, 15, 20]);
  });

  it('places a single test arm in the middle of the band', () => {
    const result = deterministicPriceSuggestions({
      variants: [{ variant_id: 'v1', title: 'Tee', current_price: 100, margin_percent: 80 }],
      arms: [{ id: 'var_b' }],
      guardrails: { min_margin_percent: 35, max_price_change_percent: 30 },
      minPct: 10,
      maxPct: 20,
    });
    expect(result.suggestions[0].delta_percent).toBe(15);
  });

  it('marks suggestions the guardrail forced below the requested minimum', () => {
    const result = deterministicPriceSuggestions({
      variants: [{ variant_id: 'v1', title: 'Tee', current_price: 40, margin_percent: 80 }],
      arms: [{ id: 'var_b' }],
      guardrails: { min_margin_percent: 35, max_price_change_percent: 15 },
      minPct: 20,
      maxPct: 30,
    });
    expect(result.suggestions[0].delta_percent).toBeLessThanOrEqual(15);
    expect(result.suggestions[0].guardrail_limited).toBe(true);
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

  it('suggestPrices maps a reply addressed by row position onto the real ids', async () => {
    hasOpenAiKey.mockReturnValue(true);
    chatJson.mockResolvedValue({
      summary: 'Lift tee price modestly.',
      prices: [{ v: 0, deltas: [12] }],
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
    expect(result.suggestions[0].variant_id).toBe('gid://shopify/ProductVariant/1');
    expect(result.suggestions[0].arm_id).toBe('var_b');
    expect(result.suggestions[0].price).toBeGreaterThan(20);
    expect(result.fallback_pair_count).toBe(0);
  });

  it('suggestPrices asks for enough output tokens to answer the whole request', async () => {
    hasOpenAiKey.mockReturnValue(true);
    chatJson.mockResolvedValue({ prices: [{ v: 0, deltas: [10, 15, 20] }] });
    const variants = Array.from({ length: 30 }, (_, i) => ({
      variant_id: `gid://shopify/ProductVariant/${i}`,
      title: `Product ${i}`,
      current_price: 20 + i,
      margin_percent: 55,
    }));
    await suggestPrices({
      variants,
      arms: [{ id: 'var_a' }, { id: 'var_b' }, { id: 'var_c' }],
      minPct: 10,
      maxPct: 20,
    });
    // A fixed ceiling used to cut the reply in half for a request this size.
    const { maxTokens } = chatJson.mock.calls[0][0];
    expect(maxTokens).toBeGreaterThan(900);
  });

  it('suggestPrices says how many prices the model did not return', async () => {
    hasOpenAiKey.mockReturnValue(true);
    chatJson.mockResolvedValue({
      summary: 'Raised the tee.',
      prices: [{ v: 0, deltas: [12] }],
    });
    const result = await suggestPrices({
      variants: [
        { variant_id: 'v1', title: 'Tee', current_price: 20, margin_percent: 50 },
        { variant_id: 'v2', title: 'Mug', current_price: 30, margin_percent: 50 },
      ],
      arms: [{ id: 'var_b' }],
      minPct: 10,
      maxPct: 15,
    });
    expect(result.ai_pair_count).toBe(1);
    expect(result.fallback_pair_count).toBe(1);
    expect(result.summary).toContain('spread');
    expect(result.suggestions).toHaveLength(2);
  });

  it('suggestPrices ignores a row position it never sent', async () => {
    hasOpenAiKey.mockReturnValue(true);
    chatJson.mockResolvedValue({ prices: [{ v: 7, deltas: [12] }] });
    const result = await suggestPrices({
      variants: [{ variant_id: 'v1', title: 'Tee', current_price: 20, margin_percent: 50 }],
      arms: [{ id: 'var_b' }],
      minPct: 10,
      maxPct: 15,
    });
    expect(result.source).toBe('deterministic');
    expect(result.ai_attempted).toBe(true);
  });

  it('suggestPrices skips the model when the caller asks it to, and says why', async () => {
    hasOpenAiKey.mockReturnValue(true);
    const result = await suggestPrices({
      variants: [{ variant_id: 'v1', title: 'Tee', current_price: 20, margin_percent: 50 }],
      arms: [{ id: 'var_b' }],
      minPct: 10,
      maxPct: 15,
      useAi: false,
    });
    expect(chatJson).not.toHaveBeenCalled();
    expect(result.source).toBe('deterministic');
    expect(result.ai_skipped_reason).toBe('disabled_by_request');
  });

  it('suggestPrices records that a dollar band never reaches the model', async () => {
    hasOpenAiKey.mockReturnValue(true);
    const result = await suggestPrices({
      variants: [{ variant_id: 'v1', title: 'Tee', current_price: 20, margin_percent: 50 }],
      arms: [{ id: 'var_b' }],
      unit: 'amount',
      minAmount: 4,
      maxAmount: 8,
    });
    expect(chatJson).not.toHaveBeenCalled();
    expect(result.ai_skipped_reason).toBe('amount_band');
  });

  it('suggestPrices never sends a shop identifier or a field the model cannot use', async () => {
    hasOpenAiKey.mockReturnValue(true);
    chatJson.mockResolvedValue({ prices: [{ v: 0, deltas: [12] }] });
    await suggestPrices({
      variants: [
        {
          variant_id: 'gid://shopify/ProductVariant/1',
          title: 'Tee',
          current_price: 20,
          margin_percent: 50,
          revenue_30d: 4200,
        },
      ],
      arms: [{ id: 'var_b' }],
      minPct: 10,
      maxPct: 15,
    });
    const { userPrompt } = chatJson.mock.calls[0][0];
    expect(userPrompt).not.toContain('gid://shopify');
    expect(userPrompt).not.toContain('4200');
    expect(userPrompt).not.toContain('myshopify');
  });
});
