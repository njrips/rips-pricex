jest.mock('../smartPricingAiProvider', () => ({
  hasOpenAiKey: jest.fn(() => false),
  chatJson: jest.fn(async () => null),
  webSearchJson: jest.fn(async () => null),
}));

const { hasOpenAiKey, chatJson, webSearchJson } = require('../smartPricingAiProvider');
const {
  suggestPrices,
  deterministicPriceSuggestions,
  sanitizeMarketBenchmarks,
} = require('../smartPricingAiSuggestService');

const originalWebSearch = process.env.OPENAI_PRICE_SUGGEST_WEB_SEARCH;

beforeEach(() => {
  // Most unit tests exercise the ordinary JSON-mode path directly. Search
  // defaults on in production and has its own focused cases below.
  process.env.OPENAI_PRICE_SUGGEST_WEB_SEARCH = 'false';
});

afterAll(() => {
  if (originalWebSearch === undefined) delete process.env.OPENAI_PRICE_SUGGEST_WEB_SEARCH;
  else process.env.OPENAI_PRICE_SUGGEST_WEB_SEARCH = originalWebSearch;
});

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

    it('reasons about the market before calculating the band, without naming competitors', async () => {
      chatJson.mockResolvedValue({ bands: [{ v: 0, lo: 10, hi: 20, best: 15 }] });
      await suggestPrices({ ...tee, arms: [{ id: 'var_a' }] });
      const { systemPrompt } = chatJson.mock.calls[0][0];

      expect(systemPrompt).toContain('"best"');
      expect(systemPrompt).toContain('"market_benchmarks"');
      expect(systemPrompt.indexOf('COMPETITOR LANDSCAPE & BENCHMARKING')).toBeLessThan(
        systemPrompt.indexOf('PRICE ELASTICITY & BAND CALCULATION')
      );
      expect(systemPrompt).toMatch(/Never invent a competitor/);
      expect(systemPrompt).toMatch(/sales data is absent or minimal/i);
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

  /** Billable AI work is bounded; the safe spread still prices every row. */
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

    it('caps AI work per click and fills the rest deterministically', async () => {
      chatJson.mockImplementation(answerEveryProduct);
      const result = await suggestPrices({ variants: products(100), arms: [{ id: 'a' }], minPct: 10, maxPct: 20 });

      expect(chatJson).toHaveBeenCalledTimes(2);
      chatJson.mock.calls.forEach(([call]) =>
        expect(JSON.parse(call.userPrompt).products.length).toBeLessThanOrEqual(20)
      );
      expect(new Set(sentTitles()).size).toBe(25);
      expect(result.ai_product_count).toBe(25);
      expect(result.ai_skipped_product_count).toBe(75);
      expect(result.fallback_pair_count).toBe(75);
      expect(result.suggestions).toHaveLength(100);
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

      expect(most).toBe(2);
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
      expect(result.summary).toMatch(/for 25 products/);
      expect(result.summary).toMatch(/5 products/);
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
    expect(systemPrompt).toMatch(/Sales history, live RPV, traffic and performance signals/);
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

    expect(systemPrompt).toMatch(/hi - lo is at least 9%/);
    expect(JSON.parse(userPrompt).allowed_band.min_width).toBe(9);
  });

  it('tells the model to lean on market evidence when sales are minimal', async () => {
    await suggestPrices(oneProduct);
    const { systemPrompt } = chatJson.mock.calls[0][0];

    expect(systemPrompt).toMatch(/sales data is absent or minimal/i);
  });

  it('does not send cost or margin data to the model', async () => {
    // Most merchants never record a cost, so a prompt built on margin was
    // reasoning from a blank for most shops.
    await suggestPrices({
      ...oneProduct,
      variants: [{ ...oneProduct.variants[0], margin_percent: 60 }],
    });
    const { systemPrompt, userPrompt } = chatJson.mock.calls[0][0];
    const { products, guardrails } = JSON.parse(userPrompt);

    expect(systemPrompt).toMatch(/perceived value/i);
    expect(products[0]).not.toHaveProperty('margin_percent');
    expect(products[0]).not.toHaveProperty('margin_tier');
    expect(guardrails).not.toHaveProperty('min_margin_percent');
  });

  it('tells the model not to cut a slow seller already priced below the market', async () => {
    await suggestPrices(oneProduct);
    const { systemPrompt } = chatJson.mock.calls[0][0];

    expect(systemPrompt).toMatch(/Low sales below the market low should not trigger an aggressive cut/);
    expect(systemPrompt).toMatch(/Low sales above the market average can support a price cut/);
  });

  it('sends live revenue per visitor and stock with each product', async () => {
    await suggestPrices({
      ...oneProduct,
      variants: [
        {
          variant_id: 'v1',
          title: 'Wallet',
          current_price: 25,
          units_sold_30d: 10,
          revenue_30d: 250,
          visitors_30d: 500,
          inventory_quantity: 7,
        },
      ],
    });
    const [product] = JSON.parse(chatJson.mock.calls[0][0].userPrompt).products;

    expect(product.rpv_30d).toBe(0.5);
    expect(product.visitors_30d).toBe(500);
    expect(product.inventory).toBe(7);
  });

  it('uses the selected primary metric', async () => {
    await suggestPrices({ ...oneProduct, objective: 'conversion_rate' });
    const { systemPrompt, userPrompt } = chatJson.mock.calls[0][0];

    expect(systemPrompt).toMatch(/This test is judged on Conversion rate/);
    expect(JSON.parse(userPrompt).objective).toBe('conversion_rate');
  });

  it('does not send an unsupported objective to the model', async () => {
    await suggestPrices({ ...oneProduct, objective: 'profit_per_visitor' });
    const { systemPrompt, userPrompt } = chatJson.mock.calls[0][0];

    expect(systemPrompt).toMatch(/This test is judged on Revenue per visitor/);
    expect(JSON.parse(userPrompt).objective).toBe('revenue_per_visitor');
  });

  it('sends the product inputs named by the client prompt', async () => {
    await suggestPrices(oneProduct);
    const { systemPrompt, userPrompt } = chatJson.mock.calls[0][0];
    const product = JSON.parse(userPrompt).products[0];

    expect(systemPrompt).toMatch(/Product title, description, and a product image/);
    expect(systemPrompt).toMatch(/Current retail price/);
    expect(systemPrompt).toMatch(/Sales history, live RPV, traffic and performance signals/);
    expect(systemPrompt).toMatch(/Inventory level when tracked/);
    expect(product).toEqual(
      expect.objectContaining({
        title: 'Tee',
        current_price: 100,
        currency: 'USD',
      })
    );
  });

  it('distinguishes a product with no sales from one with no sales data', async () => {
    // Zero units meant both, and they call for opposite treatment: one is a
    // dead SKU and the other is a SKU the shop knows nothing about.
    await suggestPrices({
      ...oneProduct,
      variants: [
        { variant_id: 'v1', title: 'Measured', current_price: 100, units_sold_30d: 120 },
        {
          variant_id: 'v2',
          title: 'Measured zero-sales product',
          current_price: 100,
          units_sold_30d: 0,
          visitors_30d: 300,
        },
        { variant_id: 'v3', title: 'Unmeasured', current_price: 100, units_sold_30d: 0 },
      ],
    });
    const { products } = JSON.parse(chatJson.mock.calls[0][0].userPrompt);

    expect(products[0].sales_data).toBe('measured');
    expect(products[1].sales_data).toBe('measured');
    expect(products[1].monthly_units).toBe(0);
    expect(products[2].sales_data).toBe('none_recorded');
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

    expect(systemPrompt).toMatch(/negative numbers lower price/i);
    expect(JSON.parse(userPrompt).allowed_band.direction_allowed).toBe('both');
  });

  it('uses Revenue Per Visitor when it is the selected objective', async () => {
    chatJson.mockResolvedValue({ bands: [{ v: 0, lo: -12, hi: -5 }] });

    await suggestPrices(eitherWayProduct);
    const { systemPrompt } = chatJson.mock.calls[0][0];

    expect(systemPrompt).toMatch(/This test is judged on Revenue per visitor \(RPV\)/i);
  });

  it('still holds a recorded margin floor on a cut the model proposes', async () => {
    // Margin left the prompt, not the guardrail: a shop that set a floor
    // keeps it on every price.
    chatJson.mockResolvedValue({ bands: [{ v: 0, lo: -15, hi: -5 }] });

    const result = await suggestPrices({
      ...eitherWayProduct,
      variants: [{ ...eitherWayProduct.variants[0], margin_percent: 40 }],
      guardrails: { ...eitherWayProduct.guardrails, min_margin_percent: 35 },
    });
    const cost = eitherWayProduct.variants[0].current_price * 0.6;

    result.suggestions.forEach(row => {
      expect(1 - cost / row.price).toBeGreaterThanOrEqual(0.35 - 0.01);
    });
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

describe('what the model sees of each product', () => {
  const wallet = {
    variants: [
      {
        variant_id: 'gid://shopify/ProductVariant/1',
        product_id: 'gid://shopify/Product/9',
        title: 'Leather wallet',
        current_price: 25,
        units_sold_30d: 4,
        image_url: 'https://cdn.shopify.com/catalog.jpg',
      },
    ],
    arms: [{ id: 'var_a' }, { id: 'var_b' }],
    minPct: -15,
    maxPct: 20,
    guardrails: { max_price_change_percent: 30 },
  };
  const savedImages = process.env.OPENAI_PRICE_SUGGEST_IMAGES;
  const savedSearch = process.env.OPENAI_PRICE_SUGGEST_WEB_SEARCH;

  beforeEach(() => {
    jest.clearAllMocks();
    hasOpenAiKey.mockReturnValue(true);
    chatJson.mockResolvedValue({ bands: [{ v: 0, lo: 8, hi: 18, best: 14 }] });
    delete process.env.OPENAI_PRICE_SUGGEST_IMAGES;
    process.env.OPENAI_PRICE_SUGGEST_WEB_SEARCH = 'false';
  });

  afterAll(() => {
    if (savedImages === undefined) delete process.env.OPENAI_PRICE_SUGGEST_IMAGES;
    else process.env.OPENAI_PRICE_SUGGEST_IMAGES = savedImages;
    if (savedSearch === undefined) delete process.env.OPENAI_PRICE_SUGGEST_WEB_SEARCH;
    else process.env.OPENAI_PRICE_SUGGEST_WEB_SEARCH = savedSearch;
  });

  it('adds the description, stock and resized image the loader found', async () => {
    const loadProductContext = jest.fn(async ids => {
      expect(ids).toEqual(['gid://shopify/Product/9']);
      return new Map([
        [
          'gid://shopify/Product/9',
          {
            description: 'Full-grain leather, hand stitched.',
            vendor: 'Atelier',
            image_url: 'https://cdn.shopify.com/resized.jpg',
            inventory: 12,
          },
        ],
      ]);
    });

    await suggestPrices({ ...wallet, loadProductContext });
    const { userPrompt, images } = chatJson.mock.calls[0][0];
    const [product] = JSON.parse(userPrompt).products;

    expect(product.description).toBe('Full-grain leather, hand stitched.');
    expect(product.vendor).toBe('Atelier');
    expect(product.inventory).toBe(12);
    expect(product.has_image).toBe(true);
    expect(images).toEqual([{ label: 'Image for v=0', url: 'https://cdn.shopify.com/resized.jpg' }]);
  });

  it('still asks the model when the context lookup fails', async () => {
    await suggestPrices({
      ...wallet,
      loadProductContext: async () => {
        throw new Error('401');
      },
    });
    const { userPrompt, images } = chatJson.mock.calls[0][0];

    expect(JSON.parse(userPrompt).products[0].description).toBeNull();
    expect(JSON.parse(userPrompt).products[0].has_image).toBe(false);
    expect(images).toEqual([]);
  });

  it('sends no images when an operator switched them off', async () => {
    process.env.OPENAI_PRICE_SUGGEST_IMAGES = 'false';
    await suggestPrices(wallet);
    const { userPrompt, images } = chatJson.mock.calls[0][0];

    expect(images).toEqual([]);
    expect(JSON.parse(userPrompt).products[0].has_image).toBe(false);
  });

  it('uses live web research by default and lets an operator switch it off', async () => {
    delete process.env.OPENAI_PRICE_SUGGEST_WEB_SEARCH;
    webSearchJson.mockResolvedValue({ bands: [{ v: 0, lo: 6, hi: 16 }] });
    await suggestPrices(wallet);
    expect(webSearchJson).toHaveBeenCalledTimes(1);
    expect(webSearchJson.mock.calls[0][0].systemPrompt).not.toMatch(/<thinking>/);
    expect(webSearchJson.mock.calls[0][0].systemPrompt).toMatch(
      /Lead Pricing Scientist and E-Commerce Strategist/
    );
    expect(webSearchJson.mock.calls[0][0].systemPrompt).toMatch(
      /Search the live web for comparable products/
    );
    expect(chatJson).not.toHaveBeenCalled();

    process.env.OPENAI_PRICE_SUGGEST_WEB_SEARCH = 'false';
    webSearchJson.mockClear();
    await suggestPrices(wallet);
    expect(webSearchJson).not.toHaveBeenCalled();
    expect(chatJson).toHaveBeenCalledTimes(1);
  });

  it('retries with search instead of silently substituting model memory', async () => {
    process.env.OPENAI_PRICE_SUGGEST_WEB_SEARCH = 'true';
    webSearchJson
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ bands: [{ v: 0, lo: 7, hi: 17 }] });

    const result = await suggestPrices(wallet);

    expect(webSearchJson).toHaveBeenCalledTimes(2);
    expect(chatJson).not.toHaveBeenCalled();
    expect(result.ai_product_count).toBe(1);
  });

  it('uses a separate required-search request for each product', async () => {
    process.env.OPENAI_PRICE_SUGGEST_WEB_SEARCH = 'true';
    webSearchJson.mockResolvedValue({ bands: [{ v: 0, lo: 7, hi: 17 }] });
    await suggestPrices({
      ...wallet,
      variants: [
        wallet.variants[0],
        {
          variant_id: 'wallet-2',
          product_id: 'product-2',
          title: 'Canvas wallet',
          current_price: 30,
        },
      ],
    });

    expect(webSearchJson).toHaveBeenCalledTimes(2);
    webSearchJson.mock.calls.forEach(([call]) => {
      expect(JSON.parse(call.userPrompt).products).toHaveLength(1);
    });
  });

  it('keeps the market read on each suggestion', async () => {
    chatJson.mockResolvedValue({
      bands: [
        {
          v: 0,
          market_benchmarks: {
            perceived_tier: 'mid_market',
            market_low_price: '30.00',
            market_avg_price: '£45',
            market_high_price: 60,
            positioning: 'underpriced_relative_to_market',
          },
          lo: 8,
          hi: 18,
        },
      ],
    });

    const result = await suggestPrices(wallet);

    expect(result.suggestions[0].ai_market_benchmarks).toEqual({
      market_low_price: 30,
      market_avg_price: 45,
      market_high_price: 60,
      positioning: 'underpriced',
      perceived_tier: 'mid_market',
    });
  });
});

describe('sanitizeMarketBenchmarks', () => {
  it('drops values outside the agreed vocabulary and empty reads', () => {
    expect(sanitizeMarketBenchmarks(null)).toBeNull();
    expect(sanitizeMarketBenchmarks({ positioning: 'great', market_avg_price: 'n/a' })).toBeNull();
    expect(sanitizeMarketBenchmarks({ positioning: 'overpriced', perceived_tier: 'luxury' })).toEqual({
      market_low_price: null,
      market_avg_price: null,
      market_high_price: null,
      positioning: 'overpriced',
      perceived_tier: null,
    });
  });

  it('does not expose an internally inconsistent market range', () => {
    expect(
      sanitizeMarketBenchmarks({
        market_low_price: 100,
        market_avg_price: 80,
        market_high_price: 90,
        positioning: 'overpriced_relative_to_market',
        perceived_tier: 'premium',
      })
    ).toEqual({
      market_low_price: null,
      market_avg_price: null,
      market_high_price: null,
      positioning: null,
      perceived_tier: 'premium',
    });
  });
});
