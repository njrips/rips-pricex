jest.mock('../../utils/database', () => ({
  query: jest.fn(async () => ({ rowCount: 0, rows: [] })),
}));

jest.mock('../../utils/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
}));

const express = require('express');
const logger = require('../../utils/logger');
const trackRoutes = require('../trackSlimRoutes');

let server;
let endpoint;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/track', trackRoutes);
  await new Promise(resolve => {
    server = app.listen(0, resolve);
  });
  endpoint = `http://127.0.0.1:${server.address().port}/api/track/client-error`;
});

afterAll(() => new Promise(resolve => server.close(resolve)));

beforeEach(() => {
  logger.warn.mockClear();
});

describe('POST /track/client-error', () => {
  it('accepts loader failures and logs only bounded non-query diagnostics', async () => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'ripx_storefront_init_failed',
        shop_domain: 'Demo.myshopify.com',
        url: 'https://demo.myshopify.com/products/example?email=private@example.com#details',
        metadata: {
          reason: 'runtime_missing_after_retries',
          version: '1.0.66',
          preview: true,
          fallbackConfigured: false,
          attemptCount: 10,
          ignored: 'not logged',
        },
      }),
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true });
    expect(logger.warn).toHaveBeenCalledWith('storefront client error', {
      shop: 'demo.myshopify.com',
      error: 'ripx_storefront_init_failed',
      page: 'https://demo.myshopify.com/products/example',
      metadata: {
        reason: 'runtime_missing_after_retries',
        version: '1.0.66',
        preview: true,
        fallbackConfigured: false,
        attemptCount: 10,
      },
    });
  });
});
