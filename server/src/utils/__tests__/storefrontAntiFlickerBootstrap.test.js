const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildEarlyStorefrontAntiFlickerBootstrap,
} = require('../storefrontScriptRuntime');

const PRICE_TEST = { id: 'test-1', type: 'price' };
const STRICT_TEST = { id: 'test-2', type: 'price', antiFlickerMode: 'strict' };

/** The snippet is a bare IIFE, so it parses as a function body. */
function assertParses(snippet) {
  assert.doesNotThrow(() => new Function(snippet), SyntaxError);
}

describe('early anti-flicker bootstrap', () => {
  it('emits nothing when no test needs prices hidden', () => {
    assert.equal(buildEarlyStorefrontAntiFlickerBootstrap([]), '');
    assert.equal(buildEarlyStorefrontAntiFlickerBootstrap([{ id: 'x', type: 'layout' }]), '');
  });

  for (const [label, tests] of [
    ['a price test', [PRICE_TEST]],
    ['a strict test', [STRICT_TEST]],
  ]) {
    it(`parses as JavaScript for ${label}`, () => {
      assertParses(buildEarlyStorefrontAntiFlickerBootstrap(tests));
    });

    // This snippet hides the page before the runtime loads. If the runtime
    // never arrives — a consent gate deferring init, a blocked script, a throw
    // on the way in — nothing else clears the attribute, and in strict mode the
    // shopper is looking at a blank storefront.
    it(`releases itself on a timer for ${label}`, () => {
      const snippet = buildEarlyStorefrontAntiFlickerBootstrap(tests);
      assert.match(snippet, /setTimeout\(/);
      assert.match(snippet, /removeAttribute\("data-ripx-af"\)/);
    });
  }

  it('hides only mapped price nodes for a price test, not the whole body', () => {
    const snippet = buildEarlyStorefrontAntiFlickerBootstrap([PRICE_TEST]);
    assert.match(snippet, /data-ripx-af","price"/);
    assert.doesNotMatch(snippet, /data-ripx-af="strict"\] body/);
  });

  it('hides the body for a strict test', () => {
    const snippet = buildEarlyStorefrontAntiFlickerBootstrap([STRICT_TEST]);
    assert.match(snippet, /data-ripx-af","strict"/);
    assert.match(snippet, /body\{opacity:0 !important;\}/);
  });

  it('leaves a preview window alone so the merchant sees real prices', () => {
    const snippet = buildEarlyStorefrontAntiFlickerBootstrap([PRICE_TEST]);
    assert.match(snippet, /ripxHasPreviewCtx/);
  });
});
