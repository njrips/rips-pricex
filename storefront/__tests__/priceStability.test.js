// @vitest-environment jsdom
/**
 * Tests for the parts of the storefront script that decide *whether* and *from
 * what* to compute a test price. Getting these wrong shows a shopper a number
 * the merchant never set, which is worse than showing no test at all.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadStorefrontFunctions } from './storefrontHarness.js';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('stable catalog price', () => {
  const api = () => loadStorefrontFunctions(['getStableCatalogPriceForElement']);

  // The cart repaints on every drawer open, `cart:updated` and cart-icon click.
  // Percent and amount arms derive the line price from what the row shows, so
  // reading the painted value back took another cut each pass: 25% off $80 gave
  // $60, then $45, then $33.75. The first native reading has to stick.
  it('keeps the first native reading after the node has been painted', () => {
    const { getStableCatalogPriceForElement } = api();
    document.body.innerHTML = '<span class="price">$80.00</span>';
    const el = document.querySelector('.price');

    expect(getStableCatalogPriceForElement(el)).toBe(80);

    el.textContent = '$60.00';
    expect(getStableCatalogPriceForElement(el)).toBe(80);

    el.textContent = '$45.00';
    expect(getStableCatalogPriceForElement(el)).toBe(80);
  });

  it('reads the native price again from a row the theme re-rendered', () => {
    const { getStableCatalogPriceForElement } = api();
    document.body.innerHTML = '<span class="price">$80.00</span>';
    expect(getStableCatalogPriceForElement(document.querySelector('.price'))).toBe(80);

    // A replaced node carries no cached reading, and its text is native again.
    document.body.innerHTML = '<span class="price">$90.00</span>';
    expect(getStableCatalogPriceForElement(document.querySelector('.price'))).toBe(90);
  });

  it('returns null for a node with no amount rather than guessing zero', () => {
    const { getStableCatalogPriceForElement } = api();
    document.body.innerHTML = '<span class="price">Sold out</span>';
    expect(getStableCatalogPriceForElement(document.querySelector('.price'))).toBe(null);
  });
});

describe('converted presentment currency', () => {
  const api = () => loadStorefrontFunctions(['isConvertedPresentmentCurrency']);

  afterEach(() => {
    delete window.Shopify;
  });

  it('treats the shop default market as its own currency', () => {
    const { isConvertedPresentmentCurrency } = api();
    window.Shopify = { currency: { active: 'USD', rate: '1.0' } };
    expect(isConvertedPresentmentCurrency()).toBe(false);
  });

  // A configured test price of 70 is 70 in the shop's currency. Painted onto a
  // EUR page it reads as €70.00, which is not a converted $70 and not a price
  // anybody chose, so the test has to stand down in that market.
  it('detects a market showing converted prices', () => {
    const { isConvertedPresentmentCurrency } = api();
    window.Shopify = { currency: { active: 'EUR', rate: '0.92' } };
    expect(isConvertedPresentmentCurrency()).toBe(true);
  });

  it('assumes the default market when Shopify reports no rate', () => {
    const { isConvertedPresentmentCurrency } = api();
    window.Shopify = { currency: { active: 'USD' } };
    expect(isConvertedPresentmentCurrency()).toBe(false);
  });

  it('assumes the default market when there is no Shopify global at all', () => {
    const { isConvertedPresentmentCurrency } = api();
    expect(isConvertedPresentmentCurrency()).toBe(false);
  });

  it('ignores a rate that is not a usable number', () => {
    const { isConvertedPresentmentCurrency } = api();
    for (const rate of ['', 'abc', '0', '-1']) {
      window.Shopify = { currency: { active: 'USD', rate } };
      expect(isConvertedPresentmentCurrency(), rate).toBe(false);
    }
  });
});
