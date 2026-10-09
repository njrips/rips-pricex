import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  isShopifyRedirectResponse,
  isShopifySessionBounce,
  shouldRenderShopifyBoundaryHtml,
  preserveEmbeddedSearch,
  withCurrentEmbeddedSearch,
  withEmbeddedSearch,
} from '../shopifyEmbeddedSearch.js';

describe('withEmbeddedSearch', () => {
  it('keeps Shopify embed params and adds ticket flags', () => {
    const request = {
      url: 'https://example.com/help?shop=ripx-plus.myshopify.com&host=abc&embedded=1&utm=drop',
    };
    assert.equal(
      withEmbeddedSearch(request, '/app/help', { ticket: 'PX-7K2M', created: '1' }),
      '/app/help?shop=ripx-plus.myshopify.com&host=abc&embedded=1&ticket=PX-7K2M&created=1'
    );
  });

  it('returns a bare path when there is nothing to keep', () => {
    assert.equal(withEmbeddedSearch({ url: 'https://example.com/help' }, '/app/help'), '/app/help');
  });

  it('copies the browser embed params onto an internal path', () => {
    const previous = globalThis.window;
    globalThis.window = {
      location: { search: '?shop=demo.myshopify.com&host=abc&embedded=1&tab=stats' },
    };
    try {
      assert.equal(
        preserveEmbeddedSearch('/app/setup'),
        '/app/setup?shop=demo.myshopify.com&host=abc&embedded=1',
      );
      assert.equal(
        preserveEmbeddedSearch('/app/settings?tab=plan'),
        '/app/settings?tab=plan&shop=demo.myshopify.com&host=abc&embedded=1',
      );
    } finally {
      if (previous === undefined) delete globalThis.window;
      else globalThis.window = previous;
    }
  });

  it('keeps embed params from the current client search', () => {
    const params = new URLSearchParams(
      'shop=ripx-plus.myshopify.com&host=abc&embedded=1&ticket=PX-OLD',
    );
    assert.equal(
      withCurrentEmbeddedSearch(params, '/app/help', { ticket: 'PX-8BVE' }),
      '/app/help?shop=ripx-plus.myshopify.com&host=abc&embedded=1&ticket=PX-8BVE',
    );
    assert.equal(
      withCurrentEmbeddedSearch(params, '/app/help', { view: 'all' }),
      '/app/help?shop=ripx-plus.myshopify.com&host=abc&embedded=1&view=all',
    );
  });
});

describe('isShopifySessionBounce', () => {
  it('treats 401/410 as App Bridge bounces', () => {
    assert.equal(isShopifySessionBounce({ status: 410, data: '' }), true);
    assert.equal(isShopifySessionBounce({ status: 401, data: '' }), true);
    assert.equal(isShopifySessionBounce({ status: 404, data: 'Not found' }), false);
  });

  it('treats thrown App Bridge HTML as a bounce even at 200', () => {
    assert.equal(
      isShopifySessionBounce({
        status: 200,
        data: '<script data-api-key="x" src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>',
      }),
      true,
    );
  });
});

describe('shouldRenderShopifyBoundaryHtml', () => {
  it('renders HTML bounces and redirects with bodies through the Shopify boundary', () => {
    assert.equal(
      shouldRenderShopifyBoundaryHtml({
        status: 410,
        data: '',
      }),
      true,
    );
    assert.equal(
      shouldRenderShopifyBoundaryHtml({
        status: 200,
        data: '<div>App Bridge</div>',
      }),
      true,
    );
  });

  it('does not render empty redirect placeholders as raw HTML', () => {
    assert.equal(
      shouldRenderShopifyBoundaryHtml({
        status: 302,
        data: '',
      }),
      false,
    );
    assert.equal(isShopifyRedirectResponse({ status: 302 }), true);
  });
});
