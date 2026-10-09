jest.mock('../../utils/database', () => ({
  query: jest.fn(async () => ({ rowCount: 1, rows: [] })),
}));

jest.mock('../../utils/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
}));

const express = require('express');
const { query } = require('../../utils/database');
const trackRoutes = require('../trackSlimRoutes');

let server;
let base;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/track', trackRoutes);
  app.use('/api/proxy', trackRoutes);
  await new Promise(resolve => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise(resolve => server.close(resolve)));

beforeEach(() => {
  query.mockClear();
  query.mockResolvedValue({ rowCount: 1, rows: [] });
});

describe('track tenant boundaries', () => {
  it('rejects an event for a shop that is not installed', async () => {
    query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const response = await fetch(`${base}/api/track/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shop: 'missing.myshopify.com',
        test_id: '11111111-1111-1111-1111-111111111111',
        variant_id: 'control',
      }),
    });
    expect(response.status).toBe(403);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('inserts an event only when the test and variant belong to the shop', async () => {
    const response = await fetch(`${base}/api/track/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shop: 'demo.myshopify.com',
        test_id: '11111111-1111-1111-1111-111111111111',
        variant_id: 'control',
        event_type: 'view',
      }),
    });
    expect(response.status).toBe(200);
    const insert = query.mock.calls.map(call => String(call[0])).find(sql => sql.includes('INSERT INTO events'));
    expect(insert).toContain('LOWER(TRIM(t.shop_domain))');
    expect(insert).toContain("variant->>'id'");
  });

  it('requires an app proxy signature on /api/proxy', async () => {
    const response = await fetch(`${base}/api/proxy/ping?shop=demo.myshopify.com`);
    expect(response.status).toBe(401);
  });
});
