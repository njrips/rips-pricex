const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildPricePreviewHtml } = require('../pricePreviewBootstrap');

function html(prefetchError) {
  return buildPricePreviewHtml({
    targetUrl:
      'https://splitter-plus.myshopify.com/products/the-inventory-not-tracked-snowboard?ab_preview=1',
    appProxyScriptUrl: 'https://splitter-plus.myshopify.com/apps/ripspricex/script.js?v=1',
    directScriptUrl: 'https://pricefy.echologyx.com/api/track/script.js?shop=splitter-plus.myshopify.com',
    prefetchError,
  });
}

describe('price preview bootstrap password gate', () => {
  it('does not treat server password_required prefetch as fatal', () => {
    const page = html('password_required');
    assert.match(page, /credentials:\s*'include'/);
    assert.doesNotMatch(page, /if \(prefetchError === 'password_required'\)/);
    assert.match(page, /isPasswordGateResponse/);
  });

  it('keeps the preview tab when opening the storefront password page', () => {
    const page = html('password_required');
    assert.match(page, /window\.open\('\/password',\s*'_blank'/);
    assert.doesNotMatch(page, /location\.replace\('\/password'\)/);
    assert.match(page, /retryWithClientFetch/);
  });

  it('requires password form + copy, not a loose storefront_password substring', () => {
    const page = html(null);
    assert.match(page, /hasForm && hasCopy/);
    assert.doesNotMatch(
      page,
      /lower\.indexOf\('storefront_password'\) !== -1 \|\|/
    );
  });
});
