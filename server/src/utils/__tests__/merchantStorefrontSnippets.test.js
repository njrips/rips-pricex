const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_GLOBAL_JS_CHARS,
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

  it('rejects oversized javascript instead of silently truncating executable code', () => {
    const bad = validateGlobalJavascriptSnippet('x'.repeat(MAX_GLOBAL_JS_CHARS + 1));
    assert.equal(bad.valid, false);
    assert.match(bad.error, /characters or fewer/i);
  });

  it('accepts plain css like visual editor rule bodies', () => {
    const ok = validateGlobalCssSnippet('.price { color: red; }');
    assert.equal(ok.valid, true);
  });

  it('flags unmatched css braces', () => {
    const bad = validateGlobalCssSnippet('.price { color: red;');
    assert.equal(bad.valid, false);
  });

  it('does not count braces inside css strings or comments', () => {
    assert.equal(validateGlobalCssSnippet('.x::before { content: "}"; }').valid, true);
    assert.equal(validateGlobalCssSnippet('.x { color: red; /* } */ }').valid, true);
  });
});
