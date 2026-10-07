/**
 * Shopify's mandatory privacy webhooks. shop/redact has to leave nothing of
 * the shop behind; customers/redact has to cut the order link without moving
 * any test's results.
 */
const mockClientQuery = jest.fn(async () => ({ rowCount: 1, rows: [] }));
jest.mock('../../utils/database', () => ({
  query: jest.fn(async () => ({ rowCount: 2, rows: [] })),
  withTransaction: jest.fn(async fn => fn({ query: mockClientQuery })),
}));
jest.mock('../smartPricing/smartPricingCheckoutReadinessService', () => ({
  clearSmartPricingCheckoutReadinessCache: jest.fn(),
}));
jest.mock('../smartPricing/opportunityService', () => ({
  clearOpportunityCache: jest.fn(),
}));

const fs = require('fs');
const path = require('path');
const { query } = require('../../utils/database');
const {
  SHOP_TABLES,
  redactShop,
  redactCustomerOrders,
  describeCustomerData,
} = require('../privacyComplianceService');

beforeEach(() => {
  mockClientQuery.mockClear();
  query.mockClear();
});

describe('shop/redact', () => {
  it('erases every table that holds the shop, plus its sessions and settings keys', async () => {
    const deleted = await redactShop(' Demo.MyShopify.com ');
    const sql = mockClientQuery.mock.calls.map(([text]) => text);
    for (const table of SHOP_TABLES) {
      expect(sql).toContain(`DELETE FROM ${table} WHERE LOWER(shop_domain) = $1`);
    }
    expect(sql.some(text => text.startsWith('DELETE FROM shop_sessions'))).toBe(true);
    const kv = mockClientQuery.mock.calls.find(([text]) => text.includes('key_value_store'));
    expect(kv[1]).toEqual(['%.demo.myshopify.com', '%.demo.myshopify.com.%']);
    for (const [, params] of mockClientQuery.mock.calls.filter(([t]) => !t.includes('LIKE'))) {
      expect(params).toEqual(['demo.myshopify.com']);
    }
    expect(deleted.shops).toBe(1);
  });

  it('covers every table the migrations create, bar the staff-only one', () => {
    const dir = path.join(__dirname, '../../../../migrations');
    const created = new Set();
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.sql'))) {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      for (const [, table] of sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)) created.add(table);
    }
    const handled = new Set([
      ...SHOP_TABLES,
      'shop_sessions',
      'key_value_store',
      'support_ticket_messages',
      'staff_login_otp_codes',
    ]);
    expect([...created].filter(table => !handled.has(table))).toEqual([]);
  });

  it('refuses to run without a shop', async () => {
    await expect(redactShop('')).rejects.toThrow('shop domain required');
    expect(mockClientQuery).not.toHaveBeenCalled();
  });
});

describe('customers/redact', () => {
  it('strips only the named order ids from that shop’s events', async () => {
    const result = await redactCustomerOrders('demo.myshopify.com', [299938, '280263', 299938, '']);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("metadata = metadata - 'order_id'");
    expect(sql).not.toContain('DELETE');
    expect(params).toEqual(['demo.myshopify.com', ['299938', '280263']]);
    expect(result).toEqual({ events: 2 });
  });

  it('does nothing when there are no orders to redact', async () => {
    expect(await redactCustomerOrders('demo.myshopify.com', [])).toEqual({ events: 0 });
    expect(query).not.toHaveBeenCalled();
  });
});

describe('customers/data_request', () => {
  it('looks up the requested orders for that shop', async () => {
    await describeCustomerData('demo.myshopify.com', [299938]);
    expect(query.mock.calls[0][1]).toEqual(['demo.myshopify.com', ['299938']]);
  });
});
