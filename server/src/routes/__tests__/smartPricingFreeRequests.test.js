const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { isFreeSmartPricingRequest } = require('../smartPricingRoutes');

/**
 * Which Smart Pricing requests a shop without a paid plan may still make.
 *
 * The mount reads this to decide whether to run the entitlement check, so the
 * shape of the answer is what separates "you need to upgrade" from a shop
 * silently locked out of its own data.
 */
describe('requests that do not need a plan', () => {
  it('lets every read through, so the upgrade prompt has something to show', () => {
    assert.equal(isFreeSmartPricingRequest('GET', '/opportunities'), true);
    assert.equal(isFreeSmartPricingRequest('GET', '/wizard-drafts'), true);
  });

  it('lets a shop delete its own unfinished draft', () => {
    // Not a paid action, and the only way to clear the row. Refusing it left a
    // lapsed shop with drafts it could neither finish nor remove.
    assert.equal(isFreeSmartPricingRequest('DELETE', '/wizard-drafts/exp_1'), true);
  });

  it('lets a shop delete its own plan', () => {
    assert.equal(isFreeSmartPricingRequest('DELETE', '/inbox/plans/p1'), true);
  });

  it('lets a lapsed shop turn a live product test off', () => {
    // Stopping spends nothing and writes nothing to Shopify. Charged for, it
    // meant a shop whose plan had lapsed could not switch off tests that were
    // still pricing their shoppers without subscribing again.
    assert.equal(isFreeSmartPricingRequest('POST', '/tests/t1/stop-product'), true);
    assert.equal(isFreeSmartPricingRequest('POST', '/tests/t1/finish-product'), true);
    assert.equal(isFreeSmartPricingRequest('POST', '/tests/t1/release-product'), true);
  });

  it('lets the wizard suggest test prices before anything is launched', () => {
    assert.equal(isFreeSmartPricingRequest('POST', '/plans/suggest-prices'), true);
  });

  it('still charges for the writes that create work', () => {
    assert.equal(isFreeSmartPricingRequest('PUT', '/wizard-drafts'), false);
    assert.equal(isFreeSmartPricingRequest('POST', '/plans/launch'), false);
  });

  it('still charges for writing a price into the merchant catalog', () => {
    // The carve-out is for leaving, not for the one action that spends money
    // and changes what shoppers pay.
    assert.equal(isFreeSmartPricingRequest('POST', '/tests/t1/apply-winner'), false);
    assert.equal(isFreeSmartPricingRequest('POST', '/tests/t1/rerun'), false);
    assert.equal(isFreeSmartPricingRequest('POST', '/tests/t1/resume-product'), false);
  });

  it('does not let the stop carve-out match a longer path', () => {
    assert.equal(isFreeSmartPricingRequest('POST', '/tests/t1/stop-product/extra'), false);
  });

  it('does not let the draft carve-out reach the collection route', () => {
    // Nothing addresses it, and it would mean clearing every draft at once.
    assert.equal(isFreeSmartPricingRequest('DELETE', '/wizard-drafts'), false);
  });

  it('is not fooled by a lowercase verb', () => {
    assert.equal(isFreeSmartPricingRequest('get', '/opportunities'), true);
  });
});
