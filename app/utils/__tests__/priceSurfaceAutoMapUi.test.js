import { describe, expect, it } from 'vitest';
import {
  autoMapPrimaryActionLabel,
  autoMapRowBadge,
  buildAutoMapCheckedLine,
  buildAutoMapHeadline,
  buildDefaultAcceptedSlots,
  describeAutoMapRow,
  shouldAutoPersistAutoMapResult,
  summarizeAutoMapResult,
} from '../priceSurfaceAutoMapUi';

describe('priceSurfaceAutoMapUi', () => {
  const baseResult = {
    ready_to_save: true,
    password_gate: false,
    theme_drift: { detected: false },
    surfaces: [
      { surface: 'pdp', role: 'regular', status: 'matched', selector: '.price-item--regular' },
      { surface: 'plp', role: 'regular', status: 'matched', selector: '.card__price' },
      { surface: 'cart', role: 'regular', status: 'missing', selector: '' },
    ],
  };

  it('defaults acceptance to matched slots only', () => {
    const slots = buildDefaultAcceptedSlots(baseResult.surfaces);
    expect(slots.has('pdp:regular')).toBe(true);
    expect(slots.has('cart:regular')).toBe(false);
  });

  it('auto-persists when server says ready (setup link or Auto-detect)', () => {
    expect(shouldAutoPersistAutoMapResult(baseResult)).toBe(true);
  });

  it('writes a one-line headline from the summary', () => {
    expect(buildAutoMapHeadline(summarizeAutoMapResult(baseResult))).toBe(
      'Found 2 of 3 price locations on your store.'
    );
    expect(buildAutoMapHeadline({ matchedCount: 3, total: 3 })).toMatch(/all 3/);
    expect(buildAutoMapHeadline({ matchedCount: 0, total: 3 })).toMatch(/Pick them/);
  });

  it('explains what Verified was checked against', () => {
    const line = buildAutoMapCheckedLine({
      price_check: { product: true, product_title: 'Blue Tee', listing: true, cart: true },
    });
    expect(line).toMatch(/“Blue Tee”/);
    expect(line).toMatch(/cart/);
    expect(buildAutoMapCheckedLine({})).toMatch(/live storefront/);
    expect(
      buildAutoMapCheckedLine({ price_check: { product: true }, ai_assisted_slots: ['home:regular'] })
    ).toMatch(/AI helped choose 1 location /);
  });

  it('badges and describes rows by verification', () => {
    const verified = {
      status: 'matched',
      selector: '.price-item--regular',
      verification: 'price_match',
      sample_text: '$24.00',
    };
    expect(autoMapRowBadge(verified)).toEqual({ tone: 'success', label: 'Verified' });
    expect(describeAutoMapRow(verified)).toBe('Shows $24.00, which matches your product.');
    expect(autoMapRowBadge({ ...verified, verification: 'pattern' }).label).toBe('Found');
    expect(autoMapRowBadge({ status: 'ambiguous', selector: '.x' }).label).toBe('Check');
    expect(autoMapRowBadge({ status: 'missing' }).label).toBe('Not found');
    expect(
      describeAutoMapRow({ status: 'missing', role: 'compare_at', verification: 'not_on_sale' })
    ).toMatch(/not on sale/);
    expect(describeAutoMapRow({ ...verified, layouts_checked: 2 })).toBe(
      'Shows $24.00; matches on both a sale and a full-price product.'
    );
  });

  it('says why a row could not be checked, not just that it was not found', () => {
    const gap = verification => describeAutoMapRow({ status: 'missing', verification });
    expect(gap('no_sale_products')).toMatch(/None of your in-stock products has a compare-at price/);
    expect(gap('no_buyable_product')).toMatch(/sold out/);
    expect(gap('no_sample_product')).toMatch(/Choose a product/);
    expect(gap('cart_not_filled')).toMatch(/test cart/);
    // Found but unconfirmed: say what was found and why it was not checked.
    expect(
      describeAutoMapRow({
        status: 'matched',
        selector: 's.price-item--regular',
        verification: 'no_sale_products',
      })
    ).toBe('Found on the page. Not checked: none of your in-stock products is on sale.');
    // A password problem still wins over any of these.
    expect(
      describeAutoMapRow({
        status: 'missing',
        verification: 'no_sample_product',
        probe: { reason: 'password_required' },
      })
    ).toMatch(/password-protected/);
  });

  it('names both products when the check used two', () => {
    expect(
      buildAutoMapCheckedLine({
        price_check: { product: true, product_title: 'Sale Tee', other_product_title: 'Plain Tee' },
      })
    ).toMatch(/“Sale Tee” and “Plain Tee”/);
    expect(
      buildAutoMapCheckedLine({ price_check: { product: false, store_has_buyable_product: false } })
    ).toMatch(/sold out/);
  });

  it('blocks quick-save when theme drift or ambiguous', () => {
    expect(
      shouldAutoPersistAutoMapResult({
        ...baseResult,
        theme_drift: { detected: true },
      })
    ).toBe(false);
    expect(
      shouldAutoPersistAutoMapResult({
        ...baseResult,
        surfaces: [
          ...baseResult.surfaces,
          { surface: 'home', role: 'regular', status: 'ambiguous', selector: '.price' },
        ],
      })
    ).toBe(false);
  });

  it('summarizes counts for the modal header', () => {
    expect(summarizeAutoMapResult(baseResult)).toMatchObject({
      matchedCount: 2,
      missingCount: 1,
      hasPdpRegular: true,
    });
  });

  it('labels the primary action from accepted count', () => {
    expect(autoMapPrimaryActionLabel(baseResult, 2)).toBe('Save 2 locations');
    expect(autoMapPrimaryActionLabel({ ready_to_save: false }, 1)).toBe('Save 1 location');
    expect(autoMapPrimaryActionLabel(baseResult, 0)).toBe('Nothing to save yet');
  });
});
