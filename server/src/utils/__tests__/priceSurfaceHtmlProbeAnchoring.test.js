const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseMoneyNumberToCents,
  moneyCentsInText,
  anchorSelectorToPrices,
  extractMainProductSection,
  looksLikePriceSample,
} = require('../priceSurfaceHtmlProbe');

describe('parseMoneyNumberToCents', () => {
  test('reads US, European and spaced thousands formats', () => {
    assert.equal(parseMoneyNumberToCents('19.99'), 1999);
    assert.equal(parseMoneyNumberToCents('1,299.00'), 129900);
    assert.equal(parseMoneyNumberToCents('1.299,00'), 129900);
    assert.equal(parseMoneyNumberToCents('1 299,5'), 129950);
    assert.equal(parseMoneyNumberToCents('20'), 2000);
  });

  test('treats a three-digit group as thousands, not decimals', () => {
    assert.equal(parseMoneyNumberToCents('1,500'), 150000);
    assert.equal(parseMoneyNumberToCents('2.500'), 250000);
  });

  test('moneyCentsInText finds every amount', () => {
    assert.deepEqual(moneyCentsInText('Sale price Tk 1,200.00 Regular price Tk 1,500.00'), [
      120000, 150000,
    ]);
    assert.deepEqual(moneyCentsInText('Regular price'), []);
  });
});

describe('looksLikePriceSample currencies', () => {
  test('recognises more storefront currencies', () => {
    assert.ok(looksLikePriceSample('Tk 1,200'));
    assert.ok(looksLikePriceSample('1.299,00 kr'));
    assert.ok(looksLikePriceSample('R$ 59,90'));
    assert.ok(looksLikePriceSample('Rs. 499'));
    assert.ok(looksLikePriceSample('CHF 20.00'));
  });

  test('does not read "rs" inside a word as a currency', () => {
    assert.equal(looksLikePriceSample('Open hours 9 to 5'), false);
  });
});

const PDP_HTML = `
  <div id="shopify-section-header"><span class="cart-count-bubble">$0.00</span></div>
  <section id="shopify-section-template--1__main" class="shopify-section">
    <div class="price">
      <div class="price__regular">
        <span class="visually-hidden">Regular price</span>
        <span class="price-item price-item--regular">$24.00 USD</span>
      </div>
    </div>
    <form action="/cart/add" method="post"><button>Add to cart</button></form>
  </section>
  <section id="shopify-section-template--1__related" class="shopify-section">
    <span class="price-item price-item--regular">$80.00 USD</span>
    <span class="price-item price-item--regular">$65.00 USD</span>
  </section>
`;

describe('extractMainProductSection', () => {
  test('keeps only the section that holds the product form', () => {
    const main = extractMainProductSection(PDP_HTML);
    assert.ok(main.includes('$24.00'));
    assert.ok(!main.includes('$80.00'));
    assert.ok(!main.includes('cart-count-bubble'));
  });

  test('falls back to the whole page without a product form', () => {
    const html = '<div class="price">$5</div>';
    assert.equal(extractMainProductSection(html), html);
  });
});

describe('anchorSelectorToPrices', () => {
  test('confirms a selector that shows the real product price', () => {
    const main = extractMainProductSection(PDP_HTML);
    const anchor = anchorSelectorToPrices(main, '.price-item--regular', new Set([2400]));
    assert.equal(anchor.checked, true);
    assert.equal(anchor.matched, true);
    assert.equal(anchor.sample_text, '$24.00 USD');
  });

  test('flags a selector whose amounts are not the product price', () => {
    const anchor = anchorSelectorToPrices(PDP_HTML, '.cart-count-bubble', [2400]);
    assert.equal(anchor.checked, true);
    assert.equal(anchor.matched, false);
  });

  test('respects tag-qualified selectors', () => {
    const html =
      '<span class="price-item--regular">$20.00</span><s class="price-item--regular">$30.00</s>';
    assert.equal(anchorSelectorToPrices(html, 's.price-item--regular', [3000]).matched, true);
    assert.equal(anchorSelectorToPrices(html, 's.price-item--regular', [2000]).matched, false);
  });

  test('stays unchecked when prices are rendered by JavaScript or unknown', () => {
    const html = '<span class="price-item--regular"></span>';
    assert.equal(anchorSelectorToPrices(html, '.price-item--regular', [2000]).checked, false);
    assert.equal(anchorSelectorToPrices(PDP_HTML, '.price-item--regular', []).checked, false);
  });
});

const {
  findPriceElements,
  candidatesFromPriceElements,
  extractCartItemsSection,
} = require('../priceSurfaceHtmlProbe');

describe('findPriceElements (value-first discovery)', () => {
  const isPrice = text => moneyCentsInText(text).includes(2400);
  const html = `
    <script>var price = "$24.00";</script>
    <div class="no-js-hidden"><div class="pp-wrap"><span class="pp-amount">$24.00</span></div></div>
    <span class="visually-hidden">$24.00</span>
    <div class="product-meta"><span>$24.00</span><br></div>
    <span class="other">$10.00</span>
  `;

  test('finds prices by what they say, skipping scripts', () => {
    const found = findPriceElements(html, isPrice);
    assert.equal(found.length, 3);
    assert.deepEqual(found[0].classes, ['pp-amount']);
    assert.equal(found[0].hidden, false, 'no-js-hidden is visible when JS runs');
    assert.equal(found[1].hidden, true);
    assert.match(found[0].text, /\$24\.00/);
  });

  test('builds selectors from custom classes and classed ancestors', () => {
    const selectors = candidatesFromPriceElements(findPriceElements(html, isPrice)).map(
      row => row.selector
    );
    assert.ok(selectors.includes('.pp-amount'));
    assert.ok(selectors.includes('.product-meta'), 'bare span falls back to its classed parent');
    assert.ok(!selectors.includes('.visually-hidden'));
  });

  test('prefers struck-through elements for compare-at and avoids them for regular', () => {
    const markup = '<s class="was">$24.00</s><span class="now">$24.00</span>';
    const elements = findPriceElements(markup, isPrice);
    const compare = candidatesFromPriceElements(elements, { role: 'compare_at' });
    const regular = candidatesFromPriceElements(elements, { role: 'regular' });
    assert.equal(compare[0].selector, 's.was');
    assert.equal(regular[0].selector, '.now');
    assert.match(compare[0].dom_path, /s\.was/);
  });
});

describe('extractCartItemsSection', () => {
  test('uses the template cart section, not the header drawer or totals footer', () => {
    const html = `
      <div id="shopify-section-sections--1__header"><form action="/cart" id="CartDrawer-Form"><span class="drawer-price">$24.00</span></form></div>
      <div id="shopify-section-template--1__cart-items"><form action="/cart" id="cart"><span class="cart-item__price">$24.00</span></form></div>
      <div id="shopify-section-template--1__cart-footer"><span class="totals__subtotal-value">$48.00</span></div>
    `;
    const section = extractCartItemsSection(html);
    assert.ok(section.includes('cart-item__price'));
    assert.ok(!section.includes('drawer-price'));
    assert.ok(!section.includes('totals__subtotal-value'));
  });
});
