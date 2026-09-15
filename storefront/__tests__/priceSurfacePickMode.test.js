// @vitest-environment jsdom
/**
 * While the price surface picker is open, the merchant is choosing which node
 * on the page holds the price. Painting a test price over it breaks that in two
 * ways: they map a selector against a number that is not the catalog price, and
 * the paint fights the theme's own price updates -- each rewrite trips the
 * MutationObserver on the product root, which repaints, which trips it again.
 * That loop is what shows up as a price blinking under the cursor.
 */
import { afterEach, describe, it, expect } from 'vitest';
import { loadStorefrontFunctions } from './storefrontHarness.js';

/**
 * Put the page in a context a picker can actually be open in.
 *
 * The real ones are an editor iframe, a window the picker opened, or the
 * preview-document proxy. jsdom is none of those, so tests use the same escape
 * hatch the script already recognises.
 */
function withPickerOpen() {
  window.__RIPX_FORCE_PICKER__ = true;
}

afterEach(() => {
  delete window.__RIPX_FORCE_PICKER__;
});

/** Collaborators of the page gate that are out of scope here. */
const GATE_STUBS = `
  var PREVIEW_MODE = false;
  var PREVIEW_TEST_ID = null;
  var PREVIEW_TEST_CONTEXT = null;
  var __matchesTarget = true;
  function testTypeIsPrice(test) { return (test && test.type) === 'price_test'; }
  function testTypeIsOffer(test) { return (test && test.type) === 'offer_test'; }
  function testTypeIsShipping(test) { return (test && test.type) === 'shipping_test'; }
  function isConvertedPresentmentCurrency() { return false; }
  function noteConvertedCurrencySkip() {}
  function isPdpProductPath() { return true; }
  function matchesTarget() { return __matchesTarget; }
  function shouldShowOfferCodeOnCart() { return false; }
  function shouldShowOfferMessageOnPdp() { return false; }
  function shouldShowShippingTestOnCart() { return false; }
  function shouldRunPriceTestOnListingSurface() { return false; }
  function shouldRunShippingTestOnListingSurface() { return false; }
  function getNormalizedTargetType() { return 'product'; }
  function isProductScopeTargetType() { return true; }
  function isCartSurface() { return false; }
  function getCurrentProductId() { return null; }
  function productBelongsToPriceTestCollections() { return false; }
  function isProductListingSurface() { return false; }
`;

function gate(search) {
  return loadStorefrontFunctions(
    ['shouldRunPriceTestOnCurrentPage', 'priceSurfacePickModeActive', 'getPreviewParam'],
    { search, stubs: GATE_STUBS }
  );
}

const PRICE_TEST = { id: 't1', type: 'price_test' };

describe('price surface pick mode', () => {
  it('is off on an ordinary storefront page', () => {
    const { priceSurfacePickModeActive } = gate('');
    expect(priceSurfacePickModeActive()).toBe(false);
  });

  it('is on when the picker launched the page', () => {
    withPickerOpen();
    const { priceSurfacePickModeActive } = gate('?ab_visual_picker=1&ab_price_surface_pick=1');
    expect(priceSurfacePickModeActive()).toBe(true);
  });

  it('ignores the parameter on a page with no picker open', () => {
    // Turning it on suppresses every price test for the pageview. Taking the
    // parameter at face value made that an opt-out any shopper, crawler or
    // shared link could carry, quietly dropping that visitor out of the
    // merchant's experiment with no picker anywhere in sight.
    const { priceSurfacePickModeActive } = gate('?ab_price_surface_pick=1');
    expect(priceSurfacePickModeActive()).toBe(false);
  });

  it('is read through the nested url the preview proxy loads', () => {
    // The proxy serves the storefront under its own path and carries the real
    // page in ?url=, so the flag can arrive on either. Serving the shop's page
    // from a host that is not the shop is also what marks this as the proxy
    // rather than an ordinary visit.
    const { priceSurfacePickModeActive } = loadStorefrontFunctions(
      ['shouldRunPriceTestOnCurrentPage', 'priceSurfacePickModeActive', 'getPreviewParam'],
      {
        search: '?url=' + encodeURIComponent('https://shop.test/products/x?ab_price_surface_pick=1'),
        shopDomain: 'shop.test',
        stubs: GATE_STUBS,
      }
    );
    expect(priceSurfacePickModeActive()).toBe(true);
  });
});

describe('price tests while the picker is open', () => {
  it('paints normally when the picker is not involved', () => {
    const { shouldRunPriceTestOnCurrentPage } = gate('');
    expect(shouldRunPriceTestOnCurrentPage(PRICE_TEST)).toBe(true);
  });

  it('does not paint a price the merchant is about to map', () => {
    // Same test, same page, same matching target -- the only difference is
    // that the picker is open.
    withPickerOpen();
    const { shouldRunPriceTestOnCurrentPage } = gate('?ab_price_surface_pick=1');
    expect(shouldRunPriceTestOnCurrentPage(PRICE_TEST)).toBe(false);
  });

  it('keeps painting for a shopper who merely arrived with the parameter', () => {
    // The merchant's experiment is not something a link can opt out of.
    const { shouldRunPriceTestOnCurrentPage } = gate('?ab_price_surface_pick=1');
    expect(shouldRunPriceTestOnCurrentPage(PRICE_TEST)).toBe(true);
  });

  it('leaves the other test types alone', () => {
    // Offer and shipping tests do not rewrite the price node the picker is
    // pointed at, so suppressing them would be a change with no reason.
    withPickerOpen();
    const { shouldRunPriceTestOnCurrentPage } = gate('?ab_price_surface_pick=1');
    expect(shouldRunPriceTestOnCurrentPage({ id: 't2', type: 'offer_test' })).toBe(true);
    expect(shouldRunPriceTestOnCurrentPage({ id: 't3', type: 'shipping_test' })).toBe(true);
  });
});

describe('anti-flicker while the picker is open', () => {
  const antiFlicker = search =>
    loadStorefrontFunctions(
      ['isPriceAntiFlickerSurface', 'priceSurfacePickModeActive', 'getPreviewParam'],
      {
        search,
        stubs: GATE_STUBS + '\nfunction shouldRunPriceTestOnCurrentPage() { return true; }',
      }
    );

  it('hides the page for a price test that is about to repaint', () => {
    expect(antiFlicker('').isPriceAntiFlickerSurface(PRICE_TEST)).toBe(true);
  });

  it('leaves the page visible while the picker is open', () => {
    // Nothing is going to repaint, so there is nothing to hide -- and a hidden
    // body is the last thing someone trying to click a price needs.
    withPickerOpen();
    expect(antiFlicker('?ab_price_surface_pick=1').isPriceAntiFlickerSurface(PRICE_TEST)).toBe(
      false
    );
  });

  it('still hides the page for a shopper carrying the parameter', () => {
    // A price test is about to repaint for them, so the guard is still doing
    // its job.
    expect(antiFlicker('?ab_price_surface_pick=1').isPriceAntiFlickerSurface(PRICE_TEST)).toBe(
      true
    );
  });
});
