const {
  mergeAiRanking,
  buildCompactCandidatePayload,
  estimateRankingTokens,
  resolveRankingItems,
} = require('../smartPricingAiRankingService');

describe('smartPricingAiRankingService', () => {
  const baseRows = [
    {
      variant_id: 'gid://shopify/ProductVariant/1',
      title: 'Hoodie',
      opportunity_score: 0.72,
      recommended: false,
      eligible: true,
    },
    {
      variant_id: 'gid://shopify/ProductVariant/2',
      title: 'Tee',
      opportunity_score: 0.65,
      recommended: true,
      eligible: true,
    },
  ];

  it('builds compact candidate payload capped at 20 rows', () => {
    const rows = Array.from({ length: 25 }, (_, index) => ({
      variant_id: `gid://shopify/ProductVariant/${index}`,
      title: `SKU ${index}`,
      opportunity_score: 0.5,
    }));
    expect(buildCompactCandidatePayload(rows)).toHaveLength(20);
  });

  it('merges AI reasons and reorders by priority rank', () => {
    const merged = mergeAiRanking(baseRows, {
      summary: 'Focus on hoodie margin upside.',
      items: [
        {
          variant_id: 'gid://shopify/ProductVariant/1',
          recommended: true,
          ai_reason: 'Strong margin with steady traffic.',
          priority_rank: 1,
        },
      ],
    });

    expect(merged[0].variant_id).toBe('gid://shopify/ProductVariant/1');
    expect(merged[0].ai_reason).toContain('Strong margin');
    expect(merged[0].recommended).toBe(true);
    expect(merged[0].ai_enriched).toBe(true);
  });

  it('returns original rows when AI payload is missing', () => {
    expect(mergeAiRanking(baseRows, null)).toEqual(baseRows);
  });
});

/**
 * What the ranking request carries, and how big an answer it allows for.
 *
 * A full twenty-row reply echoing a Shopify variant gid per row needed around
 * 1,400 output tokens against a fixed ceiling of 900. Over that ceiling the
 * JSON came back truncated, parsed to nothing, and the merchant silently got
 * the deterministic order while the shop still paid for the call -- the same
 * fault that had already been fixed on the price-suggestion path.
 */
describe('the ranking request', () => {
  const rows = Array.from({ length: 25 }, (_, index) => ({
    variant_id: `gid://shopify/ProductVariant/${index}`,
    title: `SKU ${index}`,
    current_price: 20 + index,
    margin_percent: 55,
    units_sold_30d: 40,
    revenue_30d: 4200,
    tags: ['seasonal'],
    opportunity_score: 0.5,
  }));

  it('addresses candidates by position rather than by Shopify id', () => {
    const payload = buildCompactCandidatePayload(rows);

    expect(payload[0].v).toBe(0);
    expect(payload[7].v).toBe(7);
    expect(JSON.stringify(payload)).not.toContain('gid://shopify');
  });

  it('does not send a merchant a third party has no use for', () => {
    // The price-suggestion path already declines all of these; there was no
    // reason for this path to send them when it does not need them either.
    const serialized = JSON.stringify(buildCompactCandidatePayload(rows));

    expect(serialized).not.toContain('4200');
    expect(serialized).not.toContain('seasonal');
  });

  it('still caps how many products go to the model', () => {
    expect(buildCompactCandidatePayload(rows)).toHaveLength(20);
  });

  it('distinguishes a product with no sales from one with no sales data', () => {
    const payload = buildCompactCandidatePayload([
      { variant_id: 'a', title: 'Busy', units_sold_30d: 90 },
      { variant_id: 'b', title: 'Quiet', units_sold_30d: 0 },
    ]);

    expect(payload[0].sales_data).toBe('measured');
    expect(payload[1].sales_data).toBe('none_recorded');
  });

  it('flags a recent price change instead of shipping every product tag', () => {
    const payload = buildCompactCandidatePayload([
      { variant_id: 'a', title: 'Moved', tags: ['sale', 'price_recently_changed'] },
      { variant_id: 'b', title: 'Steady', tags: ['sale'] },
    ]);

    expect(payload[0].price_recently_changed).toBe(true);
    expect(payload[1].price_recently_changed).toBe(false);
  });

  it('reads the tag out of a comma-joined string too', () => {
    const payload = buildCompactCandidatePayload([
      { variant_id: 'a', title: 'Moved', tags: 'sale, price_recently_changed' },
    ]);

    expect(payload[0].price_recently_changed).toBe(true);
  });

  it('allows enough output tokens for a full answer', () => {
    // The measured cost of a complete twenty-row reply.
    expect(estimateRankingTokens(20)).toBeGreaterThan(900);
    // And scales, rather than being one figure for every request size.
    expect(estimateRankingTokens(20)).toBeGreaterThan(estimateRankingTokens(4));
  });
});

/**
 * A reply addressed by position has to become one addressed by variant before
 * anything is stored. An index is only meaningful for the request that
 * produced it, so a cached index would apply one product's recommendation to
 * another as soon as the catalog changed -- and the cache holds for 12 hours.
 */
describe('resolving a ranking reply onto real products', () => {
  const rows = [
    { variant_id: 'gid://shopify/ProductVariant/1', title: 'Hoodie' },
    { variant_id: 'gid://shopify/ProductVariant/2', title: 'Tee' },
  ];

  it('maps each position onto the product that was sent in it', () => {
    const resolved = resolveRankingItems(
      {
        summary: 'Start with the hoodie.',
        items: [{ v: 1, rank: 1, pick: true, why: 'Steady traffic and room on margin.' }],
      },
      rows
    );

    expect(resolved.items).toHaveLength(1);
    expect(resolved.items[0].variant_id).toBe('gid://shopify/ProductVariant/2');
    expect(resolved.items[0].recommended).toBe(true);
    expect(resolved.items[0].priority_rank).toBe(1);
    expect(resolved.items[0].ai_reason).toContain('Steady traffic');
  });

  it('discards a position that was never sent', () => {
    const resolved = resolveRankingItems({ items: [{ v: 9, rank: 1, pick: true }] }, rows);

    expect(resolved).toBe(null);
  });

  it('keeps only the first answer for a repeated position', () => {
    const resolved = resolveRankingItems(
      {
        items: [
          { v: 0, rank: 1, pick: true, why: 'first' },
          { v: 0, rank: 2, pick: false, why: 'second' },
        ],
      },
      rows
    );

    expect(resolved.items).toHaveLength(1);
    expect(resolved.items[0].ai_reason).toBe('first');
  });

  it('treats anything other than an explicit pick as not recommended', () => {
    const resolved = resolveRankingItems({ items: [{ v: 0, rank: 1, pick: 'yes' }] }, rows);

    expect(resolved.items[0].recommended).toBe(false);
  });

  it('says nothing when the reply has no items at all', () => {
    expect(resolveRankingItems({ summary: 'hello' }, rows)).toBe(null);
    expect(resolveRankingItems(null, rows)).toBe(null);
  });
});

/**
 * The path that actually spends money and writes the cache, which nothing
 * exercised before. The cache holds for twelve hours, so what goes into it
 * matters more than most writes in this service.
 */
describe('enriching an opportunity list', () => {
  let chatJsonMock;
  let writes;
  let cachedRow;

  function load() {
    writes = [];
    chatJsonMock = jest.fn();
    cachedRow = null;
    let service;
    jest.isolateModules(() => {
      jest.doMock('../../../utils/database', () => ({
        query: async (sql, params) => {
          if (/INSERT/i.test(sql)) {
            writes.push(params);
            return { rows: [] };
          }
          return { rows: cachedRow ? [cachedRow] : [] };
        },
      }));
      jest.doMock('../smartPricingAiProvider', () => ({
        chatJson: (...args) => chatJsonMock(...args),
      }));
      service = require('../smartPricingAiRankingService');
    });
    return service;
  }

  const opportunities = [
    { variant_id: 'gid://shopify/ProductVariant/1', title: 'Hoodie', opportunity_score: 0.7 },
    { variant_id: 'gid://shopify/ProductVariant/2', title: 'Tee', opportunity_score: 0.6 },
  ];

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
    delete process.env.SMART_PRICING_AI_RANKING;
  });

  afterEach(() => {
    jest.dontMock('../../../utils/database');
    jest.dontMock('../smartPricingAiProvider');
    delete process.env.OPENAI_API_KEY;
    jest.resetModules();
  });

  it('caches the ranking against products, never against positions', async () => {
    // A row index means something only for the request that produced it. Cached
    // for twelve hours, one added product would hand a recommendation written
    // for the hoodie to whatever now sits in that slot.
    const service = load();
    chatJsonMock.mockResolvedValue({
      summary: 'Start with the tee.',
      items: [{ v: 1, rank: 1, pick: true, why: 'Steady traffic and room on margin.' }],
    });

    await service.enrichOpportunitiesWithAiRanking({
      shopDomain: 'demo.myshopify.com',
      opportunities,
    });

    const cached = writes.flat().find(param => typeof param === 'string' && param.includes('items'));
    expect(cached).toBeTruthy();
    const parsed = JSON.parse(cached);
    expect(parsed.items[0].variant_id).toBe('gid://shopify/ProductVariant/2');
    expect(JSON.stringify(parsed.items)).not.toContain('"v"');
  });

  it('applies the ranking to the products it named', async () => {
    const service = load();
    chatJsonMock.mockResolvedValue({
      summary: 'Start with the tee.',
      items: [{ v: 1, rank: 1, pick: true, why: 'Steady traffic and room on margin.' }],
    });

    const result = await service.enrichOpportunitiesWithAiRanking({
      shopDomain: 'demo.myshopify.com',
      opportunities,
    });

    expect(result.ai_source).toBe('openai');
    expect(result.ai_summary).toBe('Start with the tee.');
    expect(result.opportunities[0].variant_id).toBe('gid://shopify/ProductVariant/2');
    expect(result.opportunities[0].ai_reason).toContain('Steady traffic');
  });

  it('keeps the deterministic order when the model says nothing usable', async () => {
    const service = load();
    chatJsonMock.mockResolvedValue(null);

    const result = await service.enrichOpportunitiesWithAiRanking({
      shopDomain: 'demo.myshopify.com',
      opportunities,
    });

    expect(result.ai_source).toBe('deterministic');
    expect(result.opportunities).toEqual(opportunities);
    expect(writes).toHaveLength(0);
  });

  it('keeps the deterministic order when the call fails outright', async () => {
    const service = load();
    chatJsonMock.mockRejectedValue(new Error('upstream is down'));

    const result = await service.enrichOpportunitiesWithAiRanking({
      shopDomain: 'demo.myshopify.com',
      opportunities,
    });

    // A ranking is a nicety. Losing it must never cost the merchant the list.
    expect(result.ai_source).toBe('deterministic');
    expect(result.opportunities).toEqual(opportunities);
  });

  it('does not call the model at all without a key', async () => {
    delete process.env.OPENAI_API_KEY;
    const service = load();

    const result = await service.enrichOpportunitiesWithAiRanking({
      shopDomain: 'demo.myshopify.com',
      opportunities,
    });

    expect(chatJsonMock).not.toHaveBeenCalled();
    expect(result.ai_source).toBe('deterministic');
  });

  it('spends nothing when a fresh ranking is already cached', async () => {
    const service = load();
    cachedRow = {
      value: JSON.stringify({
        summary: 'From earlier.',
        items: [
          {
            variant_id: 'gid://shopify/ProductVariant/2',
            recommended: true,
            ai_reason: 'Cached reason for the tee.',
            priority_rank: 1,
          },
        ],
        generated_at: new Date().toISOString(),
      }),
      updated_at: new Date().toISOString(),
    };

    const result = await service.enrichOpportunitiesWithAiRanking({
      shopDomain: 'demo.myshopify.com',
      opportunities,
    });

    expect(chatJsonMock).not.toHaveBeenCalled();
    expect(result.ai_source).toBe('cache');
    expect(result.opportunities[0].ai_reason).toContain('Cached reason');
  });
});
