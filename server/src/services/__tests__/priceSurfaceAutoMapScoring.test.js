const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  pickSampleProductPath,
  knownPricesForTarget,
  anchorCandidate,
  searchPathForProduct,
} = require('../priceSurfaceAutoMapService');
const { rankThemeFilenames } = require('../priceSurfaceThemeFileService');
const { anchorSelectorToPrices } = require('../../utils/priceSurfaceHtmlProbe');

describe('pickSampleProductPath', () => {
  test('prefers an in-stock product on sale, then any in-stock product', () => {
    const products = [
      { handle: 'sold-out', available: false, onSale: true },
      { handle: 'plain', available: true, onSale: false },
      { handle: 'on-sale', available: true, onSale: true },
    ];
    assert.equal(pickSampleProductPath(products), '/products/on-sale');
    assert.equal(pickSampleProductPath(products.slice(0, 2)), '/products/plain');
  });

  test('skips gift cards and handles an empty listing', () => {
    assert.equal(
      pickSampleProductPath([
        { handle: 'gift', available: true, onSale: false, giftCard: true },
        { handle: 'tee', available: true, onSale: false },
      ]),
      '/products/tee'
    );
    assert.equal(pickSampleProductPath([]), '');
    assert.equal(pickSampleProductPath(undefined), '');
  });
});

describe('knownPricesForTarget', () => {
  const product = { regular: new Set([2400]), compare: new Set([3000]) };
  const listing = { regular: new Set([1000, 2400]), compare: new Set([1500]) };

  test('uses the sample product on the product page', () => {
    const ctx = { product, listing, cartSeeded: true };
    assert.deepEqual([...knownPricesForTarget({ surface: 'pdp', role: 'regular' }, ctx)], [2400]);
    assert.deepEqual(
      [...knownPricesForTarget({ surface: 'pdp', role: 'compare_at' }, ctx)],
      [3000]
    );
  });

  test('only checks the cart when a cart line was seeded', () => {
    const target = { surface: 'cart', role: 'regular' };
    assert.equal(knownPricesForTarget(target, { product, listing, cartSeeded: null }).size, 0);
    assert.equal(knownPricesForTarget(target, { product, listing, cartSeeded: true }).size, 1);
  });

  test('tells the cart unit price from the line total of the seeded quantity', () => {
    const cartSeeded = { unit: new Set([2400]), line: new Set([4800]) };
    const ctx = { product, listing, cartSeeded };
    assert.deepEqual([...knownPricesForTarget({ surface: 'cart', role: 'regular' }, ctx)], [2400]);
    assert.deepEqual(
      [...knownPricesForTarget({ surface: 'cart', role: 'cart_line' }, ctx)],
      [4800]
    );
  });

  test('listing pages accept any listed or sample price', () => {
    const known = knownPricesForTarget(
      { surface: 'plp', role: 'regular' },
      { product, listing, cartSeeded: false }
    );
    assert.deepEqual([...known].sort(), [1000, 2400]);
  });
});

describe('anchorCandidate', () => {
  const html = `
    <span class="price-item price-item--regular">$24.00</span>
    <s class="price-item price-item--regular">$30.00</s>
    <span class="price-item price-item--sale">$24.00</span>
    <span class="cart-count">$99.00</span>
  `;
  const known = new Set([2400]);

  test('ranks the selector that only shows this price above a mixed one', () => {
    const mixed = anchorCandidate(
      { selector: '.price-item--regular', score: 100, status: 'matched' },
      html,
      known
    );
    const pure = anchorCandidate(
      { selector: '.price-item--sale', score: 100, status: 'matched' },
      html,
      known
    );
    assert.equal(mixed.verified, true);
    assert.equal(pure.verified, true);
    assert.ok(pure.score > mixed.score);
  });

  test('demotes a selector showing a different amount', () => {
    const row = anchorCandidate({ selector: '.cart-count', score: 100, status: 'matched' }, html, known);
    assert.equal(row.verified, false);
    assert.equal(row.status, 'ambiguous');
    assert.ok(row.score < 100);
  });

  test('leaves unreadable selectors alone', () => {
    const row = anchorCandidate({ selector: '.nothing', score: 50, status: 'matched' }, html, known);
    assert.equal(row.score, 50);
    assert.equal(row.verified, undefined);
  });
});

describe('attribute selectors', () => {
  test('are checked against the real price too', () => {
    const html = '<span data-product-price>$24.00</span><span data-price="x">$9.00</span>';
    assert.equal(anchorSelectorToPrices(html, '[data-product-price]', [2400]).matched, true);
    assert.equal(anchorSelectorToPrices(html, '[data-price]', [2400]).matched, false);
  });
});

describe('search and theme files', () => {
  test('searches for the sample product by name', () => {
    assert.equal(
      searchPathForProduct('/products/blue-cotton-tee'),
      '/search?q=blue%20cotton%20tee&type=product'
    );
    assert.equal(searchPathForProduct(''), '/search?q=a');
  });

  test('ranks price files ahead of generic section files', () => {
    const ranked = rankThemeFilenames([
      'sections/collection-list.liquid',
      'assets/component-card.css',
      'snippets/price.liquid',
      'sections/main-product.liquid',
    ]);
    assert.equal(ranked[0], 'snippets/price.liquid');
    assert.equal(ranked[1], 'sections/main-product.liquid');
    assert.equal(ranked[ranked.length - 1], 'sections/collection-list.liquid');
  });
});
