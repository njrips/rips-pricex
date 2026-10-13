const fs = require('node:fs');
const path = require('node:path');

const {
  PRICE_SUGGEST_RESPONSE_SCHEMA,
  buildPriceSuggestionSystemPrompt,
} = require('../smartPricingAiSuggestPrompt');
const {
  PRODUCT_RANKING_RESPONSE_SCHEMA,
  buildProductRankingSystemPrompt,
} = require('../smartPricingAiRankingPrompt');

const repoRoot = path.resolve(__dirname, '../../../../..');

function readDoc(name) {
  return fs.readFileSync(path.join(repoRoot, 'docs/ai-prompts', name), 'utf8');
}

describe('Priceify AI prompt contracts', () => {
  it('documents the client baseline and every production correction', () => {
    const doc = readDoc('price-suggestions.md');

    expect(doc).toContain('Client baseline prompt (reference)');
    expect(doc).toContain('Production corrections');
    expect(doc).toContain('selected primary metric');
    expect(doc).toContain('strict JSON Schema');
    expect(doc).toContain('private chain-of-thought');
  });

  it('builds a search-backed prompt for the selected metric and actual image input', () => {
    const prompt = buildPriceSuggestionSystemPrompt({
      objective: 'conversion_rate',
      currency: 'GBP',
      min: -10,
      max: 20,
      minBandWidth: 8,
      minGapHint: 4,
      withWebSearch: true,
    });

    const sections = [
      'VISUAL & PERCEIVED VALUE ASSESSMENT',
      'COMPETITOR LANDSCAPE & BENCHMARKING',
      'HISTORICAL SALES PERFORMANCE',
      'PRICE ELASTICITY & BAND CALCULATION',
    ];

    expect(prompt).toContain('You are a Lead Pricing Scientist and E-Commerce Strategist');
    expect(prompt).toContain('Conversion rate');
    expect(prompt).toContain('Current retail price (GBP)');
    expect(prompt).toContain('[-10%, 20%]');
    expect(prompt).toContain('resized to at most 1024 pixels');
    expect(prompt).toContain('Search the live web');
    expect(prompt).not.toContain('<thinking>');
    expect(prompt).not.toContain('```json');
    sections.forEach((section, index) => {
      expect(prompt).toContain(section);
      if (index > 0) {
        expect(prompt.indexOf(sections[index - 1])).toBeLessThan(prompt.indexOf(section));
      }
    });
  });

  it('states the gap between test prices only when there is more than one', () => {
    const several = buildPriceSuggestionSystemPrompt({
      min: -10,
      max: 20,
      minBandWidth: 9,
      minGapHint: 4.5,
      variationCount: 3,
    });
    const one = buildPriceSuggestionSystemPrompt({
      min: -10,
      max: 20,
      minBandWidth: 8,
      minGapHint: 8,
      variationCount: 1,
      minControlGap: 3,
    });

    expect(several).toContain('hi - lo is at least 9%');
    expect(several).toContain('3 test prices across lo..hi, at least about 4.5% apart');
    expect(several).toContain('at least 3% away from 0 (the current price)');
    expect(several).toMatch(/crosses 0 loses the stretch within 3% of 0/);
    expect(one).toContain('hi - lo is at least 8%');
    expect(one).toContain('keep best at least 3% away from 0');
    expect(one).not.toMatch(/apart/);
  });

  it('has an honest non-search prompt and a strict response schema', () => {
    const prompt = buildPriceSuggestionSystemPrompt({
      min: 5,
      max: 15,
      minBandWidth: 5,
      minGapHint: 5,
      withWebSearch: false,
    });
    const band = PRICE_SUGGEST_RESPONSE_SCHEMA.properties.bands.items;

    expect(prompt).toContain('Live web search is disabled');
    expect(prompt).toContain('do not claim that a benchmark is live');
    expect(prompt).toContain('null positioning when the market cannot be established');
    expect(band.additionalProperties).toBe(false);
    expect(band.properties.direction.enum).toEqual(['rise', 'cut', 'either', 'hold']);
    expect(band.properties.confidence.enum).toEqual(['low', 'medium', 'high']);
    expect(band.properties.market_benchmarks.required).toEqual([
      'market_low_price',
      'market_avg_price',
      'market_high_price',
      'positioning',
      'perceived_tier',
    ]);
    expect(band.properties.market_benchmarks.properties.positioning.anyOf).toContainEqual({
      type: 'null',
    });
    expect(band.required).toEqual(
      expect.arrayContaining(['v', 'lo', 'hi', 'best', 'market_benchmarks', 'rationale'])
    );
  });

  it('documents product ranking as a separate prompt with its own builder', () => {
    const doc = readDoc('product-ranking.md');
    const prompt = buildProductRankingSystemPrompt({
      objective: 'conversion_rate',
      maxRecommendedCandidates: 3,
      maxPriceChangePercent: 15,
    });

    expect(doc).toContain('Separate Priceify runtime prompt.');
    expect(doc).toContain('must not reuse the price-suggestion prompt');
    expect(prompt).toContain('choosing which products');
    expect(prompt).toContain('judged on conversion rate');
    expect(prompt).toContain('"rank"');
    expect(prompt).not.toMatch(/margin/i);
    expect(PRODUCT_RANKING_RESPONSE_SCHEMA.additionalProperties).toBe(false);
    expect(PRODUCT_RANKING_RESPONSE_SCHEMA.properties.items.items.required).toEqual([
      'v',
      'rank',
      'pick',
      'why',
    ]);
  });
});
