/**
 * Purchases from the orders/create webhook: one conversion per order, per test,
 * per visitor, on the visitor's assigned arm, worth the merchandise subtotal.
 */
const mockClientQuery = jest.fn(async () => ({ rowCount: 1, rows: [] }));
jest.mock('../../utils/database', () => ({
  query: jest.fn(),
  withTransaction: jest.fn(async fn => fn({ query: mockClientQuery })),
}));

const { query } = require('../../utils/database');
const {
  recordOrderConversions,
  cancelOrderConversions,
  refundOrderConversions,
  extractTestedLines,
  lineRevenue,
} = require('../orderConversionService');
const { signPriceAssignment } = require('../../utils/priceAssignmentSignature');

const TEST_ID = '3f2b7a1c-1111-4c2d-9e8f-0123456789ab';
const SHOP = 'demo.myshopify.com';

function testedLine(overrides = {}) {
  return {
    price: '40.00',
    price_set: { shop_money: { amount: '40.00' } },
    quantity: 2,
    discount_allocations: [{ amount_set: { shop_money: { amount: '5.00' } } }],
    properties: [
      { name: '_ripx_price_test', value: TEST_ID },
      { name: '_ripx_variant', value: 'challenger' },
      { name: '_ripx_assignment_user', value: 'user_1' },
      { name: '_ripx_assignment_sig', value: 'unsigned:1' },
      { name: '_ripx_assignment_ts', value: '1' },
    ],
    ...overrides,
  };
}

function order(overrides = {}) {
  return {
    id: 5678901234567,
    created_at: '2026-10-05T10:00:00-04:00',
    currency: 'USD',
    presentment_currency: 'EUR',
    subtotal_price: '95.00',
    subtotal_price_set: { shop_money: { amount: '95.00' } },
    line_items: [testedLine(), { price: '20.00', quantity: 1, properties: [] }],
    ...overrides,
  };
}

beforeEach(() => {
  mockClientQuery.mockReset();
  mockClientQuery.mockResolvedValue({ rowCount: 1, rows: [] });
  query.mockReset();
  query.mockResolvedValue({ rows: [{ variant_id: 'challenger' }], rowCount: 1 });
});

describe('extractTestedLines', () => {
  it('groups tested lines and ignores lines no test priced', () => {
    const lines = extractTestedLines(order({ line_items: [testedLine(), testedLine({ quantity: 1, discount_allocations: [] })] }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      testId: TEST_ID,
      variantId: 'challenger',
      userId: 'user_1',
      testedQuantity: 3,
      testedRevenue: 115,
    });
  });

  it('skips lines without a visitor or with a malformed test id', () => {
    const noUser = testedLine({
      properties: [
        { name: '_ripx_price_test', value: TEST_ID },
        { name: '_ripx_variant', value: 'challenger' },
      ],
    });
    const badId = testedLine({
      properties: [
        { name: '_ripx_price_test', value: "1'; DROP TABLE events; --" },
        { name: '_ripx_variant', value: 'challenger' },
        { name: '_ripx_assignment_user', value: 'user_1' },
      ],
    });
    expect(extractTestedLines(order({ line_items: [noUser, badId] }))).toEqual([]);
  });

  it('nets line discounts out of line revenue', () => {
    expect(lineRevenue(testedLine())).toBe(75);
  });
});

describe('recordOrderConversions', () => {
  it('replaces a browser report of the order with one subtotal-valued conversion on the assigned arm', async () => {
    query.mockResolvedValueOnce({ rows: [{ variant_id: 'control' }], rowCount: 1 });
    const result = await recordOrderConversions(' Demo.MyShopify.com ', order());

    expect(result).toEqual({ recorded: 1, skipped: [] });
    const [deleteSql, deleteParams] = mockClientQuery.mock.calls[0];
    expect(deleteSql).toMatch(/DELETE FROM events/);
    expect(deleteParams).toEqual([TEST_ID, 'user_1', SHOP, '5678901234567']);

    const [insertSql, params] = mockClientQuery.mock.calls[1];
    expect(insertSql).toMatch(/ON CONFLICT DO NOTHING/);
    expect(params[1]).toBe('control');
    expect(params[4]).toBe(95);
    expect(JSON.parse(params[5])).toEqual({
      order_id: '5678901234567',
      source: 'order_webhook',
      currency: 'USD',
      presentment_currency: 'EUR',
      tested_revenue: 75,
      tested_quantity: 2,
    });
    expect(params[6]).toBe('2026-10-05T14:00:00.000Z');
  });

  it('records nothing for a visitor the test never assigned', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const result = await recordOrderConversions(SHOP, order());
    expect(result).toEqual({ recorded: 0, skipped: [{ testId: TEST_ID, reason: 'no_assignment' }] });
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it('ignores orders with no tested line or already cancelled', async () => {
    expect(await recordOrderConversions(SHOP, order({ line_items: [{ properties: [] }] }))).toEqual({
      recorded: 0,
      skipped: [],
    });
    expect(await recordOrderConversions(SHOP, order({ cancelled_at: '2026-10-05T11:00:00Z' }))).toEqual({
      recorded: 0,
      skipped: [],
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses a line whose signed proof was edited, but not one that has only aged', async () => {
    const previous = process.env.RIPX_PRICE_ASSIGNMENT_SIGNATURE_SECRET;
    process.env.RIPX_PRICE_ASSIGNMENT_SIGNATURE_SECRET = 'test-secret';
    try {
      const issuedAtMs = Date.parse('2026-01-01T00:00:00Z');
      const sig = signPriceAssignment({
        testId: TEST_ID,
        variantId: 'challenger',
        userId: 'user_1',
        shopDomain: SHOP,
        issuedAtMs,
      });
      const withProof = (variant, signature) =>
        testedLine({
          properties: [
            { name: '_ripx_price_test', value: TEST_ID },
            { name: '_ripx_variant', value: variant },
            { name: '_ripx_assignment_user', value: 'user_1' },
            { name: '_ripx_assignment_sig', value: signature },
            { name: '_ripx_assignment_ts', value: String(issuedAtMs) },
          ],
        });

      const aged = await recordOrderConversions(SHOP, order({ line_items: [withProof('challenger', sig)] }));
      expect(aged.recorded).toBe(1);

      const edited = await recordOrderConversions(SHOP, order({ line_items: [withProof('control', sig)] }));
      expect(edited).toEqual({
        recorded: 0,
        skipped: [{ testId: TEST_ID, reason: 'invalid_assignment_signature' }],
      });
    } finally {
      if (previous === undefined) delete process.env.RIPX_PRICE_ASSIGNMENT_SIGNATURE_SECRET;
      else process.env.RIPX_PRICE_ASSIGNMENT_SIGNATURE_SECRET = previous;
    }
  });
});

describe('recordOrderConversions on redelivery', () => {
  it('replaces only the browser’s report and never a row the webhook wrote', async () => {
    await recordOrderConversions(SHOP, order());
    const [deleteSql] = mockClientQuery.mock.calls[0];
    expect(deleteSql).toMatch(/metadata->>'source', ''\) <> 'order_webhook'/);
    const [insertSql, params] = mockClientQuery.mock.calls[1];
    expect(insertSql).toMatch(/WHERE NOT EXISTS/);
    expect(params[7]).toBe('5678901234567');
  });
});

describe('refundOrderConversions', () => {
  const refund = {
    id: 9001,
    order_id: 5678901234567,
    processed_at: '2026-10-07T09:00:00Z',
    refund_line_items: [
      {
        quantity: 1,
        subtotal_set: { shop_money: { amount: '37.50' } },
        line_item: testedLine(),
      },
      { quantity: 1, subtotal: '20.00', line_item: { properties: [] } },
    ],
  };

  it('takes refunded merchandise off the order once per refund', async () => {
    query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    expect(await refundOrderConversions(SHOP, refund)).toEqual({ refunded: 1 });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/GREATEST\(0, COALESCE\(event_value, 0\) - \$3::numeric\)/);
    expect(sql).toMatch(/refund_ids', '\[\]'::jsonb\) \? \$4/);
    expect(sql).toMatch(/refunded_in_full_at/);
    expect(params).toEqual([
      SHOP,
      '5678901234567',
      57.5,
      '9001',
      JSON.stringify({ [TEST_ID]: 37.5 }),
      '2026-10-07T09:00:00.000Z',
    ]);
  });

  it('ignores a refund with no merchandise in it', async () => {
    expect(
      await refundOrderConversions(SHOP, { ...refund, refund_line_items: [] })
    ).toEqual({ refunded: 0 });
    expect(query).not.toHaveBeenCalled();
  });
});

describe('cancelOrderConversions', () => {
  it('marks the order’s conversions cancelled once', async () => {
    query.mockResolvedValueOnce({ rowCount: 2, rows: [] });
    const result = await cancelOrderConversions(SHOP, {
      id: 42,
      cancelled_at: '2026-10-06T08:00:00Z',
    });
    expect(result).toEqual({ cancelled: 2 });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/cancelled_at/);
    expect(sql).toMatch(/NOT \(COALESCE\(metadata/);
    expect(params).toEqual([SHOP, '42', '2026-10-06T08:00:00.000Z']);
  });
});
