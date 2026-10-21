/**
 * The price picker modal shows /track/preview-document as-is, so every answer
 * has to be a readable page; a comment or JSON body reads as a blank modal.
 */
jest.mock('../../utils/database', () => ({
  query: jest.fn(async () => ({ rowCount: 1, rows: [] })),
}));
jest.mock('../../utils/storefrontPasswordPreview', () => ({
  fetchStorefrontPreviewHtml: jest.fn(async () => ({
    ok: true,
    html: '<html><head></head><body><span class="price">$10.00</span></body></html>',
  })),
  resolveStorefrontPasswordForPreviewRequest: jest.fn(value => value),
}));

const express = require('express');
const { query } = require('../../utils/database');
const { fetchStorefrontPreviewHtml } = require('../../utils/storefrontPasswordPreview');
const trackRoutes = require('../trackSlimRoutes');

let server;
let base;

beforeAll(async () => {
  const app = express();
  app.use('/api/track', trackRoutes);
  await new Promise(resolve => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api/track/preview-document`;
});

afterAll(() => new Promise(resolve => server.close(resolve)));

beforeEach(() => {
  query.mockClear();
  fetchStorefrontPreviewHtml.mockClear();
});

function get(params) {
  return fetch(`${base}?${new URLSearchParams(params).toString()}`);
}

describe('GET /track/preview-document', () => {
  it('takes the shop from a myshopify preview url when shop= is missing', async () => {
    const res = await get({ url: 'https://picker-a.myshopify.com/products/tee' });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-ripx-shop="picker-a.myshopify.com"');
    expect(html).toContain('script.js?shop=picker-a.myshopify.com');
    expect(query.mock.calls[0][1]).toEqual(['picker-a.myshopify.com']);
    expect(fetchStorefrontPreviewHtml).toHaveBeenCalledTimes(1);
  });

  it('explains a missing shop with a page, not an empty comment', async () => {
    const res = await get({ url: 'https://shop.example.com/products/tee' });
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toMatch(/html/);
    const html = await res.text();
    expect(html).toContain('Shop not specified');
    expect(html).toContain('ripx-preview-error');
    expect(fetchStorefrontPreviewHtml).not.toHaveBeenCalled();
  });

  it('explains a store Priceify is not installed on', async () => {
    query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const res = await get({
      url: 'https://picker-b.myshopify.com/',
      shop: 'picker-b.myshopify.com',
    });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('Priceify is not connected to this store');
    expect(fetchStorefrontPreviewHtml).not.toHaveBeenCalled();
  });

  it('explains when the install check cannot run', async () => {
    query.mockRejectedValueOnce(new Error('db down'));
    const res = await get({ url: 'https://picker-c.myshopify.com/' });
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('Try Pick again in a moment');
  });
});
