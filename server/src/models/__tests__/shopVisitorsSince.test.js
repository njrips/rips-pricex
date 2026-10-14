/**
 * The list's "Visitors this month" card. It used to add up each row's visitors,
 * which is every visitor since each test began, under a label that says this
 * month.
 */
jest.mock('../../utils/database', () => ({ query: jest.fn() }));

const { query } = require('../../utils/database');
const { getShopVisitorsSince } = require('../analytics');

beforeEach(() => {
  query.mockReset();
});

describe('visitors since the start of the month', () => {
  it('counts distinct shoppers by when they entered, from the counted view', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ ready: true }] })
      .mockResolvedValueOnce({ rows: [{ visitors: 42 }] });
    const n = await getShopVisitorsSince(' Demo.myshopify.com ', new Date('2026-10-01T00:00:00Z'));
    expect(n).toBe(42);
    const [sql, params] = query.mock.calls[1];
    expect(sql).toContain('COUNT(DISTINCT ta.user_id)');
    expect(sql).toContain('FROM counted_test_assignments ta');
    expect(sql).toContain('COALESCE(ta.exposed_at, ta.assigned_at) >= $2');
    expect(params).toEqual(['demo.myshopify.com', '2026-10-01T00:00:00.000Z']);
  });

  it('answers 0 without asking the database for a missing shop or a bad date', async () => {
    expect(await getShopVisitorsSince('', new Date())).toBe(0);
    expect(await getShopVisitorsSince('demo.myshopify.com', 'not a date')).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
});
