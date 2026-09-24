const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeMerchantJsSnippet,
  validateGlobalJavascriptSnippet,
  validateGlobalCssSnippet,
} = require('../merchantStorefrontSnippets.cjs');

describe('merchantStorefrontSnippets', () => {
  it('strips script tags like pasted visual editor markup', () => {
    assert.equal(
      normalizeMerchantJsSnippet('<script>window.__x = 1;</script>'),
      'window.__x = 1;'
    );
  });

  it('reports javascript syntax errors with line hints when possible', () => {
    const bad = validateGlobalJavascriptSnippet('function ({');
    assert.equal(bad.valid, false);
    assert.ok(bad.error);
  });

  it('accepts plain css like visual editor rule bodies', () => {
    const ok = validateGlobalCssSnippet('.price { color: red; }');
    assert.equal(ok.valid, true);
  });

  it('flags unmatched css braces', () => {
    const bad = validateGlobalCssSnippet('.price { color: red;');
    assert.equal(bad.valid, false);
  });
});
