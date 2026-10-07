/**
 * Storefront exposure: the first time a shopper is shown a tested product.
 * Posted as text/plain so it needs no preflight and survives the page closing.
 */
jest.mock('../../utils/database', () => ({
  query: jest.fn(async () => ({ rowCount: 2, rows: [] })),
}));

const express = require('express');
const { query } = require('../../utils/database');
const trackRoutes = require('../trackSlimRoutes');

const TEST_A = '3f2b7a1c-1111-4c2d-9e8f-0123456789ab';
const TEST_B = '3f2b7a1c-2222-4c2d-9e8f-0123456789ab';

let server;
let base;

beforeAll(async () => {
  const app = express();
  app.use(express.text({ type: 'text/plain' }), (req, _res, next) => {
    if (typeof req.body === 'string') req.body = JSON.parse(req.body || '{}');
    next();
  });
  app.use(express.json());
  app.use('/api/track', trackRoutes);
  await new Promise(resolve => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api/track`;
});

afterAll(() => new Promise(resolve => server.close(resolve)));

beforeEach(() => query.mockClear());

function post(body) {
  return fetch(`${base}/exposure`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify(body),
  });
}

describe('POST /track/exposure', () => {
  it('stamps the first exposure on the shopper’s existing assignments', async () => {
    const res = await post({
      shop_domain: 'Demo.myshopify.com',
      user_id: 'user_1',
      test_ids: [TEST_A, TEST_A.toUpperCase(), TEST_B, 'not-a-uuid'],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, exposed: 2 });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/SET exposed_at = NOW\(\)/);
    expect(sql).toMatch(/WHERE exposed_at IS NULL/);
    expect(params).toEqual(['user_1', 'demo.myshopify.com', [TEST_A, TEST_B]]);
  });

  it('refuses a post with no visitor or no valid test', async () => {
    expect((await post({ shop_domain: 'demo.myshopify.com', test_ids: [TEST_A] })).status).toBe(400);
    expect(
      (await post({ shop_domain: 'demo.myshopify.com', user_id: 'u', test_ids: ['x'] })).status
    ).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('is a no-op on a database without the exposure column', async () => {
    query.mockRejectedValueOnce(Object.assign(new Error('column does not exist'), { code: '42703' }));
    const res = await post({ shop_domain: 'demo.myshopify.com', user_id: 'u', test_ids: [TEST_A] });
    expect(await res.json()).toEqual({ ok: true, exposed: 0 });
  });
});
