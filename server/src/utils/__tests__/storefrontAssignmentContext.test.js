const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  assignmentContextFromQuery,
  jsTargetingOverridesFromQuery,
} = require('../storefrontAssignmentContext');

describe('storefront assignment context', () => {
  it('forwards the storefront targeting fields the script already sends', () => {
    const ctx = assignmentContextFromQuery({
      current_url: 'https://ripx-plus.myshopify.com/products/demo',
      current_pathname: '/products/demo',
      current_product_id: 'gid://shopify/Product/15632598335561',
      device: 'desktop',
      country: 'US',
      traffic_source: 'google',
      preview: '1',
    });
    assert.equal(ctx.current_url, 'https://ripx-plus.myshopify.com/products/demo');
    assert.equal(ctx.current_pathname, '/products/demo');
    assert.equal(ctx.current_product_id, 'gid://shopify/Product/15632598335561');
    assert.equal(ctx.device, 'desktop');
    assert.equal(ctx.country, 'US');
    assert.equal(ctx.traffic_source, 'google');
    assert.equal(ctx.preview, true);
    assert.equal(ctx.url, ctx.current_url);
    assert.equal(ctx.path, ctx.current_pathname);
  });

  it('maps per-test JS targeting results for batch assignment', () => {
    const overrides = jsTargetingOverridesFromQuery({
      js_targeting_results: JSON.stringify({ 'test-a': true, 'test-b': false }),
      test_id: 'test-c',
      js_targeting_passed: '1',
    });
    assert.equal(overrides['test-a'].js_targeting_passed, true);
    assert.equal(overrides['test-b'].js_targeting_passed, false);
    assert.equal(overrides['test-c'].js_targeting_passed, true);
  });
});
