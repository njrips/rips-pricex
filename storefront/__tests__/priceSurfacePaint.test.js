// @vitest-environment jsdom
/**
 * Regression tests for storefront price mapping on the surfaces a shopper sees:
 * homepage, collection, search and the product page. These cover the defects
 * that let mapped selectors paint the wrong node, destroy theme markup, or skip
 * a page entirely.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadStorefrontFunctions,
  loadPdpPainter,
  setPathname,
  LIVE_SHOP_MAPPINGS,
  dawnCardMarkup,
  dawnPdpMarkup,
  dawnPdpPaintSelectors,
  compareAtLastCardMarkup,
} from './storefrontHarness.js';

beforeEach(() => {
  document.body.innerHTML = '';
  setPathname('/');
});

describe('listing surface detection', () => {
  const api = () => loadStorefrontFunctions(['isProductListingSurface', 'getListingPriceSurfaceKeys']);

  it('treats homepage, collection and search as listing surfaces', () => {
    const { isProductListingSurface } = api();
    for (const path of ['/', '/collections/all', '/collections/summer-sale', '/search']) {
      setPathname(path);
      expect(isProductListingSurface(), path).toBe(true);
    }
  });

  it('still recognises listing surfaces behind a market locale prefix', () => {
    // Prefix matching used to reject these, which skipped the whole listing
    // paint pipeline on every localized storefront.
    const { isProductListingSurface, getListingPriceSurfaceKeys } = api();
    const cases = [
      ['/en-gb', 'home'],
      ['/fr', 'home'],
      ['/en-gb/collections/all', 'plp'],
      ['/pt-br/collections/summer', 'plp'],
      ['/de/search', 'search'],
    ];
    for (const [path, surface] of cases) {
      setPathname(path);
      expect(isProductListingSurface(), path).toBe(true);
      expect(getListingPriceSurfaceKeys()[0], path).toBe(surface);
    }
  });

  it('agrees with the selector registry about the surface', () => {
    // A path that resolves to 'plp' for selector lookup but reports "not a
    // listing surface" for painting means mapped selectors are never applied.
    const { isProductListingSurface, getListingPriceSurfaceKeys } = api();
    for (const path of ['/', '/en-gb', '/collections/all', '/en-gb/collections/all', '/de/search']) {
      setPathname(path);
      const primary = getListingPriceSurfaceKeys()[0];
      expect(isProductListingSurface(), path).toBe(
        primary === 'plp' || primary === 'search' || primary === 'home'
      );
    }
  });

  it('does not treat a product page as a listing surface', () => {
    const { isProductListingSurface } = api();
    for (const path of ['/products/the-minimal-snowboard', '/en-gb/products/x', '/cart']) {
      setPathname(path);
      expect(isProductListingSurface(), path).toBe(false);
    }
  });
});

describe('product id for a listing card', () => {
  const api = () => loadStorefrontFunctions(['getProductIdForListingCard']);

  it('reads the product id from a Dawn card link', () => {
    const { getProductIdForListingCard } = api();
    document.body.innerHTML = `<ul>${dawnCardMarkup({ productId: '8276578566333' })}</ul>`;
    expect(getProductIdForListingCard(document.querySelector('.grid__item'))).toBe('8276578566333');
  });

  it('ignores a section id that carries no product id', () => {
    // Homepage sections wrap cards in elements named after the section
    // (template--21010091114685__featured_collection). Returning that number
    // made the card match no product and stay unpainted.
    const { getProductIdForListingCard } = api();
    document.body.innerHTML = `
      <li class="grid__item">
        <div class="card-wrapper" id="Slider-template--21010091114685__featured_collection">
          <a id="CardLink-template--21010091114685__featured_collection-8276578566333"
             href="/products/x">Snowboard</a>
        </div>
      </li>`;
    expect(getProductIdForListingCard(document.querySelector('.grid__item'))).toBe('8276578566333');
  });

  it('never reports a variant id as the product id', () => {
    const { getProductIdForListingCard } = api();
    document.body.innerHTML = `
      <li class="grid__item">
        <a href="/products/the-minimal-snowboard?variant=45123456789012">Snowboard</a>
        <div class="price"><span class="price-item price-item--regular">$100.00</span></div>
      </li>`;
    expect(getProductIdForListingCard(document.querySelector('.grid__item'))).toBe('');
  });

  it('prefers a target product id when the card advertises several ids', () => {
    const { getProductIdForListingCard } = api();
    document.body.innerHTML = `
      <li class="grid__item" id="Card-template--999__grid-1111111111111">
        <div data-product-id="8276578566333"></div>
      </li>`;
    const card = document.querySelector('.grid__item');
    expect(getProductIdForListingCard(card, ['gid://shopify/Product/8276578566333'])).toBe(
      '8276578566333'
    );
  });

  it('takes an explicit data-product-id over an id-derived guess', () => {
    const { getProductIdForListingCard } = api();
    document.body.innerHTML = `
      <li class="grid__item" data-product-id="8276578566333"
          id="Card-template--21010091114685__grid">
        <span class="price-item price-item--regular">$1.00</span>
      </li>`;
    expect(getProductIdForListingCard(document.querySelector('.grid__item'))).toBe('8276578566333');
  });
});

describe('painting a mapped selector', () => {
  const api = () =>
    loadStorefrontFunctions(['resolveRipxPricePaintTargets'], {
      shopMappings: LIVE_SHOP_MAPPINGS,
    });

  it('paints the amount inside a wrapper instead of replacing the wrapper', () => {
    // `.price` is a wrapper in Dawn. Assigning textContent to it erased the
    // regular price, the sale price, the compare-at and the a11y labels.
    const { paintPriceNode } = api();
    document.body.innerHTML = `<ul>${dawnCardMarkup({ productId: '8276578566333', onSale: true })}</ul>`;
    const card = document.querySelector('.grid__item');

    paintPriceNode(card.querySelector('.price'), '$70.00', 't1', 'v1', 'listing_cards', 70);

    expect(card.querySelector('.price__container')).not.toBeNull();
    expect(card.querySelector('.price-item--sale').textContent).toBe('$70.00');
    expect(card.querySelector('.price__regular .price-item--regular').textContent).toBe('$70.00');
    expect(card.querySelectorAll('.visually-hidden').length).toBeGreaterThan(0);
  });

  it('leaves the compare-at price untouched', () => {
    const { paintPriceNode } = api();
    document.body.innerHTML = `<ul>${dawnCardMarkup({ productId: '1', onSale: true, compareAt: '$140.00' })}</ul>`;
    const card = document.querySelector('.grid__item');

    // The live shop maps `s.price-item--regular` as plp/compare_at, so this is
    // a selector the paint loop really does receive.
    ['.price', '.price-item--regular', 's.price-item--regular'].forEach(sel => {
      card.querySelectorAll(sel).forEach(el =>
        paintPriceNode(el, '$70.00', 't1', 'v1', 'listing_cards', 70)
      );
    });

    expect(card.querySelector('s.price-item--regular').textContent).toBe('$140.00');
    expect(card.querySelector('.price-item--sale').textContent).toBe('$70.00');
  });

  it('refuses a compare-at node handed to it directly', () => {
    const { paintPriceNode } = api();
    document.body.innerHTML = `<div class="price">
      <span class="price-item price-item--sale">$80.00</span>
      <s class="price-item price-item--regular">$140.00</s>
      <span class="price-item price-item--compare">$140.00</span>
    </div>`;
    paintPriceNode(document.querySelector('s.price-item--regular'), '$70.00', 't', 'v', 'listing', 70);
    paintPriceNode(document.querySelector('.price-item--compare'), '$70.00', 't', 'v', 'listing', 70);
    expect(document.querySelector('s.price-item--regular').textContent).toBe('$140.00');
    expect(document.querySelector('.price-item--compare').textContent).toBe('$140.00');
  });

  it('is idempotent across repeated passes', () => {
    // Themes re-render cards, so the observer repaints. Repeats must not stack.
    const { paintPriceNode, paintEvents } = api();
    document.body.innerHTML = `<ul>${dawnCardMarkup({ productId: '1' })}</ul>`;
    const container = document.querySelector('.price');
    paintPriceNode(container, '$70.00', 't1', 'v1', 'listing_cards', 70);
    const afterFirst = document.querySelector('.grid__item').innerHTML;
    const writesAfterFirst = paintEvents.reduce((sum, e) => sum + e.textWrites, 0);

    paintPriceNode(container, '$70.00', 't1', 'v1', 'listing_cards', 70);
    expect(document.querySelector('.grid__item').innerHTML).toBe(afterFirst);
    expect(paintEvents.reduce((sum, e) => sum + e.textWrites, 0)).toBe(writesAfterFirst);
  });

  it('still paints a card that exposes only a bare price node', () => {
    const { paintPriceNode } = api();
    document.body.innerHTML = `<div class="price-item price-item--regular">$100.00</div>`;
    const el = document.querySelector('.price-item--regular');
    paintPriceNode(el, '$70.00', 't1', 'v1', 'listing_cards', 70);
    expect(el.textContent).toBe('$70.00');
    expect(el.getAttribute('data-ripx-price')).toBe('1');
  });
});

describe('painting a container with no price-classed amount inside', () => {
  const api = () => loadStorefrontFunctions(['paintPriceNode', 'resolveRipxPricePaintTargets']);

  it('keeps a screen-reader label beside the amount', () => {
    // Not every theme puts a price class on the amount itself, so the mapped
    // selector is the only handle we have. Writing it wholesale removed the
    // label and left the price unlabelled for assistive tech.
    const { paintPriceNode } = api();
    document.body.innerHTML = `<div class="product__price">
      <span class="visually-hidden">Regular price</span>
      <span>$100.00</span>
    </div>`;
    paintPriceNode(document.querySelector('.product__price'), '$70.00', 't', 'v', 'listing', 70);
    expect(document.querySelector('.visually-hidden').textContent).toBe('Regular price');
    expect(document.querySelector('.product__price span:last-child').textContent).toBe('$70.00');
  });

  it('keeps a "From" prefix that sits outside the amount', () => {
    const { paintPriceNode } = api();
    document.body.innerHTML = `<div class="product__price">From <span>$100.00</span></div>`;
    paintPriceNode(document.querySelector('.product__price'), '$70.00', 't', 'v', 'listing', 70);
    expect(document.querySelector('.product__price').textContent.trim()).toBe('From $70.00');
  });

  it('does not mistake a savings badge for the amount', () => {
    // "Save 20%" parses as the number 20 to the price parser, so amount
    // detection here has to insist on a currency, not just digits.
    const { resolveRipxPricePaintTargets } = api();
    document.body.innerHTML = `<div class="product__price">
      <span class="badge">Save 20%</span>
      <span class="amount">$100.00</span>
    </div>`;
    const targets = resolveRipxPricePaintTargets(document.querySelector('.product__price'));
    expect(targets).toHaveLength(1);
    expect(targets[0].className).toBe('amount');
  });

  it('recognises amounts on non-dollar storefronts', () => {
    const { resolveRipxPricePaintTargets } = api();
    for (const amount of ['100,00 €', '£99.00', '1 234 zł', '299 kr', '100.00 USD', '৳1200']) {
      document.body.innerHTML = `<div class="product__price">
        <span class="visually-hidden">Regular price</span>
        <span class="amount">${amount}</span>
      </div>`;
      const targets = resolveRipxPricePaintTargets(document.querySelector('.product__price'));
      expect(targets.map(node => node.className), amount).toEqual(['amount']);
    }
  });

  it('refuses a container whose only amount is a compare-at price', () => {
    const { paintPriceNode } = api();
    document.body.innerHTML = `<div class="product__price"><s>$140.00</s></div>`;
    paintPriceNode(document.querySelector('.product__price'), '$70.00', 't', 'v', 'listing', 70);
    expect(document.querySelector('s').textContent).toBe('$140.00');
    expect(document.querySelector('[data-ripx-price]')).toBeNull();
  });

  it('writes the container itself when it holds the amount directly', () => {
    const { paintPriceNode } = api();
    document.body.innerHTML = `<div class="product__price">$100.00</div>`;
    paintPriceNode(document.querySelector('.product__price'), '$70.00', 't', 'v', 'listing', 70);
    expect(document.querySelector('.product__price').textContent).toBe('$70.00');
  });
});

describe('catalog base price for amount and percent tests', () => {
  const api = () => loadStorefrontFunctions(['findRipxCatalogPriceNode']);

  it('reads what the shopper pays, not the compare-at price', () => {
    // Reading the wrapper gives concatenated text and the parser takes the last
    // amount, so a card that renders compare-at last yielded the pre-sale price
    // and every percentage discount was computed off the wrong base.
    const { findRipxCatalogPriceNode, getStableCatalogPriceForElement } = api();
    document.body.innerHTML = `<ul>${compareAtLastCardMarkup({ productId: '1', price: '$80.00', compareAt: '$140.00' })}</ul>`;
    const card = document.querySelector('.grid__item');

    const node = findRipxCatalogPriceNode(card);
    expect(node).not.toBeNull();
    expect(getStableCatalogPriceForElement(node)).toBe(80);
  });

  it('reads the current price from a Dawn sale card', () => {
    const { findRipxCatalogPriceNode, getStableCatalogPriceForElement } = api();
    document.body.innerHTML = `<ul>${dawnCardMarkup({ productId: '1', onSale: true, price: '$80.00', compareAt: '$140.00' })}</ul>`;
    const card = document.querySelector('.grid__item');
    expect(getStableCatalogPriceForElement(findRipxCatalogPriceNode(card))).toBe(80);
  });

  it('reads a plain card price', () => {
    const { findRipxCatalogPriceNode, getStableCatalogPriceForElement } = api();
    document.body.innerHTML = `<ul>${dawnCardMarkup({ productId: '1', price: '$120.00' })}</ul>`;
    const card = document.querySelector('.grid__item');
    expect(getStableCatalogPriceForElement(findRipxCatalogPriceNode(card))).toBe(120);
  });
});

describe('applyPriceTestToCollectionListingCards, end to end', () => {
  const run = ({ path = '/collections/all', markup, config }) => {
    const api = loadStorefrontFunctions(['applyPriceTestToCollectionListingCards'], {
      shopMappings: LIVE_SHOP_MAPPINGS,
    });
    setPathname(path);
    document.body.innerHTML = `<ul>${markup}</ul>`;
    api.applyPriceTestToCollectionListingCards('test-1', { id: 'v1', variantId: 'v1', config });
    return api;
  };

  it('prices a Dawn collection card and preserves the compare-at', () => {
    run({
      markup: dawnCardMarkup({
        productId: '8276578566333',
        onSale: true,
        price: '$100.00',
        compareAt: '$140.00',
      }),
      config: { priceMode: 'fixed', price: 70 },
    });
    const card = document.querySelector('.grid__item');
    expect(card.querySelector('.price__regular .price-item--regular').textContent).toBe('$70.00');
    expect(card.querySelector('.price-item--sale').textContent).toBe('$70.00');
    // The mapped plp/compare_at selector must not be repainted.
    expect(card.querySelector('s.price-item--regular').textContent).toBe('$140.00');
    expect(card.querySelector('.price__container')).not.toBeNull();
  });

  it('prices cards on a localized collection page', () => {
    run({
      path: '/en-gb/collections/all',
      markup: dawnCardMarkup({ productId: '8276578566333', price: '$100.00' }),
      config: { priceMode: 'fixed', price: 70 },
    });
    expect(document.querySelector('.price-item--regular').textContent).toBe('$70.00');
  });

  it('computes a percentage off the current price, not the compare-at', () => {
    run({
      markup: compareAtLastCardMarkup({
        productId: '8276578566333',
        price: '$80.00',
        compareAt: '$140.00',
      }),
      config: { priceMode: 'percent', pricePercent: 25 },
    });
    // 25% off the $80 the shopper pays, not off the $140 compare-at.
    expect(document.querySelector('.price-item--sale').textContent).toBe('$60.00');
    expect(document.querySelector('s.price-item--regular').textContent).toBe('$140.00');
  });

  it('leaves cards alone for a control arm', () => {
    run({
      markup: dawnCardMarkup({ productId: '8276578566333', price: '$100.00' }),
      config: { priceMode: 'control' },
    });
    expect(document.querySelector('.price-item--regular').textContent).toBe('$100.00');
    expect(document.querySelector('[data-ripx-price]')).toBeNull();
  });

  // `predictive-search` sat on the cart-UI skip list, so search suggestions kept
  // showing the catalog price to a shopper bucketed into a test arm. Nothing
  // else paints that dropdown, so excluding it just left it wrong.
  it('prices a card inside the predictive search dropdown', () => {
    run({
      path: '/search',
      markup: `<predictive-search>${dawnCardMarkup({
        productId: '8276578566333',
        price: '$100.00',
      })}</predictive-search>`,
      config: { priceMode: 'fixed', price: 70 },
    });
    expect(document.querySelector('.price-item--regular').textContent).toBe('$70.00');
  });

  // Cart UI is still skipped: the dedicated cart pass owns those rows.
  it('still leaves the cart drawer to the cart pass', () => {
    run({
      markup: `<div class="cart-drawer">${dawnCardMarkup({
        productId: '8276578566333',
        price: '$100.00',
      })}</div>`,
      config: { priceMode: 'fixed', price: 70 },
    });
    expect(document.querySelector('.price-item--regular').textContent).toBe('$100.00');
  });
});

describe('configured selectors resolved per surface', () => {
  const api = () =>
    loadStorefrontFunctions(
      [
        'getListingPriceSurfaceKeys',
        'appendConfiguredRegistrySelectorsForSurfaces',
        'hasConfiguredPriceSurfaceMappingsForSurfaces',
      ],
      { shopMappings: LIVE_SHOP_MAPPINGS }
    );

  it('finds homepage selectors on a localized homepage', () => {
    const { getListingPriceSurfaceKeys, appendConfiguredRegistrySelectorsForSurfaces } = api();
    setPathname('/en-gb');
    const out = [];
    appendConfiguredRegistrySelectorsForSurfaces(out, getListingPriceSurfaceKeys(), ['regular'], null);
    expect(out).toContain('.price-item--regular');
  });

  it('does not report a surface as mapped when only its compare-at is configured', () => {
    // Treating compare-at as coverage suppressed the built-in fallback
    // selectors, so a surface with only a "was price" mapping painted nothing.
    const { hasConfiguredPriceSurfaceMappingsForSurfaces } = api();
    const compareOnly = [
      { surface: 'home', role: 'compare_at', selector: 's.price-item--regular', priority: 5 },
    ];
    const scoped = loadStorefrontFunctions(['hasConfiguredPriceSurfaceMappingsForSurfaces'], {
      shopMappings: compareOnly,
    });
    expect(scoped.hasConfiguredPriceSurfaceMappingsForSurfaces(['home'], ['regular'], null)).toBe(
      false
    );
    expect(hasConfiguredPriceSurfaceMappingsForSurfaces(['home'], ['regular'], null)).toBe(true);
  });
});

describe('painting a product page', () => {
  const PRODUCT_ID = '8276578566333';

  function paintDawnPdp() {
    document.body.innerHTML = dawnPdpMarkup({ productId: PRODUCT_ID });
    const { paintEl, paintEvents } = loadPdpPainter({ display: '$70.00', priceNum: 70 });
    dawnPdpPaintSelectors(PRODUCT_ID).forEach(selector => {
      document.querySelectorAll(selector).forEach(el => paintEl(el));
    });
    return paintEvents;
  }

  it('keeps the price block intact when a selector matches the wrapper', () => {
    // `product-info[data-product-id] .price` is one of the painter's own
    // fallbacks and matches Dawn's `.price--large` container. Writing that
    // container collapsed the regular price, the sale price, the compare-at and
    // both screen-reader labels into a single text node, which no repaint or
    // revert could undo.
    paintDawnPdp();
    expect(document.querySelector('.price__regular')).not.toBeNull();
    expect(document.querySelector('.price__sale')).not.toBeNull();
    expect(document.querySelectorAll('.visually-hidden')).toHaveLength(3);
  });

  it('paints both amount nodes Dawn renders for the current price', () => {
    paintDawnPdp();
    expect(document.querySelector('.price__regular .price-item--regular').textContent).toBe(
      '$70.00'
    );
    expect(document.querySelector('.price-item--sale').textContent).toBe('$70.00');
  });

  it('leaves the compare-at price showing the original amount', () => {
    paintDawnPdp();
    const compareAt = document.querySelector('s.price-item--regular');
    expect(compareAt.textContent).toBe('$140.00');
    expect(compareAt.getAttribute('data-ripx-price')).toBeNull();
  });

  it('reports the product-page scope for each amount it writes', () => {
    const paintEvents = paintDawnPdp();
    expect(paintEvents.length).toBeGreaterThan(0);
    expect(paintEvents.every(event => event.scope === 'pdp')).toBe(true);
  });

  it('writes each amount once across overlapping selectors', () => {
    const paintEvents = paintDawnPdp();
    // Four selectors resolve onto the same two amount nodes.
    expect(paintEvents.filter(event => event.textWrites > 0)).toHaveLength(2);
  });

  it('does not paint a price inside the cart drawer', () => {
    document.body.innerHTML = `<cart-drawer>${dawnPdpMarkup({ productId: PRODUCT_ID })}</cart-drawer>`;
    const { paintEl } = loadPdpPainter();
    document.querySelectorAll('.price-item--regular').forEach(el => paintEl(el));
    expect(document.querySelector('[data-ripx-price]')).toBeNull();
  });

  it('skips the write when the recomputed price is unavailable', () => {
    // A variant change can leave the display null; the previous painter assigned
    // it anyway and blanked the price.
    document.body.innerHTML = dawnPdpMarkup({ productId: PRODUCT_ID });
    const { paintEl } = loadPdpPainter({ display: null, priceNum: null });
    dawnPdpPaintSelectors(PRODUCT_ID).forEach(selector => {
      document.querySelectorAll(selector).forEach(el => paintEl(el));
    });
    expect(document.querySelector('.price__regular .price-item--regular').textContent).toBe(
      '$100.00'
    );
  });
});
