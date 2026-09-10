/**
 * A price surface mapping can name one specific page instead of a page type.
 *
 * Every other surface is inferred from the path, which left custom pages
 * unreachable: a landing page classifies as 'home' along with every other
 * /pages/ URL. These cover the model behind the 'url' surface — what it accepts,
 * what it refuses, and that it cannot masquerade as coverage of a page type.
 */

const test = require('node:test');
const assert = require('node:assert');
const {
  PRICE_SURFACES,
  buildPriceSurfaceReadinessSummary,
  normalizePriceSurfaceMapping,
  normalizePriceSurfaceMappings,
  normalizePriceSurfacePageUrl,
  priceSurfacePagePath,
  resolvePriceSurfaceSelectors,
} = require('../priceSurfaceRegistry');

const urlRow = (pageUrl, extra = {}) => ({
  surface: 'url',
  pageUrl,
  selector: '.landing-price',
  ...extra,
});

test('url is a real surface, not coerced to global', () => {
  assert.ok(PRICE_SURFACES.includes('url'));
  const row = normalizePriceSurfaceMapping(urlRow('/pages/sale'));
  assert.strictEqual(row.surface, 'url');
  assert.strictEqual(row.pageUrl, '/pages/sale');
});

test('a url mapping keeps the URL as the merchant typed it', () => {
  const row = normalizePriceSurfaceMapping(urlRow('https://demo.myshopify.com/pages/Sale?utm=1'));
  assert.strictEqual(row.pageUrl, 'https://demo.myshopify.com/pages/Sale?utm=1');
});

test('a url mapping with no page is not a mapping', () => {
  // It would apply everywhere or nowhere depending on the reader, and neither
  // is what a merchant asked for by choosing a specific URL.
  assert.strictEqual(normalizePriceSurfaceMapping(urlRow('')), null);
  assert.strictEqual(normalizePriceSurfaceMapping(urlRow('   ')), null);
});

test('a half-filled url row survives while the editor holds it', () => {
  const row = normalizePriceSurfaceMapping(urlRow(''), 0, { allowEmptySelector: true });
  assert.ok(row);
  assert.strictEqual(row.pageUrl, null);
});

test('only http(s) and site-relative pages are accepted', () => {
  // The value is handed to the preview proxy for visual picking.
  assert.strictEqual(normalizePriceSurfacePageUrl('javascript:alert(1)'), null);
  assert.strictEqual(normalizePriceSurfacePageUrl('data:text/html,<b>x'), null);
  assert.strictEqual(normalizePriceSurfacePageUrl('//evil.example/pages/sale'), null);
  assert.strictEqual(normalizePriceSurfacePageUrl('/pages/sale'), '/pages/sale');
  assert.strictEqual(normalizePriceSurfacePageUrl('https://x.com/a'), 'https://x.com/a');
  assert.strictEqual(normalizePriceSurfacePageUrl('x'.repeat(2001)), null);
});

test('a url mapping has no role of its own', () => {
  // A page is not a kind of price. Left free, a url row could claim compare_at
  // and strike through the wrong node.
  const row = normalizePriceSurfaceMapping(urlRow('/pages/sale', { role: 'compare_at' }));
  assert.strictEqual(row.role, 'regular');
});

test('only url mappings carry a page', () => {
  const row = normalizePriceSurfaceMapping({
    surface: 'pdp',
    role: 'regular',
    selector: '.price',
    pageUrl: '/pages/sale',
  });
  assert.strictEqual(row.pageUrl, null);
});

test('the comparable part of a page URL is its path', () => {
  assert.strictEqual(priceSurfacePagePath('https://s.com/pages/Sale/?utm_source=e'), '/pages/sale');
  assert.strictEqual(priceSurfacePagePath('/pages/sale'), '/pages/sale');
  assert.strictEqual(priceSurfacePagePath('pages/sale/'), '/pages/sale');
  assert.strictEqual(priceSurfacePagePath('/pages/sale#top'), '/pages/sale');
  assert.strictEqual(priceSurfacePagePath('https://s.com'), '/');
  assert.strictEqual(priceSurfacePagePath('javascript:x'), '');
  assert.strictEqual(priceSurfacePagePath(''), '');
});

test('a url mapping cannot close a readiness gap for a page type', () => {
  // The server has no page to test a url mapping against, so answering here
  // would let a landing-page selector report the product page as mapped.
  const rows = [urlRow('/pages/sale')];
  assert.deepStrictEqual(resolvePriceSurfaceSelectors('pdp', 'regular', { shopMappings: rows }), []);
  assert.deepStrictEqual(
    resolvePriceSurfaceSelectors('global', 'regular', { shopMappings: rows }),
    []
  );
  assert.deepStrictEqual(resolvePriceSurfaceSelectors('url', 'regular', { shopMappings: rows }), []);

  const summary = buildPriceSurfaceReadinessSummary([], rows);
  assert.strictEqual(summary.highSeverityGapCount, 1, 'the product page is still unmapped');
});

test('a url mapping does not disturb the page-type mappings beside it', () => {
  const rows = normalizePriceSurfaceMappings([
    urlRow('/pages/sale'),
    { surface: 'pdp', role: 'regular', selector: '.price--pdp' },
  ]);
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(resolvePriceSurfaceSelectors('pdp', 'regular', { shopMappings: rows }), [
    '.price--pdp',
  ]);
  assert.strictEqual(buildPriceSurfaceReadinessSummary([], rows).highSeverityGapCount, 0);
});
