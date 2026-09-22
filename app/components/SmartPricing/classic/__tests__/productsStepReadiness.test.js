import { describe, expect, it } from 'vitest';
import {
  formatCatalogLoadError,
  getProductsStepContinueState,
  productSuggestionReason,
  normalizeAiPriceBand,
  capAiBandToShopMax,
  describeAiBandCap,
  describeAiSuggestionSource,
  describeGuardrailLimitedSuggestions,
  resolveMaxPriceChangeRaise,
  resolveRaiseForAttempt,
  clampAiBandValue,
  describeAiBandClamp,
  describeCollapsedAiBand,
  MAX_PRICE_CHANGE_CEILING,
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
  filterPriceSuggestionsRespectingEdits,
  resolveAiSuggestTargetArms,
  hasAnyTestPriceChange,
  hasProductSelection,
  limitSelectionToProducts,
  resolvePricingRows,
  variantIdsMatch,
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
    expect(normalizeAiPriceBand('20', '8')).toEqual({ min: 8, max: 20 });
    expect(normalizeAiPriceBand('0', '0')).toBeNull();
    // One edge on the current price is a band the merchant may well mean;
    // describeZeroEdgeAiBand is what points out the wasted variation.
    expect(normalizeAiPriceBand('0', '5')).toEqual({ min: 0, max: 5 });
    expect(normalizeAiPriceBand('5', '0')).toEqual({ min: 0, max: 5 });
    // A blank box is still not a zero, even though Number('') is.
    expect(normalizeAiPriceBand('', '20')).toBeNull();
    expect(normalizeAiPriceBand('abc', '5')).toBeNull();
  });

  it('caps the AI band at shop max price change', () => {
    expect(capAiBandToShopMax({ min: 10, max: 25 }, 15)).toMatchObject({
      min: 10,
      max: 15,
      capPct: 15,
      maxClamped: true,
      feasible: true,
    });
    expect(
      capAiBandToShopMax({ min: 4, max: 8 }, 15, { unit: 'amount', averagePrice: 40 })
    ).toMatchObject({
      min: 4,
      max: 6,
      capPct: 15,
    });
  });

  it('scales a wholly-blocked band down instead of shifting it', () => {
    const cap = capAiBandToShopMax({ min: 20, max: 30 }, 15);
    expect(cap.feasible).toBe(false);
    expect(cap.requestedMin).toBe(20);
    // Scaling keeps the minimum as high as the cap allows (20/30 of 15%).
    // Shifting by the requested 10-point width would have started at 5%.
    expect(cap.min).toBe(10);
    expect(cap.max).toBe(15);
    // "Beyond", not "above": a band can now sit entirely below the guardrail.
    expect(describeAiBandCap(cap)).toMatch(/entirely beyond your 15% max price change guardrail/i);
    expect(describeAiBandCap(cap)).toMatch(/suggestions use 10%–15% higher instead/i);
    // Settings no longer carries this field, so the copy must point at the
    // one-click raise beside it rather than sending the merchant nowhere.
    expect(describeAiBandCap(cap)).toMatch(/Raise the max price change to test 20%–30%/i);
    expect(describeAiBandCap(cap)).not.toMatch(/in Settings/i);
    // The infeasible case has to offer that button, or the advice is empty.
    expect(resolveMaxPriceChangeRaise(cap)).toMatchObject({ target: 30, currentPct: 15 });
  });

  it('keeps the scaled band above a usable floor for an extreme request', () => {
    const cap = capAiBandToShopMax({ min: 40, max: 90 }, 16);
    expect(cap.min).toBe(7.1);
    expect(cap.max).toBe(16);
  });

  it('rounds the scaled minimum to something a merchant can read', () => {
    // 16 x 20/30 is 10.666…, which must not surface as "10.67%".
    expect(capAiBandToShopMax({ min: 20, max: 30 }, 16).min).toBe(10.7);
    expect(describeAiBandCap(capAiBandToShopMax({ min: 20, max: 30 }, 16))).toMatch(
      /suggestions use 10\.7%–16% higher instead/i
    );
  });

  it('holds a band field at the cap instead of accepting a blocked value', () => {
    expect(clampAiBandValue('30', 16)).toEqual({ value: '16', attempted: 30 });
    expect(describeAiBandClamp(30, 16)).toMatch(
      /You entered 30%, further from the current price than your 16% max price change guardrail allows\. The band is capped at 16%\./
    );
  });

  it('leaves a band field alone when it is within the cap', () => {
    expect(clampAiBandValue('12', 16)).toEqual({ value: '12', attempted: null });
    expect(describeAiBandClamp(12, 16)).toBe('');
  });

  it('keeps a half-typed or empty band field editable', () => {
    // Clamping mid-entry would make the field impossible to clear or retype.
    expect(clampAiBandValue('', 16)).toEqual({ value: '', attempted: null });
    expect(clampAiBandValue('1', 16)).toEqual({ value: '1', attempted: null });
  });

  it('clamps a dollar field against the cap converted at catalog prices', () => {
    // A 16% cap on a $50 average is $8, so $20 cannot be entered.
    expect(clampAiBandValue('20', 16, { unit: 'amount', averagePrice: 50 })).toEqual({
      value: '8',
      attempted: 20,
    });
    expect(describeAiBandClamp(20, 16, { unit: 'amount', averagePrice: 50 })).toMatch(
      /capped at \$8 \(16% of these products' average price\)/
    );
  });

  it('does not clamp a dollar field before product prices are known', () => {
    expect(clampAiBandValue('20', 16, { unit: 'amount', averagePrice: 0 })).toEqual({
      value: '20',
      attempted: null,
    });
  });

  it('says when clamping both ends leaves the variations identical', () => {
    // Typing 20–30 under a 16% cap holds both fields at 16, which is no test.
    const cap = capAiBandToShopMax({ min: 16, max: 16 }, 16);
    expect(describeCollapsedAiBand(cap)).toMatch(
      /Both ends of the band are 16%, so every test variation would carry the same price/
    );
    expect(describeCollapsedAiBand(capAiBandToShopMax({ min: 10, max: 16 }, 16))).toBe('');
  });

  it('offers to raise the cap to cover a blocked entry', () => {
    expect(resolveRaiseForAttempt(30, 16)).toMatchObject({
      target: 30,
      currentPct: 16,
      coversRequest: true,
    });
    expect(resolveRaiseForAttempt(12, 16)).toBeNull();
  });

  it('offers a cap raise that covers the requested band', () => {
    const raise = resolveMaxPriceChangeRaise(capAiBandToShopMax({ min: 20, max: 30 }, 16));
    expect(raise).toMatchObject({ target: 30, currentPct: 16, coversRequest: true });
  });

  it('caps the offered raise at the Settings ceiling and says it falls short', () => {
    const raise = resolveMaxPriceChangeRaise(capAiBandToShopMax({ min: 35, max: 45 }, 16));
    expect(raise).toMatchObject({ target: MAX_PRICE_CHANGE_CEILING, coversRequest: false });
  });

  it('offers no raise when the guardrail is not what is limiting the band', () => {
    expect(resolveMaxPriceChangeRaise(capAiBandToShopMax({ min: 5, max: 12 }, 16))).toBeNull();
    expect(resolveMaxPriceChangeRaise(null)).toBeNull();
  });

  it('converts a dollar band to percent before offering a raise', () => {
    // $10 max on a $50 catalog is a 20% lift, so a 16% cap must offer 20%.
    const cap = capAiBandToShopMax({ min: 6, max: 10 }, 16, { unit: 'amount', averagePrice: 50 });
    expect(resolveMaxPriceChangeRaise(cap, { unit: 'amount', averagePrice: 50 })).toMatchObject({
      target: 20,
      coversRequest: true,
    });
  });

  it('explains a trimmed band and stays silent when nothing was trimmed', () => {
    expect(describeAiBandCap(capAiBandToShopMax({ min: 10, max: 25 }, 15))).toMatch(
      /suggestions use 10%–15% higher instead of 10%–25% higher/i
    );
    expect(describeAiBandCap(capAiBandToShopMax({ min: 5, max: 12 }, 15))).toBe('');
  });

  it('explains individual prices a product guardrail pushed under the requested minimum', () => {
    const cap = capAiBandToShopMax({ min: 20, max: 30 }, 30);
    expect(describeGuardrailLimitedSuggestions(1, 4, cap)).toMatch(
      /1 of 4 suggested prices is below your 20% minimum/i
    );
    expect(describeGuardrailLimitedSuggestions(3, 4, cap)).toMatch(
      /3 of 4 suggested prices are below your 20% minimum/i
    );
    expect(describeGuardrailLimitedSuggestions(4, 4, cap)).toMatch(
      /Every suggested price is below your 20% minimum/i
    );
  });

  it('stays silent when every suggestion respected the requested minimum', () => {
    const cap = capAiBandToShopMax({ min: 20, max: 30 }, 30);
    expect(describeGuardrailLimitedSuggestions(0, 4, cap)).toBe('');
    expect(describeGuardrailLimitedSuggestions(2, 0, cap)).toBe('');
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

  it('explains how band spread becomes a shelf price', () => {
    expect(describeAiPriceCalculationTooltip({ unit: 'percent' })).toMatch(/traffic signals/i);
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
    expect(tip).toMatch(/guardrail/i);
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
        summary: 'Select products first, then re-suggest prices.',
      }).body
    ).toMatch(/Select products first/);
  });

  describe('composeAiSuggestBanner', () => {
    it('shows a short limit error and keeps the full message in the tooltip', () => {
      const { status, detail } = composeAiSuggestBanner({
        source: 'deterministic',
        fallbackLine: 'Local 10% lower through 10% higher band fallback (AI unavailable).',
        errorMessage:
          'variants cannot exceed 500 products in one request (received 832)',
        unit: 'percent',
      });
      expect(status).toBe('Too many products (832). Max 500 per suggest.');
      expect(detail).toMatch(/Local 10%/);
      expect(detail).toMatch(/832/);
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
    expect(normalize('-10', '-20')).toEqual({ min: -20, max: -10 });
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

  it('caps a cut at the same distance it caps a rise', async () => {
    const { capAiBandToShopMax: cap } = await import('../productsStepReadiness');

    // The guardrail limits distance from the current price, so it bounds both
    // sides. Only the upper edge was checked, which let -40% straight through.
    //
    // The partly-allowed band is the case that matters most, and the one an
    // absolute value silently broke: a 10-20% cut under a 15% guardrail came
    // back as { min: 15, max: 10 } -- inverted, and pointing the wrong way.
    expect(cap({ min: -20, max: -10 }, 15)).toMatchObject({ min: -15, max: -10 });
    expect(cap({ min: -40, max: -30 }, 15)).toMatchObject({ min: -15, max: -11.3 });
    expect(cap({ min: -40, max: 40 }, 15)).toMatchObject({ min: -15, max: 15 });
    // Trimmed, not blocked: most of a wide band is still testable.
    expect(cap({ min: -40, max: 40 }, 15).feasible).toBe(true);
    expect(cap({ min: -40, max: -30 }, 15).feasible).toBe(false);
  });

  it('reports a cut beyond the cap as beyond it, not above it', async () => {
    const { capAiBandToShopMax: cap, describeAiBandCap } = await import(
      '../productsStepReadiness'
    );

    const notice = describeAiBandCap(cap({ min: -30, max: -20 }, 15));
    expect(notice).toMatch(/entirely beyond your 15% max price change guardrail/i);
    expect(notice).toMatch(/20%–30% lower/);
  });

  it('holds a typed cut at the cap without losing its sign', async () => {
    const { clampAiBandValue: clamp } = await import('../productsStepReadiness');

    expect(clamp('-30', 16)).toEqual({ value: '-16', attempted: -30 });
    // Inside the cap it is left exactly as typed.
    expect(clamp('-12', 16)).toEqual({ value: '-12', attempted: null });
  });

  it('offers the guardrail raise for a blocked cut too', async () => {
    const { resolveRaiseForAttempt, resolveMaxPriceChangeRaise, capAiBandToShopMax: cap } =
      await import('../productsStepReadiness');

    // Reading the signed value meant a cut never triggered the offer at all.
    expect(resolveRaiseForAttempt(-22, 15)).toMatchObject({ target: 22, currentPct: 15 });
    expect(resolveMaxPriceChangeRaise(cap({ min: -25, max: -10 }, 15))).toMatchObject({
      target: 25,
    });
  });

  it('warns when an edge sits on the current price', async () => {
    const { describeZeroEdgeAiBand } = await import('../productsStepReadiness');

    // The arm on that edge duplicates the control, splitting traffic for
    // nothing -- discoverable before now only by reading the price table.
    expect(describeZeroEdgeAiBand({ min: -10, max: 0 })).toMatch(
      /one variation would carry your current price/i
    );
    expect(describeZeroEdgeAiBand({ min: -10, max: 0 })).toMatch(/Move that end lower/);
    expect(describeZeroEdgeAiBand({ min: 0, max: 10 })).toMatch(/Move that end higher/);
    expect(describeZeroEdgeAiBand({ min: -10, max: 10 })).toBe('');
    expect(describeZeroEdgeAiBand({ min: 5, max: 15 })).toBe('');
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
    expect(one).toMatch(/^Variation B has no test price yet/);
    expect(one).toMatch(/duplicate the control/);

    const two = describeUnpricedTestArms([
      { id: 'var_b', label: 'Variation B', missing: 2, total: 2 },
      { id: 'var_c', label: 'Variation C', missing: 1, total: 2 },
    ]);
    expect(two).toMatch(/Variation B and Variation C on 1 of 2 products have no test price yet/);

    expect(
      describeUnpricedTestArms([{ id: 'var_b', label: 'Variation B', missing: 2, total: 2 }], {
        priceMode: 'ai',
      })
    ).toMatch(/click Suggest/);
    expect(describeUnpricedTestArms([])).toBe('');
  });
});

describe('resolveAiSuggestTargetArms', () => {
  it('includes every AI variation in one suggest call', () => {
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
    expect(arms.map(a => a.id)).toEqual(['var_a', 'var_b']);
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
});

describe('filterPriceSuggestionsRespectingEdits', () => {
  it('skips cells the merchant edited after AI filled them', () => {
    const key = priceOverrideKey('v1', 'var_a');
    const suggestions = [
      { variant_id: 'v1', arm_id: 'var_a', price: 50 },
      { variant_id: 'v1', arm_id: 'var_b', price: 55 },
    ];
    const filtered = filterPriceSuggestionsRespectingEdits(
      suggestions,
      { [key]: '48.00' },
      {},
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].arm_id).toBe('var_b');
  });
});
