const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateSelector,
  extractLeadingTag,
} = require('../priceSurfaceHtmlProbe');

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
