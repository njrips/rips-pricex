const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { suggestPriceRequestLimits } = require('../smartPricingRoutes');

function rows(count, variantsPerProduct = 1) {
  return Array.from({ length: count }, (_, i) => ({
    variant_id: `v${i}`,
    product_id: `p${Math.floor(i / variantsPerProduct)}`,
    current_price: 10,
  }));
}

/**
 * How large a price suggestion request may be.
 *
 * Every product goes to the model, so the request is bounded in products --
 * what the wizard limits and what each AI call is sized in -- with a looser
 * ceiling on variant rows so a malformed body cannot ask for unbounded work.
 */
describe('the size of a price suggestion request', () => {
  it('accepts a selection the size a merchant would really make', () => {
    assert.deepEqual(suggestPriceRequestLimits(rows(120), [{ id: 'a' }, { id: 'b' }]), []);
  });

  it('accepts the most products the wizard allows, with several variants each', () => {
    // 500 products of three sizes is 1,500 rows, which a cap on rows refused.
    assert.deepEqual(suggestPriceRequestLimits(rows(1500, 3), [{ id: 'a' }]), []);
  });

  it('refuses more products than a wizard could show', () => {
    const errors = suggestPriceRequestLimits(rows(501), [{ id: 'a' }]);

    assert.equal(errors.length, 1);
    assert.match(errors[0], /more than 500 products/);
    // The count is named so the caller can see how far over it was.
    assert.match(errors[0], /received 501/);
  });

  it('counts a row without a product id as its own product', () => {
    const loose = Array.from({ length: 501 }, (_, i) => ({ variant_id: `v${i}` }));

    assert.equal(suggestPriceRequestLimits(loose, [{ id: 'a' }]).length, 1);
  });

  it('still bounds variant rows', () => {
    const errors = suggestPriceRequestLimits(rows(5001, 20), [{ id: 'a' }]);

    assert.equal(errors.length, 1);
    assert.match(errors[0], /cannot exceed 5000 rows/);
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
