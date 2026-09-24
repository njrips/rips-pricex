const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeGlobalAssets,
  globalAssetsForStorefrontRuntime,
  MAX_GLOBAL_CSS_CHARS,
} = require('../shopGlobalAssetsService');
const { assertValidGlobalJavascriptSnippet } = require('../../utils/merchantStorefrontSnippets.cjs');

describe('shopGlobalAssetsService', () => {
  it('normalizes and caps css length', () => {
    const css = 'a'.repeat(MAX_GLOBAL_CSS_CHARS + 100);
    const out = normalizeGlobalAssets({ css, js: '', css_enabled: true, js_enabled: true });
    assert.equal(out.css.length, MAX_GLOBAL_CSS_CHARS);
  });

  it('validates javascript syntax on save', () => {
    assert.throws(() => assertValidGlobalJavascriptSnippet('function ({'), /function|Line|Invalid/i);
    assert.doesNotThrow(() => assertValidGlobalJavascriptSnippet('console.log("ok");'));
  });

  it('omits disabled or empty snippets from storefront payload', () => {
    const runtime = globalAssetsForStorefrontRuntime({
      css: '.x{color:red}',
      js: 'window.__x=1',
      css_enabled: false,
      js_enabled: true,
    });
    assert.equal(runtime.css, '');
    assert.equal(runtime.js, 'window.__x=1');
  });
});
