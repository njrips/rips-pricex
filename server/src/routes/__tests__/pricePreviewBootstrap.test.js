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
  it('navigates to the PDP when server prefetch hits the password wall', () => {
    const page = html('password_required');
    assert.match(page, /function openStorefrontPreview\s*\(/);
    assert.match(page, /if \(prefetchError === 'password_required'\)/);
    assert.match(page, /window\.location\.replace\(target\)/);
    assert.match(page, /Opening preview/);
  });

  it('does not fetch-and-mount password HTML from the bootstrap tab', () => {
    const page = html('password_required');
    const afterPassword = page.split("if (prefetchError === 'password_required')")[1] || '';
    const untilFetch = afterPassword.split('fetch(target')[0] || '';
    assert.match(untilFetch, /openStorefrontPreview\(\)/);
    assert.match(untilFetch, /return;/);
  });

  it('treats password copy without a form as the gate', () => {
    const page = html(null);
    assert.match(page, /use the password to enter the store/);
    assert.match(page, /return hasCopy;/);
  });
});
