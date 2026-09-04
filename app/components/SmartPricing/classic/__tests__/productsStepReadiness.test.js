import { describe, expect, it } from 'vitest';
import {
  formatCatalogLoadError,
  getProductsStepContinueState,
  normalizeAiPriceBand,
  capAiBandToShopMax,
  describeAiBandCap,
  describeGuardrailLimitedSuggestions,
  resolveMaxPriceChangeRaise,
  resolveRaiseForAttempt,
  clampAiBandValue,
  describeAiBandClamp,
  describeCollapsedAiBand,
  MAX_PRICE_CHANGE_CEILING,
  armHasAiPrices,
  getAiSuggestCopy,
  hasAnyTestPriceChange,
  hasProductSelection,
  resolvePricingRows,
} from '../productsStepReadiness';

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
    expect(normalizeAiPriceBand('0', '5')).toBeNull();
    expect(normalizeAiPriceBand('5', '0')).toBeNull();
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
    expect(describeAiBandCap(cap)).toMatch(/entirely above your 15% max price change guardrail/i);
    expect(describeAiBandCap(cap)).toMatch(/suggestions use 10%–15% instead/i);
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
      /suggestions use 10\.7%–16% instead/i
    );
  });

  it('holds a band field at the cap instead of accepting a blocked value', () => {
    expect(clampAiBandValue('30', 16)).toEqual({ value: '16', attempted: 30 });
    expect(describeAiBandClamp(30, 16)).toMatch(
      /You entered 30%, above your 16% max price change guardrail\. The band is capped at 16%\./
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
      /suggestions use 10%–15% instead of 10%–25%/i
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
      }).button
    ).toBe('Suggest');
    expect(
      getAiSuggestCopy({
        hasProducts: true,
        suggested: false,
        hasArmPrices: true,
        summary: 'AI price suggestions applied.',
      }).body
    ).toMatch(/Band updated/);
  });
});
