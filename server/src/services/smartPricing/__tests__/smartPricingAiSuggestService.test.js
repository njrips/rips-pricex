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

  describe('pricing one variation of several', () => {
    const request = {
      variants: [{ variant_id: 'v1', title: 'Tee', current_price: 40, margin_percent: 55 }],
      arms: [{ id: 'var_a' }, { id: 'var_b' }],
      guardrails: { min_margin_percent: 35, max_price_change_percent: 20 },
      minPct: 10,
      maxPct: 20,
    };

    it('returns only the target arm, at the slot it holds among all of them', async () => {
      const both = await suggestPrices(request);
      const onlyA = await suggestPrices({ ...request, targetArmIds: ['var_a'] });
      const onlyB = await suggestPrices({ ...request, targetArmIds: ['var_b'] });

      expect(onlyA.suggestions.map(s => s.arm_id)).toEqual(['var_a']);
      expect(onlyB.suggestions.map(s => s.arm_id)).toEqual(['var_b']);
      const priceOf = arm => both.suggestions.find(s => s.arm_id === arm).price;
      expect(onlyA.suggestions[0].price).toBe(priceOf('var_a'));
      expect(onlyB.suggestions[0].price).toBe(priceOf('var_b'));
      // The same band, suggested one variation at a time, still tests two prices.
      expect(onlyA.suggestions[0].price).not.toBe(onlyB.suggestions[0].price);
    });

    it('counts what it returns, not what it spread', async () => {
      const onlyA = await suggestPrices({ ...request, targetArmIds: ['var_a'] });
      expect(onlyA.summary).toMatch(/^Suggested 1 test prices/);
    });

    it('rewrites the AI summary for the arm it returns', async () => {
      hasOpenAiKey.mockReturnValue(true);
      chatJson.mockResolvedValue({
        summary: 'Variation A sits low and Variation B sits high.',
        bands: [{ v: 0, lo: 10, hi: 20 }],
      });
      const onlyB = await suggestPrices({ ...request, targetArmIds: ['var_b'] });
      expect(onlyB.source).toBe('openai');
      expect(onlyB.suggestions.map(s => s.arm_id)).toEqual(['var_b']);
      expect(onlyB.summary).not.toMatch(/Variation A/);
      expect(onlyB.ai_pair_count).toBe(1);
    });

    it('leaves a request without target arms as it was', async () => {
      const result = await suggestPrices(request);
      expect(result.suggestions).toHaveLength(2);
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
    // Rounded to prices a merchant would have chosen, which moves each arm by
    // a cent or so from the exact 10/15/20 the band maths produced.
    const deltas = result.suggestions.map(row => row.delta_percent);
    expect(Math.min(...deltas)).toBeGreaterThanOrEqual(10);
    expect(Math.max(...deltas)).toBeLessThanOrEqual(20);
    // Still spanning the band: rounding must not bunch the variations up.
    expect(Math.max(...deltas) - Math.min(...deltas)).toBeGreaterThan(5);
  });

  it('places a single test arm in the middle of the band', () => {
    const result = deterministicPriceSuggestions({
      variants: [{ variant_id: 'v1', title: 'Tee', current_price: 100, margin_percent: 80 }],
      arms: [{ id: 'var_b' }],
      guardrails: { min_margin_percent: 35, max_price_change_percent: 30 },
      minPct: 10,
      maxPct: 20,
    });
    expect(result.suggestions[0].delta_percent).toBeGreaterThanOrEqual(10);
    expect(result.suggestions[0].delta_percent).toBeLessThanOrEqual(20);
    expect(result.suggestions[0].price).toBeGreaterThan(100);
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
      bands: [{ v: 0, lo: 10, hi: 15 }],
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

  describe("the model's best price", () => {
    const tee = {
      variants: [{ variant_id: 'v1', title: 'Tee', current_price: 40, margin_percent: 60 }],
      minPct: 10,
      maxPct: 20,
      guardrails: { min_margin_percent: 35, max_price_change_percent: 20 },
    };

    beforeEach(() => hasOpenAiKey.mockReturnValue(true));

    it('puts a single variation at the price the model expects to earn most', async () => {
      chatJson.mockResolvedValue({ bands: [{ v: 0, lo: 10, hi: 20, best: 18 }] });
      const result = await suggestPrices({ ...tee, arms: [{ id: 'var_a' }] });

      expect(result.suggestions[0].ai_best_delta_percent).toBe(18);
      // The middle of the band would be +15%.
      expect(result.suggestions[0].delta_percent).toBeGreaterThan(16);
      expect(result.suggestions[0].delta_percent).toBeLessThanOrEqual(20);
    });

    it('keeps the best price inside the band', async () => {
      chatJson.mockResolvedValue({ bands: [{ v: 0, lo: 10, hi: 20, best: 45 }] });
      const result = await suggestPrices({ ...tee, arms: [{ id: 'var_a' }] });

      expect(result.suggestions[0].ai_best_delta_percent).toBe(20);
      expect(result.suggestions[0].delta_percent).toBeLessThanOrEqual(20);
    });

    it('still spreads several variations across the band', async () => {
      chatJson.mockResolvedValue({ bands: [{ v: 0, lo: 10, hi: 20, best: 18 }] });
      const result = await suggestPrices({ ...tee, arms: [{ id: 'var_a' }, { id: 'var_b' }] });

      const [a, b] = result.suggestions;
      expect(a.price).not.toBe(b.price);
      expect(a.ai_best_delta_percent).toBe(18);
    });

    it('works as before when the model gives no best price', async () => {
      chatJson.mockResolvedValue({ bands: [{ v: 0, lo: 10, hi: 20 }] });
      const result = await suggestPrices({ ...tee, arms: [{ id: 'var_a' }] });

      expect(result.suggestions[0].ai_best_delta_percent).toBeNull();
      expect(result.source).toBe('openai');
    });

    it('asks for general pricing knowledge without inventing market data', async () => {
      chatJson.mockResolvedValue({ bands: [{ v: 0, lo: 10, hi: 20, best: 15 }] });
      await suggestPrices({ ...tee, arms: [{ id: 'var_a' }] });
      const { systemPrompt } = chatJson.mock.calls[0][0];

      expect(systemPrompt).toContain('"best"');
      expect(systemPrompt).toMatch(/beyond this shop's data/i);
      expect(systemPrompt).toMatch(/Never quote or invent competitor prices/);
      expect(systemPrompt).toMatch(/measured shop data wins/);
    });
  });

  it('suggestPrices asks for enough output tokens to answer the whole request', async () => {
    hasOpenAiKey.mockReturnValue(true);
    chatJson.mockResolvedValue({ bands: [{ v: 0, lo: 10, hi: 20 }] });
    const askFor = async count => {
      chatJson.mockClear();
      await suggestPrices({
        variants: Array.from({ length: count }, (_, i) => ({
          variant_id: `gid://shopify/ProductVariant/${i}`,
          title: `Product ${i}`,
          current_price: 20 + i,
          margin_percent: 55,
        })),
        arms: [{ id: 'var_a' }, { id: 'var_b' }, { id: 'var_c' }],
        minPct: 10,
        maxPct: 20,
      });
      return chatJson.mock.calls[0][0].maxTokens;
    };

    // A fixed ceiling used to cut the reply in half for a large request: the
    // JSON came back truncated, parsed to nothing, and the merchant silently
    // got the deterministic spread while still paying for the call.
    const full = await askFor(20);
    const small = await askFor(5);

    expect(full).toBeGreaterThan(900);
    // Scales with the request rather than being one figure for every size.
    expect(full).toBeGreaterThan(small * 2);
    expect(full).toBeLessThan(4000);
  });

  it('suggestPrices says how many prices the model did not return', async () => {
    hasOpenAiKey.mockReturnValue(true);
    chatJson
      .mockResolvedValueOnce({
        summary: 'Raised the tee.',
        bands: [{ v: 0, lo: 10, hi: 15 }],
      })
      // Asked again, the mug still gets no answer.
      .mockResolvedValue({ bands: [] });
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
    expect(result.summary).toMatch(/1 product the AI did not answer/);
    expect(result.suggestions).toHaveLength(2);
  });

  /**
   * Every product the merchant selected is priced by the model.
   *
   * One call used to carry the whole selection and stop at 45 products, so a
   * merchant who picked 100 got AI prices on fewer than half and the even
   * spread on the rest.
   */
  describe('a large selection', () => {
    const answerEveryProduct = ({ userPrompt }) =>
      Promise.resolve({
        bands: JSON.parse(userPrompt).products.map(p => ({ v: p.v, lo: 10, hi: 16, best: 12 })),
      });
    const products = count =>
      Array.from({ length: count }, (_, i) => ({
        variant_id: `v${i}`,
        product_id: `p${i}`,
        title: `Product ${i}`,
        current_price: 20 + i,
        margin_percent: 55,
      }));
    const sentTitles = () =>
      chatJson.mock.calls.flatMap(([call]) => JSON.parse(call.userPrompt).products.map(p => p.title));

    beforeEach(() => hasOpenAiKey.mockReturnValue(true));

    it('sends every product to the model, in calls of at most 20', async () => {
      chatJson.mockImplementation(answerEveryProduct);
      const result = await suggestPrices({ variants: products(100), arms: [{ id: 'a' }], minPct: 10, maxPct: 20 });

      expect(chatJson).toHaveBeenCalledTimes(5);
      chatJson.mock.calls.forEach(([call]) =>
        expect(JSON.parse(call.userPrompt).products.length).toBeLessThanOrEqual(20)
      );
      expect(new Set(sentTitles()).size).toBe(100);
      expect(result.ai_product_count).toBe(100);
      expect(result.fallback_pair_count).toBe(0);
      expect(result.suggestions.every(s => s.from_ai)).toBe(true);
    });

    it('runs the calls side by side rather than one after another', async () => {
      let inFlight = 0;
      let most = 0;
      chatJson.mockImplementation(async args => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise(resolve => setTimeout(resolve, 10));
        inFlight -= 1;
        return answerEveryProduct(args);
      });
      await suggestPrices({ variants: products(60), arms: [{ id: 'a' }], minPct: 10, maxPct: 20 });

      expect(most).toBe(3);
    });

    it('asks again about products a reply left out', async () => {
      chatJson
        .mockResolvedValueOnce({ bands: [{ v: 0, lo: 10, hi: 16 }] })
        .mockImplementation(answerEveryProduct);
      const result = await suggestPrices({ variants: products(2), arms: [{ id: 'a' }], minPct: 10, maxPct: 20 });

      expect(chatJson).toHaveBeenCalledTimes(2);
      expect(JSON.parse(chatJson.mock.calls[1][0].userPrompt).products.map(p => p.title)).toEqual([
        'Product 1',
      ]);
      expect(result.fallback_pair_count).toBe(0);
    });

    it('leaves retrying to its own pass and keeps each call inside the time budget', async () => {
      chatJson.mockImplementation(answerEveryProduct);
      await suggestPrices({ variants: products(1), arms: [{ id: 'a' }], minPct: 10, maxPct: 20 });

      expect(chatJson.mock.calls[0][0].maxRetries).toBe(0);
      expect(chatJson.mock.calls[0][0].timeoutMs).toBeLessThanOrEqual(20000);
    });

    it("does not let one reply's sentence speak for products it never saw", async () => {
      chatJson.mockImplementation(async args => ({
        ...(await answerEveryProduct(args)),
        summary: 'Raise the hoodie.',
      }));
      const result = await suggestPrices({ variants: products(30), arms: [{ id: 'a' }], minPct: 10, maxPct: 20 });

      expect(result.summary).not.toContain('hoodie');
      expect(result.summary).toMatch(/for 30 products/);
    });
  });

  describe('a product with several variants', () => {
    const sizes = ['S', 'M', 'L'].map((size, i) => ({
      variant_id: `tee-${size}`,
      product_id: 'tee',
      title: 'Tee',
      current_price: 20 + i * 2,
      margin_percent: 50 + i * 5,
      units_sold_30d: 10 * (i + 1),
    }));

    beforeEach(() => hasOpenAiKey.mockReturnValue(true));

    it('is one entry for the model, standing for every variant', async () => {
      chatJson.mockResolvedValue({ bands: [{ v: 0, lo: 10, hi: 16 }] });
      await suggestPrices({ variants: sizes, arms: [{ id: 'a' }], minPct: 10, maxPct: 20 });

      const sent = JSON.parse(chatJson.mock.calls[0][0].userPrompt).products;
      expect(sent).toHaveLength(1);
      expect(sent[0].variant_count).toBe(3);
      expect(sent[0].monthly_units).toBe(60);
      expect(sent[0].current_price).toBe(22);
      expect(chatJson.mock.calls[0][0].systemPrompt).toMatch(/variant_count above 1/);
    });

    it('gives every variant the same range, priced from its own price', async () => {
      chatJson.mockResolvedValue({ bands: [{ v: 0, lo: 10, hi: 16 }] });
      const result = await suggestPrices({ variants: sizes, arms: [{ id: 'a' }], minPct: 10, maxPct: 20 });

      expect(result.suggestions).toHaveLength(3);
      expect(new Set(result.suggestions.map(s => JSON.stringify(s.ai_band))).size).toBe(1);
      result.suggestions.forEach((s, i) => expect(s.price).toBeGreaterThan(sizes[i].current_price));
      expect(result.fallback_pair_count).toBe(0);
    });

    it('never merges rows that have no product id', async () => {
      chatJson.mockResolvedValue({ bands: [{ v: 0, lo: 10, hi: 16 }, { v: 1, lo: 10, hi: 16 }] });
      await suggestPrices({
        variants: [
          { variant_id: 'a', title: 'Tee', current_price: 20 },
          { variant_id: 'b', title: 'Tee', current_price: 20 },
        ],
        arms: [{ id: 'a' }],
        minPct: 10,
        maxPct: 20,
      });

      expect(JSON.parse(chatJson.mock.calls[0][0].userPrompt).products).toHaveLength(2);
    });
  });

  it('suggestPrices ignores a row position it never sent', async () => {
    hasOpenAiKey.mockReturnValue(true);
    chatJson.mockResolvedValue({ bands: [{ v: 7, lo: 10, hi: 15 }] });
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
    chatJson.mockResolvedValue({ bands: [{ v: 0, lo: 10, hi: 15 }] });
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
    const payload = JSON.parse(userPrompt);
    expect(payload.products[0].revenue_signal).toBe('high');
  });

  it('sends catalog scenario hints to the model without raw revenue dollars', async () => {
    hasOpenAiKey.mockReturnValue(true);
    chatJson.mockResolvedValue({ bands: [{ v: 0, lo: 10, hi: 15 }] });
    await suggestPrices({
      variants: [
        {
          variant_id: 'v1',
          title: 'Tee',
          current_price: 20,
          margin_percent: 50,
          revenue_30d: 120,
          recommended_scenario_preset: 'conservative',
          ai_reason: 'Low recent sales',
        },
      ],
      arms: [{ id: 'var_b' }],
      minPct: 10,
      maxPct: 15,
    });
    const { systemPrompt, userPrompt } = chatJson.mock.calls[0][0];
    const payload = JSON.parse(userPrompt);
    expect(payload.products[0].recommended_scenario).toBe('conservative');
    expect(payload.products[0].catalog_hint).toBe('Low recent sales');
    expect(payload.products[0].revenue_signal).toBe('low');
    expect(systemPrompt).toMatch(/recommended_scenario "conservative"/i);
  });
});

/**
 * What the model is actually asked to decide.
 *
 * It used to be asked for one uplift per product per variation, plus a rule to
 * spread those across the whole allowed range -- which is what the
 * deterministic spread already does. On a good day the model reproduced the
 * free answer, and the call bought latency and cost and nothing else. The same
 * prompt also asked for higher uplifts on stronger products, which cannot be
 * honoured while spreading across a fixed range: two rules that contradict.
 *
 * Now it returns the band for each product and Priceify spaces the variations
 * inside it, so the model is answering the one question the deterministic path
 * cannot: how much pricing headroom this particular product has.
 */
describe('what the price suggestion prompt asks for', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    hasOpenAiKey.mockReturnValue(true);
    chatJson.mockResolvedValue({ bands: [{ v: 0, lo: 12, hi: 18 }] });
  });

  const oneProduct = {
    variants: [{ variant_id: 'v1', title: 'Tee', current_price: 100, margin_percent: 60 }],
    arms: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    minPct: 10,
    maxPct: 20,
    guardrails: { min_margin_percent: 35, max_price_change_percent: 30 },
  };

  it('asks for a band per product, not a price per variation', async () => {
    await suggestPrices(oneProduct);
    const { systemPrompt } = chatJson.mock.calls[0][0];

    expect(systemPrompt).toContain('"bands"');
    expect(systemPrompt).toContain('"lo"');
    expect(systemPrompt).toContain('"hi"');
    expect(systemPrompt).not.toContain('"deltas"');
  });

  it('does not ask the model to span the range it is choosing', async () => {
    // The contradiction that made the old prompt unanswerable.
    await suggestPrices(oneProduct);
    const { systemPrompt } = chatJson.mock.calls[0][0];

    expect(systemPrompt).not.toMatch(/spread .*across the full/i);
  });

  it('requires a band wide enough for the variations to be distinguishable', async () => {
    await suggestPrices(oneProduct);
    const { systemPrompt, userPrompt } = chatJson.mock.calls[0][0];

    expect(systemPrompt).toMatch(/at least 9/);
    expect(JSON.parse(userPrompt).allowed_band.min_width).toBe(9);
  });

  it('tells the model a low-volume product needs a wider band, not a narrower one', async () => {
    // A small price difference cannot be detected on light traffic, so the
    // usual instinct to be gentle with a slow seller guarantees the test
    // learns nothing at all.
    await suggestPrices(oneProduct);
    const { systemPrompt } = chatJson.mock.calls[0][0];

    expect(systemPrompt).toMatch(/monthly_units low[\s\S]*WIDE range/);
  });

  it('says an unrecorded cost means unknown margin rather than good margin', async () => {
    await suggestPrices(oneProduct);
    const { systemPrompt } = chatJson.mock.calls[0][0];

    expect(systemPrompt).toMatch(/margin_percent null\) means no cost was recorded: the margin is unknown rather than good/);
  });

  it('tells the model what the test is judged on, in words', async () => {
    const promptFor = async objective => {
      chatJson.mockClear();
      await suggestPrices({ ...oneProduct, objective });
      return chatJson.mock.calls[0][0].systemPrompt;
    };

    expect(await promptFor('revenue_per_visitor')).toMatch(/judged on revenue per visitor/);
    expect(await promptFor('conversion_rate')).toMatch(/judged on conversion rate/);
    expect(await promptFor('aov')).toMatch(/judged on average order value/);
    // An unknown goal is still named rather than dropped.
    expect(await promptFor('custom_goal')).toMatch(/judged on custom_goal\./);
  });

  it('only names fields the model is actually sent', async () => {
    await suggestPrices(oneProduct);
    const { systemPrompt, userPrompt } = chatJson.mock.calls[0][0];
    const sentFields = Object.keys(JSON.parse(userPrompt).products[0]);
    const named = [
      ...new Set(systemPrompt.match(/\b[a-z]+(?:_[a-z0-9]+)+\b/g) || []),
    ].filter(word => !['max_price_change_percent'].includes(word));
    const productFieldLike = named.filter(word =>
      /(_tier|_units|_data|_signal|_score|_scenario|_hint|_direction|_price|_percent|_type|_\d+d)$/.test(word)
    );

    expect(productFieldLike).toEqual(expect.arrayContaining(['margin_tier', 'heuristic_direction']));
    productFieldLike.forEach(field => expect(sentFields).toContain(field));
  });

  it('distinguishes a product with no sales from one with no sales data', async () => {
    // Zero units meant both, and they call for opposite treatment: one is a
    // dead SKU and the other is a SKU the shop knows nothing about.
    await suggestPrices({
      ...oneProduct,
      variants: [
        { variant_id: 'v1', title: 'Measured', current_price: 100, units_sold_30d: 120 },
        { variant_id: 'v2', title: 'Unmeasured', current_price: 100, units_sold_30d: 0 },
      ],
    });
    const { products } = JSON.parse(chatJson.mock.calls[0][0].userPrompt);

    expect(products[0].sales_data).toBe('measured');
    expect(products[1].sales_data).toBe('none_recorded');
  });

  it('sends how many variations there are, not what they are called', async () => {
    // A count is all the model needs now that it returns a range rather than a
    // price per variation, and a merchant's own label for an arm is text we
    // have no reason to hand to a third party.
    await suggestPrices({
      ...oneProduct,
      arms: [
        { id: 'a', label: 'Holiday markup test' },
        { id: 'b', label: 'Wholesale enquiry price' },
      ],
    });
    const { userPrompt } = chatJson.mock.calls[0][0];

    expect(JSON.parse(userPrompt).variations_per_product).toBe(2);
    expect(userPrompt).not.toContain('Holiday markup');
    expect(userPrompt).not.toContain('Wholesale');
  });

  it('tells the model what currency the prices are in', async () => {
    // Without it the model compares bare numbers, and 1200 is an impulse buy
    // in yen and a considered purchase in dollars.
    await suggestPrices({
      ...oneProduct,
      variants: [
        { variant_id: 'v1', title: 'Tee', current_price: 1200, currency: 'JPY' },
      ],
    });
    const { products } = JSON.parse(chatJson.mock.calls[0][0].userPrompt);

    expect(products[0].currency).toBe('JPY');
  });
});

/**
 * Every number in the reply becomes a real price on a real storefront, so a
 * band outside the shop's limits has to be corrected here rather than trusted.
 */
describe('a band the model returned badly', () => {
  const product = {
    variants: [{ variant_id: 'v1', title: 'Tee', current_price: 100, margin_percent: 60 }],
    arms: [{ id: 'a' }, { id: 'b' }],
    minPct: 10,
    maxPct: 20,
    guardrails: { min_margin_percent: 35, max_price_change_percent: 30 },
  };

  const bandFor = async band => {
    jest.clearAllMocks();
    hasOpenAiKey.mockReturnValue(true);
    chatJson.mockResolvedValue({ bands: [{ v: 0, ...band }] });
    return suggestPrices(product);
  };

  it('pulls a band reaching above the allowed range back inside it', async () => {
    const result = await bandFor({ lo: 15, hi: 45 });

    result.suggestions.forEach(row => {
      expect(row.delta_percent).toBeLessThanOrEqual(20);
    });
  });

  it('pulls a band reaching below the allowed range back inside it', async () => {
    const result = await bandFor({ lo: 1, hi: 12 });

    result.suggestions.forEach(row => {
      expect(row.delta_percent).toBeGreaterThanOrEqual(10);
    });
  });

  it('reads an inverted band as the range the model meant', async () => {
    const result = await bandFor({ lo: 18, hi: 12 });

    expect(result.source).toBe('openai');
    const deltas = result.suggestions.map(row => row.delta_percent);
    expect(Math.max(...deltas)).toBeGreaterThan(Math.min(...deltas));
  });

  it('widens a pinpoint band so the variations can be told apart', async () => {
    // Two variations a tenth of a percent apart cannot resolve a price
    // response at any realistic traffic, so the test would never conclude.
    const result = await bandFor({ lo: 14, hi: 14.1 });
    const deltas = result.suggestions.map(row => row.delta_percent);

    // A tenth of a point apart as asked; about three points apart as run.
    // Not pinned exactly: the prices are rounded to real price endings after
    // the band is widened, so the final spread lands a hair either side of it.
    expect(Math.max(...deltas) - Math.min(...deltas)).toBeGreaterThan(2.9);
  });

  it('falls back for a row whose band is not numbers at all', async () => {
    const result = await bandFor({ lo: 'twelve', hi: null });

    expect(result.source).toBe('deterministic');
    expect(result.ai_attempted).toBe(true);
  });

  it('records the band the model chose alongside the prices', async () => {
    const result = await bandFor({ lo: 12, hi: 18 });

    expect(result.suggestions[0].ai_band).toEqual({ lo: 12, hi: 18 });
  });

  it('stores per-product AI rationale when the model returns it', async () => {
    jest.clearAllMocks();
    hasOpenAiKey.mockReturnValue(true);
    chatJson.mockResolvedValue({
      summary: 'Testing higher prices on strong sellers.',
      bands: [
        {
          v: 0,
          lo: 10,
          hi: 18,
          direction: 'rise',
          confidence: 'high',
          rationale: 'Healthy sales and margin leave room to test a moderate increase.',
        },
      ],
    });

    const result = await suggestPrices(product);

    expect(result.suggestions[0].ai_rationale).toMatch(/Healthy sales/i);
    expect(result.suggestions[0].ai_direction).toBe('rise');
    expect(result.suggestions[0].ai_confidence).toBe('high');
  });
});

/**
 * A price test asks which price earns more, and the answer is sometimes a lower
 * one -- a product selling badly may simply cost more than its shoppers will
 * pay. The band was uplift-only, and the model's reply had its sign stripped,
 * so a discount was unreachable however the merchant or the model asked for it.
 */
describe('a band that may lower the price', () => {
  const cutProduct = {
    variants: [{ variant_id: 'v1', title: 'Tee', current_price: 100, margin_percent: 70 }],
    arms: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    minPct: -20,
    maxPct: -10,
    guardrails: { min_margin_percent: 35, max_price_change_percent: 30 },
  };

  const eitherWayProduct = { ...cutProduct, minPct: -15, maxPct: 20 };

  beforeEach(() => {
    jest.clearAllMocks();
    hasOpenAiKey.mockReturnValue(true);
  });

  it('keeps a cut the model proposed as a cut', async () => {
    chatJson.mockResolvedValue({ bands: [{ v: 0, lo: -18, hi: -12 }] });

    const result = await suggestPrices(cutProduct);

    expect(result.source).toBe('openai');
    result.suggestions.forEach(row => {
      expect(row.delta_percent).toBeLessThan(0);
      expect(row.price).toBeLessThan(100);
    });
  });

  it('does not flip a cut into the rise of the same size', async () => {
    // The reply used to be passed through Math.abs, which turned every discount
    // the model reasoned its way to into a markup.
    chatJson.mockResolvedValue({ bands: [{ v: 0, lo: -18, hi: -12 }] });

    const result = await suggestPrices(cutProduct);

    expect(Math.max(...result.suggestions.map(row => row.delta_percent))).toBeLessThan(0);
  });

  it('lets the model choose a cut when the band allows either direction', async () => {
    chatJson.mockResolvedValue({ bands: [{ v: 0, lo: -12, hi: -5 }] });

    const result = await suggestPrices(eitherWayProduct);

    expect(result.source).toBe('openai');
    result.suggestions.forEach(row => expect(row.price).toBeLessThan(100));
  });

  it('lets the model choose a rise from the same band', async () => {
    chatJson.mockResolvedValue({ bands: [{ v: 0, lo: 6, hi: 18 }] });

    const result = await suggestPrices(eitherWayProduct);

    result.suggestions.forEach(row => expect(row.price).toBeGreaterThan(100));
  });

  it('still holds the model inside the band the merchant allowed', async () => {
    // Asked for at most 15% cheaper, answering 40% cheaper is not an option.
    chatJson.mockResolvedValue({ bands: [{ v: 0, lo: -40, hi: -30 }] });

    const result = await suggestPrices(eitherWayProduct);

    result.suggestions.forEach(row => {
      expect(row.delta_percent).toBeGreaterThanOrEqual(-15);
    });
  });

  it('tells the model a negative is a price cut', async () => {
    chatJson.mockResolvedValue({ bands: [{ v: 0, lo: -12, hi: -5 }] });

    await suggestPrices(eitherWayProduct);
    const { systemPrompt, userPrompt } = chatJson.mock.calls[0][0];

    expect(systemPrompt).toMatch(/negative lowers it/i);
    expect(systemPrompt).toMatch(/in either direction/i);
    expect(JSON.parse(userPrompt).allowed_band.direction_allowed).toBe('both');
  });

  it('tells the model not to assume a higher price is better', async () => {
    chatJson.mockResolvedValue({ bands: [{ v: 0, lo: -12, hi: -5 }] });

    await suggestPrices(eitherWayProduct);
    const { systemPrompt } = chatJson.mock.calls[0][0];

    expect(systemPrompt).toMatch(/Do not assume higher is better/i);
  });

  it('tells the model never to cut a thin or unknown margin', async () => {
    // The one case where a cut is indefensible: thin margin means the lost
    // profit is most of the profit, and a null margin means nobody has
    // measured how much a cut gives away.
    chatJson.mockResolvedValue({ bands: [{ v: 0, lo: -12, hi: -5 }] });

    await suggestPrices(eitherWayProduct);
    const { systemPrompt } = chatJson.mock.calls[0][0];

    expect(systemPrompt).toMatch(/Never propose a cut when margin_tier is thin or unknown/i);
  });

  it('says the direction is the model to choose only when it is', async () => {
    chatJson.mockResolvedValue({ bands: [{ v: 0, lo: 12, hi: 18 }] });
    await suggestPrices({ ...cutProduct, minPct: 10, maxPct: 20 });
    const upOnly = chatJson.mock.calls[0][0];

    expect(upOnly.systemPrompt).not.toMatch(/yours to decide per product/i);
    expect(JSON.parse(upOnly.userPrompt).allowed_band.direction_allowed).toBe('up');
  });

  it('reports a cut the margin floor refused', async () => {
    // $100 at 40% margin is $60 of cost; a 35% minimum margin puts the lowest
    // legal price at $92.31, so a 12-18% cut is not available here.
    chatJson.mockResolvedValue({ bands: [{ v: 0, lo: -18, hi: -12 }] });

    const result = await suggestPrices({
      ...cutProduct,
      variants: [{ variant_id: 'v1', title: 'Tee', current_price: 100, margin_percent: 40 }],
    });

    result.suggestions.forEach(row => {
      const margin = ((row.price - 60) / row.price) * 100;
      expect(margin).toBeGreaterThanOrEqual(35);
      expect(row.guardrail_limited).toBe(true);
    });
  });
});

/**
 * How wide a product's range has to be, once the band can point either way.
 *
 * The minimum is a share of the widest single direction available, not of the
 * whole band. A band spanning both directions is about twice as wide as either
 * side of it, so measured against the total it demanded ranges no one-sided
 * answer could satisfy.
 */
describe('the narrowest range the model may return', () => {
  const base = {
    variants: [{ variant_id: 'v1', title: 'Tee', current_price: 100, margin_percent: 70 }],
    arms: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    guardrails: { min_margin_percent: 35, max_price_change_percent: 30 },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    hasOpenAiKey.mockReturnValue(true);
    chatJson.mockResolvedValue({ bands: [{ v: 0, lo: -12, hi: -5 }] });
  });

  const widthFor = async band => {
    jest.clearAllMocks();
    hasOpenAiKey.mockReturnValue(true);
    chatJson.mockResolvedValue({ bands: [{ v: 0, lo: -12, hi: -5 }] });
    await suggestPrices({ ...base, ...band });
    return JSON.parse(chatJson.mock.calls[0][0].userPrompt).allowed_band.min_width;
  };

  it('measures a one-directional band from share and variation count', async () => {
    expect(await widthFor({ minPct: 10, maxPct: 20 })).toBe(9);
    expect(
      await widthFor({ minPct: 10, maxPct: 20, arms: [{ id: 'a' }, { id: 'b' }] })
    ).toBe(4);
  });

  it('asks a cut band for the same width as the rise mirroring it', async () => {
    expect(await widthFor({ minPct: -20, maxPct: -10 })).toBe(
      await widthFor({ minPct: 10, maxPct: 20 })
    );
  });

  it('does not double the requirement because the band spans both ways', async () => {
    // 40% of the whole -15..20 span is 14 points, which no one-sided range
    // inside it could meet. 40% of the widest single direction is 8.
    const width = await widthFor({ minPct: -15, maxPct: 20 });

    expect(width).toBe(9);
    expect(width).toBeLessThan(14);
  });

  it('widens a narrow cut away from the current price, not toward it', async () => {
    // Widened from its midpoint, a -12..-5 range reaches -2.5 at the top, and
    // an arm two points off the current price cannot be told from the control
    // it is being compared against.
    jest.clearAllMocks();
    hasOpenAiKey.mockReturnValue(true);
    chatJson.mockResolvedValue({ bands: [{ v: 0, lo: -12, hi: -5 }] });

    const result = await suggestPrices({ ...base, minPct: -15, maxPct: 20 });

    expect(Math.max(...result.suggestions.map(row => row.delta_percent))).toBeLessThanOrEqual(-5);
  });

  it('widens a narrow rise away from the current price too', async () => {
    jest.clearAllMocks();
    hasOpenAiKey.mockReturnValue(true);
    chatJson.mockResolvedValue({ bands: [{ v: 0, lo: 5, hi: 8 }] });

    const result = await suggestPrices({ ...base, minPct: -15, maxPct: 20 });

    expect(Math.min(...result.suggestions.map(row => row.delta_percent))).toBeGreaterThanOrEqual(5);
  });
});
