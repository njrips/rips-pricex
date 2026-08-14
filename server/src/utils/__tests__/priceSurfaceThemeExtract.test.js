const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  inferSurfacesFromFilename,
  inferRoleFromToken,
  extractCandidatesFromThemeFile,
  extractThemeFileCandidates,
  filterThemeFileCandidatesForTarget,
  toThemeGid,
} = require('../priceSurfaceThemeExtract');

const DAWN_PRICE_LIQUID = `
<div class="price
  {%- if available == false %} price--sold-out {% endif -%}
  {%- if compare_at_price > price %} price--on-sale {% endif -%}">
  <div class="price__container">
    <div class="price__regular">
      <span class="visually-hidden">Regular price</span>
      <span class="price-item price-item--regular">
        {{ money_price }}
      </span>
    </div>
    <div class="price__sale">
      <span class="price-item price-item--sale price-item--last">
        {{ money_price }}
      </span>
      <s class="price-item price-item--regular">
        {{ compare_at_price | money }}
      </s>
    </div>
  </div>
  <small class="unit-price caption">
    <span class="price-item price-item--last">{{ unit_price | money }}</span>
  </small>
</div>
`;

const DAWN_CART_LIQUID = `
<div class="cart-item__price-wrapper">
  <span class="price price--end">
    {{ item.original_price | money }}
  </span>
  <s class="cart-item__old-price price price--end">
    {{ item.original_price | money }}
  </s>
  <span class="cart-item__final-price price price--end">
    {{ item.final_price | money }}
  </span>
</div>
`;

const DAWN_PRICE_CSS = `
.price-item--regular { font-weight: 600; }
.price-item--sale { color: rgb(var(--color-sale-price)); }
.price-item--last { display: inline; }
`;

describe('priceSurfaceThemeExtract', () => {
  test('Dawn price.liquid yields --regular for PDP/PLP and not invented selectors', () => {
    const rows = extractCandidatesFromThemeFile('snippets/price.liquid', DAWN_PRICE_LIQUID);
    const selectors = rows.map(r => r.selector);
    assert.ok(selectors.includes('.price-item--regular'));
    assert.equal(
      rows.some(r => r.selector === '.price-item--regular' && r.role === 'regular'),
      true
    );
    assert.ok(rows.every(r => r.source === 'theme_file'));
    assert.ok(rows.every(r => r.surfaces.includes('pdp')));
    assert.equal(
      rows.some(r => r.selector === '.totally-made-up'),
      false
    );
  });

  test('unit-price and compare tokens get the right roles', () => {
    assert.equal(inferRoleFromToken('price-item--compare'), 'compare_at');
    assert.equal(inferRoleFromToken('cart-item__old-price'), 'compare_at');
    assert.equal(inferRoleFromToken('unit-price'), 'unit');
    assert.equal(inferRoleFromToken('price-item--regular'), 'regular');
  });

  test('cart snippet maps to cart + cart_line', () => {
    const rows = extractCandidatesFromThemeFile('sections/main-cart-items.liquid', DAWN_CART_LIQUID);
    assert.ok(rows.every(r => r.surfaces.includes('cart')));
    assert.ok(rows.some(r => r.role === 'cart_line'));
    assert.ok(rows.some(r => r.selector === '.cart-item__final-price' || r.selector === '.price--end'));
  });

  test('CSS file contributes class selectors', () => {
    const rows = extractCandidatesFromThemeFile('assets/component-price.css', DAWN_PRICE_CSS);
    assert.ok(rows.some(r => r.selector === '.price-item--regular'));
  });

  test('filterThemeFileCandidatesForTarget keeps shared price snippet on PLP', () => {
    const all = extractThemeFileCandidates([
      { filename: 'snippets/price.liquid', content: DAWN_PRICE_LIQUID },
      { filename: 'sections/main-cart-items.liquid', content: DAWN_CART_LIQUID },
    ]);
    const plp = filterThemeFileCandidatesForTarget(all, 'plp', 'regular');
    const cart = filterThemeFileCandidatesForTarget(all, 'cart', 'cart_line');
    assert.ok(plp.some(r => r.selector === '.price-item--regular'));
    assert.equal(
      plp.some(r => String(r.selector).includes('cart-item')),
      false
    );
    assert.ok(cart.length > 0);
  });

  test('inferSurfacesFromFilename for search vs product', () => {
    assert.deepEqual(inferSurfacesFromFilename('sections/predictive-search.liquid'), ['search']);
    assert.ok(inferSurfacesFromFilename('sections/main-product.liquid').includes('pdp'));
  });

  test('toThemeGid wraps numeric ids', () => {
    assert.equal(toThemeGid('123456'), 'gid://shopify/OnlineStoreTheme/123456');
    assert.equal(
      toThemeGid('gid://shopify/OnlineStoreTheme/99'),
      'gid://shopify/OnlineStoreTheme/99'
    );
    assert.equal(toThemeGid(''), '');
  });

  test('Horizon price-styles stylesheet yields .price and .compare-at-price', () => {
    const liquid = `
      {% stylesheet %}
        .price, .compare-at-price, .unit-price { white-space: nowrap; }
      {% endstylesheet %}
    `;
    const rows = extractCandidatesFromThemeFile('snippets/price-styles.liquid', liquid);
    assert.ok(rows.some(r => r.selector === '.price' && r.role === 'regular'));
    assert.ok(rows.some(r => r.selector === '.compare-at-price' && r.role === 'compare_at'));
  });

  test('strikethrough class becomes a tagged compare_at selector', () => {
    const liquid = `<s class="price-item price-item--regular">{{ compare_at_price | money }}</s>`;
    const rows = extractCandidatesFromThemeFile('snippets/price.liquid', liquid);
    assert.ok(rows.some(r => r.selector === 's.price-item--regular' && r.role === 'compare_at'));
  });
});
