import { describe, expect, it } from 'vitest';
import {
  formatCatalogLoadError,
  getProductsStepContinueState,
  productSuggestionReason,
  normalizeAiPriceBand,
  describeAiSuggestionSource,
  describeGuardrailLimitedSuggestions,
  describeCollapsedAiBand,
  armHasAiPrices,
  buildAiBandPriceOverrides,
  variationPositionInBand,
  resolveBandEdge,
  describeAiPriceCalculationTooltip,
  composeAiSuggestBanner,
  describePriceSuggestionTooltip,
  buildLocalPriceSuggestionMeta,
  metaFromPriceSuggestions,
  lookupPriceOverride,
  parsePriceOverrideKey,
  priceOverrideKey,
  reconcileSelectedVariantIds,
  getAiSuggestCopy,
  resolveAiSuggestTargetArms,
  resolveAiSuggestSpreadArms,
  siblingArmPrices,
  keepArmKeys,
  removedArmIds,
  dropArmEntries,
  hasAnyTestPriceChange,
  hasProductSelection,
  limitSelectionToProducts,
  resolvePricingRows,
  variantIdsMatch,
  aiBandOrderError,
  AI_BAND_MIN_PERCENT,
  spreadAiBandPriceEntries,
  aiSuggestBlockedReason,
  sanitizePriceInput,
  variantIdentity,
} from '../productsStepReadiness';

describe('limitSelectionToProducts', () => {
  /** `count` products, each carrying `variantsEach` variants. */
  function catalog(count, variantsEach) {
    const rows = [];
    for (let p = 0; p < count; p += 1) {
      for (let v = 0; v < variantsEach; v += 1) {
        rows.push({ product_id: `p${p}`, variant_id: `p${p}v${v}`, title: `Product ${p}` });
      }
    }
    return rows;
  }

  it('counts the cap in products, not in variant ids', () => {
    // The bug behind "Select all doesn't select all": slicing the id list at
    // 100 stopped a three-variant catalog at 33 of its 60 products.
    const rows = catalog(60, 3);
    const kept = limitSelectionToProducts(
      rows,
      rows.map(r => r.variant_id),
      100
    );

    expect(kept).toHaveLength(180);
    expect(new Set(kept.map(id => id.split('v')[0])).size).toBe(60);
  });

  it('never leaves a product half selected at the cap', () => {
    const rows = catalog(10, 4);
    const kept = limitSelectionToProducts(
      rows,
      rows.map(r => r.variant_id),
      3
    );

    expect(new Set(kept.map(id => id.split('v')[0])).size).toBe(3);
    expect(kept).toHaveLength(12);
  });

  it('keeps every variant of a product already inside the cap', () => {
    const rows = catalog(2, 3);
    expect(limitSelectionToProducts(rows, ['p0v0', 'p1v0', 'p0v2'], 2)).toEqual([
      'p0v0',
      'p1v0',
      'p0v2',
    ]);
  });

  it('drops duplicates and blanks without spending cap on them', () => {
    const rows = catalog(2, 1);
    expect(limitSelectionToProducts(rows, ['p0v0', 'p0v0', '', null, 'p1v0'], 2)).toEqual([
      'p0v0',
      'p1v0',
    ]);
  });

  it('treats an id the catalog does not know as its own product', () => {
    // A resumed draft can name a variant that has since left the catalog, and
    // dropping it would quietly shrink the merchant's selection on reload.
    const rows = catalog(1, 1);
    expect(limitSelectionToProducts(rows, ['ghost', 'p0v0'], 2)).toEqual(['ghost', 'p0v0']);
    expect(limitSelectionToProducts(rows, ['ghost', 'p0v0'], 1)).toEqual(['ghost']);
  });

  it('survives an empty catalog and an empty request', () => {
    expect(limitSelectionToProducts([], [], 100)).toEqual([]);
    expect(limitSelectionToProducts(undefined, undefined, 100)).toEqual([]);
  });
});

const variations = [
  { id: 'control', name: 'Control' },
  { id: 'var_a', name: 'Variation A' },
];

const shirt = {
  product_id: 'prod-1',
  variant_id: 'var-1',
  title: 'Shirt',
  current_price: 20,
};
const pants = {
  product_id: 'prod-2',
  variant_id: 'var-2',
  title: 'Pants',
  current_price: 30,
};

describe('productsStepReadiness', () => {
  it('resolves all-mode rows by product, capped at maxSelection', () => {
    const rows = resolvePricingRows({
      pickMode: 'all',
      maxSelection: 1,
      opportunities: [shirt, pants],
    });
    expect(rows.map(row => row.variant_id)).toEqual(['var-1']);
  });

  it('resolves manual rows for every variant of a selected product', () => {
    const sibling = { ...shirt, variant_id: 'var-1b', current_price: 22 };
    const rows = resolvePricingRows({
      pickMode: 'manual',
      selectedIds: ['var-1'],
      opportunities: [shirt, sibling, pants],
    });
    expect(rows.map(row => row.variant_id)).toEqual(['var-1', 'var-1b']);
  });

  it('resolves manual rows when saved ids are numeric but the catalog uses GIDs', () => {
    const gidShirt = {
      ...shirt,
      variant_id: 'gid://shopify/ProductVariant/101',
    };
    const gidSibling = {
      ...shirt,
      variant_id: 'gid://shopify/ProductVariant/102',
      current_price: 22,
    };
    const rows = resolvePricingRows({
      pickMode: 'manual',
      selectedIds: ['101'],
      opportunities: [gidShirt, gidSibling, pants],
    });
    expect(rows.map(row => row.variant_id)).toEqual([
      'gid://shopify/ProductVariant/101',
      'gid://shopify/ProductVariant/102',
    ]);
  });

  it('treats all-mode as selected only when the catalog has variant ids', () => {
    expect(
      hasProductSelection({ pickMode: 'all', opportunities: [shirt], selectedIds: [] })
    ).toBe(true);
    expect(hasProductSelection({ pickMode: 'all', opportunities: [], selectedIds: [] })).toBe(
      false
    );
  });

  it('requires a test-arm override that differs from the store price', () => {
    const selected = {
      opportunities: [shirt],
      selectedIds: ['var-1'],
      pickMode: 'manual',
      variations,
    };
    expect(hasAnyTestPriceChange({ ...selected, priceOverrides: {} })).toBe(false);
    expect(
      hasAnyTestPriceChange({ ...selected, priceOverrides: { 'var-1::var_a': '20' } })
    ).toBe(false);
    expect(
      hasAnyTestPriceChange({ ...selected, priceOverrides: { 'var-1::control': '18' } })
    ).toBe(false);
    expect(
      hasAnyTestPriceChange({ ...selected, priceOverrides: { 'var-1::var_a': '22' } })
    ).toBe(true);
  });

  it('maps network catalog failures to a retryable message', () => {
    expect(formatCatalogLoadError(new Error('Failed to fetch'))).toMatch(/Network error/);
    expect(formatCatalogLoadError(new Error('Request failed with status code 403'))).toMatch(
      /session cannot load/
    );
  });

  it('disables Continue while loading, on load error, and until selection + price', () => {
    const base = {
      pickMode: 'manual',
      opportunities: [shirt],
      selectedIds: [],
      variations,
      priceOverrides: {},
    };
    expect(
      getProductsStepContinueState({
        ...base,
        opportunities: [],
        loadingProducts: true,
      }).reason
    ).toBe('loading');
    expect(
      getProductsStepContinueState({ ...base, loadingProducts: true }).reason
    ).toBe('no_selection');
    expect(
      getProductsStepContinueState({
        ...base,
        opportunities: [],
        productsLoadError: 'Network failed',
      }).reason
    ).toBe('load_error');
    expect(
      getProductsStepContinueState({ ...base, productsLoadError: 'Network failed' }).reason
    ).toBe('no_selection');
    expect(getProductsStepContinueState({ ...base, opportunities: [] }).reason).toBe(
      'empty_catalog'
    );
    expect(getProductsStepContinueState(base).reason).toBe('no_selection');
    expect(
      getProductsStepContinueState({ ...base, selectedIds: ['var-1'] }).reason
    ).toBe('no_price_change');
    expect(
      getProductsStepContinueState({
        ...base,
        selectedIds: ['var-1'],
        priceOverrides: { 'var-1::var_a': '24.00' },
      }).disabled
    ).toBe(false);
    expect(
      getProductsStepContinueState({
        ...base,
        selectedIds: ['var-1'],
        priceMode: 'ai',
      }).hint
    ).toMatch(/click Suggest/i);
  });

  it('normalizes AI min/max bands and rejects empty ranges', () => {
    expect(normalizeAiPriceBand('10', '20')).toEqual({ min: 10, max: 20 });
    // A min above the max is refused rather than silently swapped.
    expect(normalizeAiPriceBand('20', '8')).toBeNull();
    expect(normalizeAiPriceBand('0', '0')).toBeNull();
    // One edge on the current price is a band the merchant may well mean;
    // describeNarrowAiBand warns when it leaves too little room.
    expect(normalizeAiPriceBand('0', '5')).toEqual({ min: 0, max: 5 });
    expect(normalizeAiPriceBand('5', '0')).toBeNull();
    // A blank box is still not a zero, even though Number('') is.
    expect(normalizeAiPriceBand('', '20')).toBeNull();
    expect(normalizeAiPriceBand('abc', '5')).toBeNull();
  });

  it('says when both ends of the band are the same', () => {
    expect(describeCollapsedAiBand({ min: 16, max: 16 })).toMatch(
      /Both ends of the band are 16%, so every test variation would carry the same price/
    );
    expect(describeCollapsedAiBand({ min: 10, max: 16 })).toBe('');
  });

  it('explains individual prices moved outside the band', () => {
    const band = { min: 20, max: 30 };
    expect(describeGuardrailLimitedSuggestions(1, 4, band)).toBe(
      '1 of 4 suggested prices is outside your 20%–30% higher band, moved to stay clear of another variation’s price or above $0.'
    );
    expect(describeGuardrailLimitedSuggestions(3, 4, band)).toMatch(/^3 of 4 suggested prices are outside/);
    expect(describeGuardrailLimitedSuggestions(4, 4, band)).toMatch(/^Every suggested price is outside/);
    expect(describeGuardrailLimitedSuggestions(1, 4, band)).not.toMatch(/max price change|margin/);
  });

  it('stays silent when every suggestion stayed in the band', () => {
    expect(describeGuardrailLimitedSuggestions(0, 4, { min: 20, max: 30 })).toBe('');
    expect(describeGuardrailLimitedSuggestions(2, 0, { min: 20, max: 30 })).toBe('');
  });

  it('finds overrides even when variant ids use different shapes', () => {
    const key = priceOverrideKey('gid://shopify/ProductVariant/42', 'var_a');
    expect(key).toBe('gid://shopify/ProductVariant/42::var_a');
    expect(parsePriceOverrideKey(key)).toEqual({
      variantId: 'gid://shopify/ProductVariant/42',
      armId: 'var_a',
    });
    expect(variantIdsMatch('42', 'gid://shopify/ProductVariant/42')).toBe(true);
    expect(
      lookupPriceOverride({ [key]: '44.99' }, '42', 'var_a')
    ).toBe('44.99');
    expect(
      lookupPriceOverride({ 'var-1::var_a': '24.00' }, 'var-1', 'var_a')
    ).toBe('24.00');
  });

  it('reconciles saved selection ids to the catalog canonical GIDs', () => {
    const catalog = [
      { variant_id: 'gid://shopify/ProductVariant/55', product_id: 'p1' },
      { variant_id: 'gid://shopify/ProductVariant/56', product_id: 'p1' },
    ];
    expect(reconcileSelectedVariantIds(['55'], catalog)).toEqual([
      'gid://shopify/ProductVariant/55',
    ]);
  });

  it('builds a local AI band patch for every selected SKU and arm', () => {
    const patch = buildAiBandPriceOverrides({
      rows: [{ variant_id: 'gid://shopify/ProductVariant/9', current_price: 40 }],
      targetArms: [{ id: 'var_a' }],
      min: 10,
      max: 20,
      unit: 'percent',
      maxChangePct: 15,
    });
    const price = Number(patch['gid://shopify/ProductVariant/9::var_a']);
    expect(price).toBeGreaterThanOrEqual(44);
    expect(price).toBeLessThanOrEqual(46);
  });

  it('varies price within a straddling band per product signals', () => {
    const patchCut = buildAiBandPriceOverrides({
      rows: [
        {
          variant_id: 'gid://shopify/ProductVariant/100',
          current_price: 100,
          opportunity_score: 0.9,
          units_sold_30d: 0,
          margin_percent: 50,
        },
      ],
      targetArms: [{ id: 'var_a' }],
      min: -20,
      max: 20,
      unit: 'percent',
      maxChangePct: 30,
    });
    const patchRise = buildAiBandPriceOverrides({
      rows: [
        {
          variant_id: 'gid://shopify/ProductVariant/101',
          current_price: 100,
          units_sold_30d: 40,
          margin_percent: 55,
        },
      ],
      targetArms: [{ id: 'var_a' }],
      min: -20,
      max: 20,
      unit: 'percent',
      maxChangePct: 30,
    });
    expect(Number(patchCut['gid://shopify/ProductVariant/100::var_a'])).toBeLessThan(100);
    expect(Number(patchRise['gid://shopify/ProductVariant/101::var_a'])).toBeGreaterThan(100);
    expect(patchCut['gid://shopify/ProductVariant/100::var_a']).not.toBe(
      patchRise['gid://shopify/ProductVariant/101::var_a']
    );
  });

  it('spaces two test arms in one local band patch', () => {
    const patch = buildAiBandPriceOverrides({
      rows: [{ variant_id: 'gid://shopify/ProductVariant/9', current_price: 100 }],
      targetArms: [{ id: 'var_a' }, { id: 'var_b' }],
      min: 10,
      max: 20,
      unit: 'percent',
      maxChangePct: 30,
    });
    const a = Number(patch['gid://shopify/ProductVariant/9::var_a']);
    const b = Number(patch['gid://shopify/ProductVariant/9::var_b']);
    expect(a).not.toBe(b);
    expect(a).toBeLessThan(b);
  });

  it('spans a cut-only band across one arm using SKU signals', () => {
    const position = variationPositionInBand({
      armIndex: 0,
      armCount: 1,
      min: -20,
      max: -10,
      row: { variant_id: 'gid://shopify/ProductVariant/100', current_price: 100 },
    });
    expect(position).toBeGreaterThan(0.2);
    expect(position).toBeLessThan(0.8);
    const patch = buildAiBandPriceOverrides({
      rows: [{ variant_id: 'gid://shopify/ProductVariant/100', current_price: 100 }],
      targetArms: [{ id: 'var_a' }],
      min: -20,
      max: -10,
      unit: 'percent',
      maxChangePct: 30,
    });
    const cutPrice = Number(patch['gid://shopify/ProductVariant/100::var_a']);
    expect(cutPrice).toBeGreaterThan(80);
    expect(cutPrice).toBeLessThan(90);
  });

  it('lets the local fallback cut a thin-margin product', () => {
    const patch = buildAiBandPriceOverrides({
      rows: [
        {
          variant_id: 'gid://shopify/ProductVariant/100',
          current_price: 100,
          margin_percent: 0,
        },
      ],
      targetArms: [{ id: 'var_a' }],
      min: -20,
      max: -10,
      unit: 'percent',
      maxChangePct: 30,
    });
    const price = Number(patch['gid://shopify/ProductVariant/100::var_a']);
    expect(price).toBeGreaterThan(80);
    expect(price).toBeLessThan(90);
  });

  it('explains how band spread becomes a shelf price', () => {
    expect(describeAiPriceCalculationTooltip({ unit: 'percent', band: { min: 10, max: 20 } })).toBe(
      'AI generates test prices based on perceived value, sales volume, and revenue per visitor, constrained by your 10%–20% guardrails and rounded to standard price endings (.99).'
    );
    const meta = buildLocalPriceSuggestionMeta(
      {
        rows: [{ variant_id: 'gid://shopify/ProductVariant/1', current_price: 100 }],
        targetArms: [{ id: 'var_a' }],
        min: 10,
        max: 20,
        unit: 'percent',
        maxChangePct: 30,
      },
      'local'
    );
    const key = 'gid://shopify/ProductVariant/1::var_a';
    expect(meta[key]?.price).toBeGreaterThan(110);
    expect(meta[key]?.price).toBeLessThan(120);
    const tip = describePriceSuggestionTooltip(meta[key], { base: 100 });
    expect(tip).toMatch(/Catalog \$100\.00/);
    expect(tip).toMatch(/Band point/i);
  });

  it('maps API suggestions into per-cell explain metadata', () => {
    const meta = metaFromPriceSuggestions(
      [
        {
          variant_id: 'gid://shopify/ProductVariant/99',
          arm_id: 'var_a',
          price: 89.99,
          delta_percent: -10.01,
          guardrail_limited: true,
          ai_band: { lo: -12, hi: -8 },
          ai_best_delta_percent: -9,
          ai_direction: 'cut',
          ai_confidence: 'high',
          ai_market_benchmarks: {
            market_low_price: 80,
            market_avg_price: 95,
            market_high_price: 120,
            positioning: 'overpriced',
            perceived_tier: 'mid_market',
          },
        },
      ],
      'openai'
    );
    const metaKey = 'gid://shopify/ProductVariant/99::var_a';
    expect(meta[metaKey].source).toBe('openai');
    expect(meta[metaKey].guardrailLimited).toBe(true);
    const tip = describePriceSuggestionTooltip(meta[metaKey], { base: 100 });
    expect(tip).toMatch(/AI chose a test range/);
    expect(tip).toMatch(/Product range: -12% to -8%/);
    expect(tip).toMatch(/high confidence · cut direction/i);
    expect(tip).toMatch(/expected-best change: -9\.0%/i);
    expect(tip).toMatch(/market research range: 80\.00 \/ 95\.00 \/ 120\.00/i);
    expect(tip).toMatch(/Moved outside your band to stay clear of another variation’s price/);
    expect(tip).not.toMatch(/max price change/i);
  });

  it('keeps signed zero and negative band edges when resolving', () => {
    expect(resolveBandEdge(0, 10)).toBe(0);
    expect(resolveBandEdge(-12, 10)).toBe(-12);
    expect(resolveBandEdge('', 10)).toBe(10);
  });

  it('keeps AI suggest copy per variation instead of a shared summary', () => {
    expect(
      armHasAiPrices({
        rows: [shirt],
        armId: 'var_a',
        priceOverrides: { 'var-1::var_a': '24.00' },
      })
    ).toBe(true);
    expect(
      armHasAiPrices({
        rows: [shirt],
        armId: 'var_b',
        priceOverrides: { 'var-1::var_a': '24.00' },
      })
    ).toBe(false);
    expect(
      getAiSuggestCopy({
        hasProducts: true,
        suggested: false,
        hasArmPrices: false,
        summary: 'AI price suggestions applied.',
      }).body
    ).toBe('AI price suggestions applied.');
    expect(
      getAiSuggestCopy({
        hasProducts: true,
        suggested: false,
        hasArmPrices: true,
        summary: '',
      }).body
    ).toMatch(/Band updated/);
    expect(
      getAiSuggestCopy({
        hasProducts: true,
        suggested: false,
        hasArmPrices: false,
        summary: 'Select products first, then click Suggest.',
      }).body
    ).toMatch(/Select products first/);
    // No standing "set the band, then click Suggest" instruction before a run.
    expect(getAiSuggestCopy({ hasProducts: true }).body).toBe('');
    expect(getAiSuggestCopy({ hasProducts: false }).body).toBe('');
    expect(getAiSuggestCopy({ hasProducts: true }).button).toBe('Suggest');
  });

  describe('composeAiSuggestBanner', () => {
    it('shows a short limit error and keeps the full message in the tooltip', () => {
      const { status, detail } = composeAiSuggestBanner({
        source: 'deterministic',
        fallbackLine: 'Local 10% lower through 10% higher band fallback (AI unavailable).',
        errorMessage:
          'variants cannot cover more than 250 products in one request (received 832)',
        unit: 'percent',
      });
      expect(status).toBe('Too many products (832). Max 250 per suggest.');
      expect(detail).toMatch(/Local 10%/);
      expect(detail).toMatch(/832/);
    });

    it('names what was over the limit', () => {
      const statusFor = errorMessage =>
        composeAiSuggestBanner({ source: 'deterministic', errorMessage, unit: 'percent' }).status;

      expect(statusFor('variants cannot exceed 2500 rows in one request (received 2600)')).toBe(
        'Too many variants (2600). Max 2500 per suggest.'
      );
      expect(statusFor('arms cannot exceed 10 variations in one request (received 11)')).toBe(
        'Too many variations (11). Max 10 per suggest.'
      );
      // The wording the server used before the limit counted products.
      expect(statusFor('variants cannot exceed 500 products in one request (received 832)')).toBe(
        'Too many products (832). Max 500 per suggest.'
      );
    });

    const band = { min: 10, max: 20 };

    it('describes AI prices, then where they came from, then where to hover', () => {
      const { status, detail } = composeAiSuggestBanner({
        source: 'openai',
        baseSummary:
          'AI recommendations were applied to 25 products; remaining products received an even spread within your guardrails.',
        band,
      });
      expect(status).toBe('Prices applied (AI).');
      expect(detail).toBe(
        'AI generates test prices based on perceived value, sales volume, and revenue per visitor, constrained by your 10%–20% guardrails and rounded to standard price endings (.99).\n\n' +
          'AI recommendations were applied to 25 products; remaining products received an even spread within your guardrails. Hover over the ⓘ beside any price for details.'
      );
    });

    it('does not credit AI for a spread it never made, or give two reasons for it', () => {
      const { detail } = composeAiSuggestBanner({
        source: 'deterministic',
        fallbackLine: 'Even spread across your 10%–20% higher band (AI unavailable).',
        band,
      });
      expect(detail).toMatch(/^Test prices are spread evenly within your 10%–20% guardrails/);
      expect(detail).not.toMatch(/AI generates/);
      expect(detail).not.toMatch(/did not return usable prices/);
    });

    it('does not say prices were applied, or point at them, when none were', () => {
      const failed = composeAiSuggestBanner({
        source: 'deterministic',
        fallbackLine: 'Could not build local prices — check product prices and try again.',
        band,
        hasPrices: false,
      });
      expect(failed.status).not.toMatch(/applied/i);
      expect(failed.detail).not.toContain('Hover over');

      const empty = composeAiSuggestBanner({
        source: 'openai',
        baseSummary: 'No prices returned — try Re-suggest or adjust the band.',
        band,
        hasPrices: false,
      });
      expect(empty.status).toMatch(/^No prices returned/);
      expect(empty.detail).not.toContain('Hover over');

      const errorOnly = composeAiSuggestBanner({ errorMessage: 'Could not suggest prices.', band });
      expect(errorOnly.detail).not.toMatch(/even spread/);
    });
  });

  describe('describeAiSuggestionSource', () => {
    it('stays quiet when the prices really did come from the model', () => {
      expect(describeAiSuggestionSource({ source: 'openai' })).toBe('');
    });

    it('says a dollar band is spread by Priceify, not by AI', () => {
      expect(
        describeAiSuggestionSource({ source: 'deterministic', skippedReason: 'amount_band' })
      ).toMatch(/dollar band/i);
    });

    it('says when AI was unavailable or switched off', () => {
      expect(
        describeAiSuggestionSource({ source: 'deterministic', skippedReason: 'unavailable' })
      ).toMatch(/unavailable/i);
      expect(
        describeAiSuggestionSource({
          source: 'deterministic',
          skippedReason: 'disabled_by_request',
        })
      ).toMatch(/turned off/i);
    });

    it('says when the model answered but the answer was unusable', () => {
      expect(describeAiSuggestionSource({ source: 'deterministic' })).toMatch(
        /did not return usable prices/i
      );
    });
  });
});

/**
 * The opportunity list can reorder itself and pre-tick up to three products on
 * the strength of a ranking the merchant never sees. The reason is what turns
 * that from a list that rearranged itself into a recommendation.
 */
describe('why a product is being suggested', () => {
  it('shows a real explanation', () => {
    expect(
      productSuggestionReason({ ai_reason: 'Steady traffic and room on margin.' })
    ).toBe('Steady traffic and room on margin.');
  });

  it('trims the surrounding whitespace', () => {
    expect(productSuggestionReason({ ai_reason: '  Healthy margin here.  ' })).toBe(
      'Healthy margin here.'
    );
  });

  it('says nothing when there is no reason', () => {
    expect(productSuggestionReason({})).toBe('');
    expect(productSuggestionReason(null)).toBe('');
    expect(productSuggestionReason({ ai_reason: '' })).toBe('');
  });

  it('declines a placeholder rather than leaving an empty explanation', () => {
    // Worse than nothing: it occupies the line where a reason should be.
    expect(productSuggestionReason({ ai_reason: '-' })).toBe('');
    expect(productSuggestionReason({ ai_reason: 'n/a' })).toBe('');
    expect(productSuggestionReason({ ai_reason: '   1234567890   ' })).toBe('');
  });

  it('ignores a reason that is not text at all', () => {
    expect(productSuggestionReason({ ai_reason: 42 })).toBe('');
    expect(productSuggestionReason({ ai_reason: { why: 'nope' } })).toBe('');
  });
});

/**
 * The band is signed, so the copy has to say which way it points. "−20%–−10%"
 * is a row of dashes; naming the direction is what makes it readable, and it is
 * also the only confirmation a merchant gets that a typed minus was understood
 * as a price cut rather than dropped.
 */
describe('a band that lowers the price', () => {
  it('keeps a negative edge instead of flipping it', async () => {
    const { normalizeAiPriceBand: normalize } = await import('../productsStepReadiness');

    expect(normalize('-20', '-10')).toEqual({ min: -20, max: -10 });
    expect(normalize('-10', '-20')).toBeNull();
    expect(normalize('-15', '20')).toEqual({ min: -15, max: 20 });
  });

  it('names the direction it points', async () => {
    const { describeAiBandRange, aiBandDirection } = await import('../productsStepReadiness');

    expect(describeAiBandRange(-20, -10)).toBe('10%–20% lower');
    expect(describeAiBandRange(10, 20)).toBe('10%–20% higher');
    expect(describeAiBandRange(-15, 20)).toBe('15% lower through 20% higher');
    expect(aiBandDirection({ min: -20, max: -10 })).toBe('down');
    expect(aiBandDirection({ min: -15, max: 20 })).toBe('both');
    expect(aiBandDirection({ min: 10, max: 20 })).toBe('up');
  });

  it('warns when the band is too narrow for its variations', async () => {
    const { describeNarrowAiBand } = await import('../productsStepReadiness');

    // Room enough: an edge on the current price no longer wastes a variation,
    // because the spacing keeps every price at least 3% from it.
    expect(describeNarrowAiBand({ min: -10, max: 0 }, { armCount: 2 })).toBe('');
    expect(describeNarrowAiBand({ min: 10, max: 20 }, { armCount: 3 })).toBe('');
    expect(describeNarrowAiBand({ min: -10, max: 10 }, { armCount: 3 })).toBe('');

    // One price, but nowhere 3% from the current one.
    expect(describeNarrowAiBand({ min: -2, max: 0 }, { armCount: 1 })).toMatch(
      /no room for a test price at least 3% from your current price.*Widen it to 0%–3% lower\.$/
    );

    // Three prices 4.5% apart and 3% clear need 3%..12% on one side, or one
    // below and two above.
    expect(describeNarrowAiBand({ min: -5, max: 5 }, { armCount: 3 })).toMatch(
      /With 3 test variations.*about 4\.5% apart.*Widen it to 5% lower through 7\.5% higher or test fewer variations\./
    );
    expect(describeNarrowAiBand({ min: 2, max: 8 }, { armCount: 3 })).toMatch(
      /Widen it to 2%–12% higher/
    );

    // Max price change does not limit an AI band, so widening always fixes it.
    expect(describeNarrowAiBand({ min: 5, max: 10 }, { armCount: 4 })).toMatch(
      /Widen it to .* or test fewer variations\.$/
    );
    expect(describeNarrowAiBand({ min: 5, max: 10 }, { armCount: 4 })).not.toMatch(/max price change/);

    // A dollar band asks for no spacing, so there is nothing to warn about.
    expect(describeNarrowAiBand({ min: 1, max: 2 }, { unit: 'amount', armCount: 3 })).toBe('');
  });
});

/**
 * A variation left blank does not launch blank. `rebuildPlanArmsFromVariations`
 * falls back to the catalog price for any arm without an override, so the arm
 * goes live at exactly the control price -- a second control under a
 * variation's name, taking its share of the traffic and measuring nothing.
 * Nothing downstream catches it: the guardrail checks only ask whether a price
 * is inside the allowed band, and the current price always is.
 */
describe('variations still missing a test price', () => {
  const threeArms = [
    { id: 'control', name: 'Control' },
    { id: 'var_a', name: 'Variation A' },
    { id: 'var_b', name: 'Variation B' },
  ];
  const twoProducts = {
    opportunities: [shirt, pants],
    selectedIds: ['var-1', 'var-2'],
    pickMode: 'manual',
    variations: threeArms,
  };

  const gate = priceOverrides =>
    getProductsStepContinueState({ ...twoProducts, priceOverrides });

  it('blocks Continue when one variation is priced and another is not', async () => {
    const { findUnpricedTestArms } = await import('../productsStepReadiness');
    const priceOverrides = { 'var-1::var_a': '22', 'var-2::var_a': '33' };

    // The old gate asked only whether ANY arm had ANY differing price, so this
    // passed and Variation B launched at the catalog price.
    expect(hasAnyTestPriceChange({ ...twoProducts, priceOverrides })).toBe(true);

    expect(gate(priceOverrides).disabled).toBe(true);
    expect(gate(priceOverrides).reason).toBe('incomplete_arm_prices');
    expect(findUnpricedTestArms({ ...twoProducts, priceOverrides })).toEqual([
      { id: 'var_b', label: 'Variation B', missing: 2, total: 2 },
    ]);
  });

  it('blocks when a variation is priced on some products but not all', async () => {
    const { findUnpricedTestArms } = await import('../productsStepReadiness');
    const priceOverrides = {
      'var-1::var_a': '22',
      'var-2::var_a': '33',
      'var-1::var_b': '25',
    };

    expect(gate(priceOverrides).reason).toBe('incomplete_arm_prices');
    expect(findUnpricedTestArms({ ...twoProducts, priceOverrides })).toEqual([
      { id: 'var_b', label: 'Variation B', missing: 1, total: 2 },
    ]);
  });

  it('treats a price equal to the current price as missing', () => {
    // $20 on a $20 product reaches the storefront identically to a blank, so
    // it is the same duplicate control either way.
    expect(
      gate({
        'var-1::var_a': '22',
        'var-2::var_a': '33',
        'var-1::var_b': '20',
        'var-2::var_b': '30',
      }).reason
    ).toBe('incomplete_arm_prices');
  });

  it('allows Continue once every variation is priced on every product', () => {
    expect(
      gate({
        'var-1::var_a': '22',
        'var-2::var_a': '33',
        'var-1::var_b': '25',
        'var-2::var_b': '36',
      })
    ).toEqual({ disabled: false, reason: null, hint: '' });
  });

  it('still reports nothing priced at all as the emptier problem', () => {
    // The merchant has not started, so naming each variation would be noise.
    expect(gate({}).reason).toBe('no_price_change');
  });

  it('ignores the control, which is meant to stay at the catalog price', () => {
    expect(
      gate({
        'var-1::control': '19',
        'var-1::var_a': '22',
        'var-2::var_a': '33',
        'var-1::var_b': '25',
        'var-2::var_b': '36',
      }).disabled
    ).toBe(false);
  });

  it('names the variations and says what a blank one would do', async () => {
    const { describeUnpricedTestArms } = await import('../productsStepReadiness');

    const one = describeUnpricedTestArms([
      { id: 'var_b', label: 'Variation B', missing: 2, total: 2 },
    ]);
    expect(one).toBe(
      'Variation B has no test prices.\nChoose a pricing method (AI suggestions, bulk adjustment, or manual) or remove Variation B to continue.'
    );

    const two = describeUnpricedTestArms([
      { id: 'var_b', label: 'Variation B', missing: 2, total: 2 },
      { id: 'var_c', label: 'Variation C', missing: 1, total: 2 },
    ]);
    expect(two).toMatch(/^Variation B and Variation C on 1 of 2 products have no test prices\./);
    expect(two).toMatch(/or remove Variation B and Variation C to continue\.$/);
    expect(describeUnpricedTestArms([])).toBe('');
  });
});

describe('resolveAiSuggestTargetArms', () => {
  it('defaults to one AI variation when no active tab is supplied', () => {
    const variations = [
      { id: 'control' },
      { id: 'var_a' },
      { id: 'var_b' },
    ];
    const arms = resolveAiSuggestTargetArms({
      variations,
      pricingByArm: {
        var_a: { priceMode: 'ai' },
        var_b: { priceMode: 'ai' },
      },
    });
    expect(arms.map(a => a.id)).toEqual(['var_a']);
  });

  it('prices only AI arms when modes are mixed', () => {
    const arms = resolveAiSuggestTargetArms({
      variations: [{ id: 'control' }, { id: 'var_a' }, { id: 'var_b' }],
      pricingByArm: {
        var_a: { priceMode: 'manual' },
        var_b: { priceMode: 'ai' },
      },
    });
    expect(arms.map(a => a.id)).toEqual(['var_b']);
  });

  it('tells the server where the other variations are already priced', () => {
    const spreadArms = [{ id: 'var_a' }, { id: 'var_b' }, { id: 'var_c' }];
    const rows = [
      { variant_id: 'gid://shopify/ProductVariant/1' },
      { variant_id: 'gid://shopify/ProductVariant/2' },
    ];
    const priceOverrides = {
      'gid://shopify/ProductVariant/1::var_a': '44.99',
      'gid://shopify/ProductVariant/1::var_b': '46.99',
      'gid://shopify/ProductVariant/1::var_c': '',
    };

    expect(
      siblingArmPrices({ rows, spreadArms, targetArms: [{ id: 'var_b' }], priceOverrides })
    ).toEqual({ 'gid://shopify/ProductVariant/1': [44.99] });
    expect(
      siblingArmPrices({ rows, spreadArms: [{ id: 'var_b' }], targetArms: [{ id: 'var_b' }] })
    ).toBeNull();
  });

  it('spreads across every test variation and keeps only the one being priced', () => {
    const variations = [{ id: 'control' }, { id: 'var_a' }, { id: 'var_b' }];
    expect(resolveAiSuggestSpreadArms(variations).map(a => a.id)).toEqual(['var_a', 'var_b']);
    const keep = keepArmKeys([{ id: 'var_b' }]);
    expect(
      keep({
        'gid://shopify/ProductVariant/1::var_a': '44.99',
        'gid://shopify/ProductVariant/1::var_b': '46.99',
      })
    ).toEqual({ 'gid://shopify/ProductVariant/1::var_b': '46.99' });
  });

  it('prices only the variation on screen when one is given', () => {
    const variations = [{ id: 'control' }, { id: 'var_a' }, { id: 'var_b' }];
    const pricingByArm = { var_a: { priceMode: 'ai' }, var_b: { priceMode: 'ai' } };
    expect(
      resolveAiSuggestTargetArms({ variations, pricingByArm, activeArmIndex: 2 }).map(a => a.id)
    ).toEqual(['var_b']);
    // Control has no test price, so Suggest from its tab prices the first variation.
    expect(
      resolveAiSuggestTargetArms({ variations, pricingByArm, activeArmIndex: 0 }).map(a => a.id)
    ).toEqual(['var_a']);
  });
});

describe('removing a variation', () => {
  const arms = [{ id: 'control' }, { id: 'var_b' }, { id: 'var_c' }];

  it('names the challengers that went, never control', () => {
    expect(removedArmIds(arms, [{ id: 'control' }, { id: 'var_c' }])).toEqual(['var_b']);
    expect(removedArmIds(arms, [])).toEqual(['var_b', 'var_c']);
    expect(removedArmIds(arms, arms)).toEqual([]);
  });

  it('drops its prices, so a refilled letter starts fresh', () => {
    const overrides = {
      'gid://shopify/ProductVariant/1::var_b': '12.00',
      'gid://shopify/ProductVariant/1::var_c': '14.00',
      legacy: '9.00',
    };
    expect(dropArmEntries(overrides, ['var_b'], { byOverrideKey: true })).toEqual({
      'gid://shopify/ProductVariant/1::var_c': '14.00',
      legacy: '9.00',
    });
  });

  it('drops its per-variation settings by arm id', () => {
    expect(dropArmEntries({ var_b: { priceMode: 'ai' }, var_c: {} }, ['var_b'])).toEqual({
      var_c: {},
    });
  });

  it('hands back the same map when nothing matched', () => {
    const map = { var_c: {} };
    expect(dropArmEntries(map, ['var_b'])).toBe(map);
    expect(dropArmEntries(map, [])).toBe(map);
  });
});

describe('QA round: step 3 price inputs', () => {
  it('refuses a band whose min is above its max, and says so', () => {
    expect(aiBandOrderError('25', '10')).toBe('Min (25%) can’t be more than max (10%).');
    expect(aiBandOrderError('-5', '-10', { unit: 'amount' })).toBe(
      'Min (−$5) can’t be more than max (−$10).'
    );
    expect(aiBandOrderError('10', '25')).toBe('');
    expect(aiBandOrderError('', '10')).toBe('');
    const reason = aiSuggestBlockedReason({
      hasProducts: true,
      hasBand: false,
      bandError: aiBandOrderError('25', '10'),
    });
    expect(reason).toMatch(/can’t be more than max/);
  });

  it('keeps only what can be a price in a price field', () => {
    expect(sanitizePriceInput('12.345')).toBe('12.34');
    expect(sanitizePriceInput('-15')).toBe('15');
    expect(sanitizePriceInput('abc')).toBe('');
    expect(sanitizePriceInput('1.2.3')).toBe('1.23');
    expect(sanitizePriceInput('.5')).toBe('0.5');
    expect(sanitizePriceInput('')).toBe('');
    expect(sanitizePriceInput('99999999')).toBe('999999.99');
  });

  it('does not hold Continue for how far a typed or bulk price moves', () => {
    const variant = 'gid://shopify/ProductVariant/1';
    const opportunities = [{ variant_id: variant, product_id: 'p1', title: 'Mug', current_price: 100 }];
    const variations = [{ id: 'control' }, { id: 'arm_b', letter: 'A', name: 'Variation A' }];
    const base = { opportunities, selectedIds: [variant], pickMode: 'manual', variations };
    ['500', '1', '99999'].forEach(price => {
      expect(
        getProductsStepContinueState({ ...base, priceOverrides: { [`${variant}::arm_b`]: price } }).disabled
      ).toBe(false);
    });
  });

  it('spreads an uncapped AI band past max price change, above $0', () => {
    const rows = [{ variant_id: 'v1', current_price: 100 }];
    const targetArms = [{ id: 'arm_b' }, { id: 'arm_c' }];
    const capped = spreadAiBandPriceEntries({ rows, targetArms, min: 30, max: 50, maxChangePct: 15 });
    capped.forEach(entry => expect(entry.price).toBeLessThanOrEqual(115));
    const uncapped = spreadAiBandPriceEntries({ rows, targetArms, min: 30, max: 50, uncapped: true });
    uncapped.forEach(entry => {
      expect(entry.price).toBeGreaterThanOrEqual(130);
      expect(entry.price).toBeLessThanOrEqual(150);
    });
    const deepCut = spreadAiBandPriceEntries({ rows, targetArms, min: -99, max: -90, uncapped: true });
    deepCut.forEach(entry => expect(entry.price).toBeGreaterThan(0));
  });

  it('refuses a band cut of 100% or more', () => {
    expect(aiBandOrderError('-100', '-20')).toMatch(/can’t be more than 99%/);
    expect(aiBandOrderError(String(AI_BAND_MIN_PERCENT), '-20')).toBe('');
    expect(aiBandOrderError('-150', '-20', { unit: 'amount' })).toBe('');
  });

  it('treats a GID and its number as one variant, but nothing looser', () => {
    expect(variantIdentity('123')).toBe(variantIdentity('gid://shopify/ProductVariant/123'));
    expect(variantIdentity('var-1')).not.toBe(variantIdentity('var-1b'));
    const rows = resolvePricingRows({
      pickMode: 'all',
      maxSelection: 10,
      opportunities: [
        { variant_id: 'gid://shopify/ProductVariant/7', product_id: 'p', title: 'Tee — S' },
        { variant_id: '7', product_id: 'p', title: 'Tee — S' },
        { variant_id: 'gid://shopify/ProductVariant/8', product_id: 'p', title: 'Tee — M' },
      ],
    });
    expect(rows).toHaveLength(2);
  });

  it('refuses a $0 test price even before max price change has loaded', () => {
    const gate = getProductsStepContinueState({
      opportunities: [
        { variant_id: 'gid://shopify/ProductVariant/1', product_id: 'p1', title: 'Mug', current_price: 10 },
      ],
      selectedIds: ['gid://shopify/ProductVariant/1'],
      pickMode: 'manual',
      variations: [{ id: 'control' }, { id: 'arm_b', letter: 'A', name: 'Variation A' }],
      priceOverrides: { 'gid://shopify/ProductVariant/1::arm_b': '0' },
      maxChangePercent: null,
    });
    expect(gate.disabled).toBe(true);
    expect(gate.reason).toBe('zero_test_price');
    expect(gate.hint).toBe('1 test price is $0 (Mug). Enter a price above $0.');
  });
});
