const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateSelector,
  extractLeadingTag,
  findPriceElements,
  looksLikePriceSample,
  selectorElementFacts,
} = require('../priceSurfaceHtmlProbe');

describe('price element labels and strike-through', () => {
  // Dawn's sale layout: screen-reader labels before each amount.
  const dawnSale = `
    <div class="price price--on-sale">
      <div class="price__regular">
        <span class="visually-hidden visually-hidden--inline">Regular price</span>
        <span class="price-item price-item--regular">$20.00</span>
      </div>
      <div class="price__sale">
        <span class="visually-hidden visually-hidden--inline">Regular price</span>
        <span><s class="price-item price-item--regular">$30.00</s></span>
        <span class="visually-hidden visually-hidden--inline">Sale price</span>
        <span class="price-item price-item--sale price-item--last">$20.00</span>
      </div>
    </div>`;
  const elements = findPriceElements(dawnSale, looksLikePriceSample);

  test('records the label beside each price and whether it is struck', () => {
    assert.deepEqual(
      elements.map(e => [e.text, e.label, e.struck]),
      [
        ['$20.00', 'Regular price', false],
        ['$30.00', 'Regular price', true],
        ['$20.00', 'Sale price', false],
      ]
    );
  });

  test('summarises what a selector would repaint', () => {
    assert.deepEqual(selectorElementFacts(elements, 's.price-item--regular'), {
      prices: 1,
      struck: 1,
      hidden: 0,
      labels: ['Regular price'],
    });
    assert.deepEqual(selectorElementFacts(elements, '.price-item--regular, .price-item--sale'), {
      prices: 3,
      struck: 1,
      hidden: 0,
      labels: ['Regular price', 'Sale price'],
    });
    assert.equal(selectorElementFacts(elements, '.does-not-exist').prices, 0);
  });

  test('does not borrow a label from an unrelated part of the page', () => {
    const html = `
      <nav><a>Shop all</a></nav>
      <main><div><div><div><span class="price">$9.00</span></div></div></div></main>`;
    assert.equal(findPriceElements(html, looksLikePriceSample)[0].label, '');
  });
});

describe('priceSurfaceHtmlProbe tag-qualified selectors', () => {
  const html = `
    <span class="price-item price-item--regular">$14.40</span>
    <s class="price-item price-item--regular">$12.00</s>
    <span class="compare-at-price">$12.00</span>
    <span class="price">$14.40</span>
  `;

  test('extractLeadingTag reads s. from s.price-item--regular', () => {
    assert.equal(extractLeadingTag('s.price-item--regular'), 's');
    assert.equal(extractLeadingTag('.price-item--regular'), '');
  });

  test('s.price-item--regular matches only the strikethrough node', () => {
    const tagged = evaluateSelector(html, 's.price-item--regular');
    const untagged = evaluateSelector(html, '.price-item--regular');
    assert.equal(tagged.status, 'matched');
    assert.equal(tagged.occurrenceCount, 1);
    assert.ok(untagged.occurrenceCount >= 2);
  });

  test('Horizon .compare-at-price is distinct from .price', () => {
    const compare = evaluateSelector(html, '.compare-at-price');
    const regular = evaluateSelector(html, '.price');
    assert.equal(compare.status, 'matched');
    assert.equal(regular.status, 'matched');
    assert.notEqual(compare.occurrenceCount, regular.occurrenceCount);
  });
});
