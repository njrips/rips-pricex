import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isShopifySessionBounce,
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
