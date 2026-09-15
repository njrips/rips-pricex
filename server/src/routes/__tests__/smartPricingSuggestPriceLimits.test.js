const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { suggestPriceRequestLimits } = require('../smartPricingRoutes');

function rows(count) {
  return Array.from({ length: count }, (_, i) => ({ variant_id: `v${i}`, current_price: 10 }));
}

/**
 * How large a price suggestion request may be.
 *
 * Nothing downstream was bounded. Every product is priced and every arm spread
 * even though only the first 60 products reach the model, so a body asking for
 * tens of thousands of rows turned one click into work no wizard could ever
 * display -- and the route accepted it without a word.
 */
describe('the size of a price suggestion request', () => {
  it('accepts a selection the size a merchant would really make', () => {
    assert.deepEqual(suggestPriceRequestLimits(rows(120), [{ id: 'a' }, { id: 'b' }]), []);
  });

  it('refuses more products than a wizard could show', () => {
    const errors = suggestPriceRequestLimits(rows(501), [{ id: 'a' }]);

    assert.equal(errors.length, 1);
    assert.match(errors[0], /cannot exceed 500 products/);
    // The count is named so the caller can see how far over it was.
    assert.match(errors[0], /received 501/);
  });

  it('refuses more variations than a test could resolve', () => {
    const errors = suggestPriceRequestLimits(rows(1), rows(11));

    assert.equal(errors.length, 1);
    assert.match(errors[0], /cannot exceed 10 variations/);
  });

  it('reports both problems at once rather than one at a time', () => {
    assert.equal(suggestPriceRequestLimits(rows(900), rows(40)).length, 2);
  });

  it('allows exactly the limit', () => {
    assert.deepEqual(suggestPriceRequestLimits(rows(500), rows(10)), []);
  });
});
