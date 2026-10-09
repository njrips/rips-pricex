const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeGlobalAssets,
  globalAssetsForStorefrontRuntime,
  globalAssetsRuntimeSource,
  assertGlobalAssetPatchWithinLimits,
  MAX_GLOBAL_CSS_CHARS,
  MAX_GLOBAL_JS_CHARS,
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

  it('rejects oversized patches instead of saving truncated snippets', () => {
    assert.throws(
      () => assertGlobalAssetPatchWithinLimits({ css: 'x'.repeat(MAX_GLOBAL_CSS_CHARS + 1) }),
      /CSS must be/i
    );
    assert.throws(
      () => assertGlobalAssetPatchWithinLimits({ js: 'x'.repeat(MAX_GLOBAL_JS_CHARS + 1) }),
      /JavaScript must be/i
    );
  });

  it('builds CSP-compatible external-script source for css and javascript', () => {
    const source = globalAssetsRuntimeSource({
      css: '.price { color: red; }',
      js: 'window.__globalSnippetRuns = (window.__globalSnippetRuns || 0) + 1;',
      css_enabled: true,
      js_enabled: true,
    });
    const elements = new Map();
    const document = {
      readyState: 'complete',
      documentElement: { appendChild: element => elements.set(element.id, element) },
      head: { appendChild: element => elements.set(element.id, element) },
      getElementById: id => elements.get(id) || null,
      createElement: tagName => ({
        tagName,
        id: '',
        textContent: '',
        setAttribute() {},
      }),
      addEventListener() {},
    };
    const window = {
      Shopify: {},
      RipX: { version: 'test-version' },
      location: { href: 'https://demo.myshopify.com/' },
    };
    const execute = new Function(
      'window',
      'document',
      'console',
      source.beforeRuntime + source.afterRuntime
    );
    execute(window, document, console);
    execute(window, document, console);
    assert.equal(elements.get('ripx-shop-global-css').textContent, '.price { color: red; }');
    assert.equal(window.__globalSnippetRuns, 1);
    assert.doesNotMatch(source.afterRuntime, /new Function/);
  });
});
