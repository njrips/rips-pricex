import { describe, expect, it } from 'vitest';
import {
  formatCatalogLoadError,
  getProductsStepContinueState,
  normalizeAiPriceBand,
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
    expect(normalizeAiPriceBand('abc', '5')).toBeNull();
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
