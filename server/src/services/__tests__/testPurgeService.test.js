jest.mock('../../utils/database', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
}));

const {
  purgeDeletedTests,
  PURGE_BATCH,
  TEST_PURGE_GRACE_DAYS,
  CHILD_TABLES,
} = require('../testPurgeService');

const TEST = {
  id: '11111111-1111-1111-1111-111111111111',
  shop_domain: 'demo.myshopify.com',
  name: 'Smart Pricing · Hoodie',
  deleted_at: '2026-09-01T00:00:00.000Z',
  experiment_id: 'exp_1',
};

/**
 * A database that answers the purge's statements from a script.
 *
 * `rows` is how many rows each child table holds for the test; each batch
 * removes up to PURGE_BATCH of them. `testRowDeleted` is what the final delete
 * of the test row reports.
 */
function fakeDatabase({ due = [TEST], rows = {}, priceEvents = [], testRowDeleted = 1 } = {}) {
  const remaining = { ...rows };
  const calls = [];
  const query = jest.fn(async (sql, params) => {
    const text = String(sql);
    calls.push({ sql: text, params });
    if (text.includes('FROM tests') && text.includes('ORDER BY deleted_at')) {
      return { rows: due };
    }
    if (text.includes('FROM smart_pricing_product_events') && text.startsWith('SELECT')) {
      return { rows: priceEvents };
    }
    const child = CHILD_TABLES.find(spec => text.includes(`DELETE FROM ${spec.table}\n`));
    if (child) {
      const left = remaining[child.table] || 0;
      const removed = Math.min(left, params[1]);
      remaining[child.table] = left - removed;
      return { rowCount: removed };
    }
    if (text.includes('DELETE FROM tests')) return { rowCount: testRowDeleted };
    return { rowCount: 0, rows: [] };
  });
  return { query, calls, remaining };
}

describe('testPurgeService', () => {
  it('empties every child table in batches, then removes the test row last', async () => {
    const db = fakeDatabase({ rows: { test_assignments: PURGE_BATCH * 2 + 10, events: 3 } });

    const summary = await purgeDeletedTests({ query: db.query });

    expect(summary.testsPurged).toBe(1);
    expect(summary.complete).toBe(true);
    expect(summary.rows.test_assignments).toBe(PURGE_BATCH * 2 + 10);
    expect(summary.rows.events).toBe(3);
    expect(db.remaining.test_assignments).toBe(0);

    const assignmentBatches = db.calls.filter(c => c.sql.includes('DELETE FROM test_assignments'));
    expect(assignmentBatches).toHaveLength(3);
    const testRowAt = db.calls.findIndex(c => c.sql.includes('DELETE FROM tests'));
    const lastChildAt = db.calls.reduce(
      (last, c, i) => (CHILD_TABLES.some(s => c.sql.includes(`DELETE FROM ${s.table}\n`)) ? i : last),
      -1
    );
    expect(testRowAt).toBeGreaterThan(lastChildAt);
  });

  it('only touches tests that are deleted and past the grace period', async () => {
    const db = fakeDatabase();

    await purgeDeletedTests({ query: db.query });

    const pick = db.calls[0];
    expect(pick.sql).toContain("status = 'archived'");
    expect(pick.sql).toContain('deleted_at < NOW() - make_interval(days => $1::int)');
    expect(pick.params[0]).toBe(TEST_PURGE_GRACE_DAYS);
    // Every batch re-checks, so a test restored mid-purge loses nothing more.
    db.calls
      .filter(c => c.sql.startsWith('DELETE'))
      .filter(c => !c.sql.includes('key_value_store') && !c.sql.includes('DELETE FROM tests'))
      .forEach(c => expect(c.sql).toContain("t.status = 'archived'"));
    const testRow = db.calls.find(c => c.sql.includes('DELETE FROM tests'));
    expect(testRow.sql).toContain("status = 'archived'");
    expect(testRow.sql).toContain('deleted_at < NOW()');
  });

  it('keeps a record of the prices a published winner changed', async () => {
    const db = fakeDatabase({
      priceEvents: [
        {
          event_type: 'winner_applied',
          actor: 'merchant',
          product_id: 'gid://shopify/Product/1',
          payload: { variants: [{ id: 'v1', previous_price: '20.00', price: '24.00' }] },
          created_at: '2026-08-20T00:00:00.000Z',
        },
      ],
    });

    await purgeDeletedTests({ query: db.query });

    const record = db.calls.find(c => c.sql.includes('INSERT INTO smart_pricing_deletions'));
    const details = JSON.parse(record.params[2]);
    expect(details.price_changes).toHaveLength(1);
    expect(details.price_changes[0].payload.variants[0].previous_price).toBe('20.00');
    expect(details.experiment_id).toBe('exp_1');
    // The plan copy kept for Restore goes once the purge starts.
    expect(record.sql).toContain("- 'plan'");
    const recordAt = db.calls.indexOf(record);
    const firstDeleteAt = db.calls.findIndex(c => c.sql.startsWith('DELETE'));
    expect(recordAt).toBeLessThan(firstDeleteAt);
  });

  it('stops at its time budget and leaves the rest for the next pass', async () => {
    const db = fakeDatabase({ rows: { test_assignments: PURGE_BATCH * 10 } });

    const summary = await purgeDeletedTests({ query: db.query, budgetMs: 0 });

    expect(summary.complete).toBe(false);
    expect(summary.testsPurged).toBe(0);
    expect(db.calls.some(c => c.sql.includes('DELETE FROM tests'))).toBe(false);
  });

  it('does not count a test that stopped being due before its row went', async () => {
    const db = fakeDatabase({ testRowDeleted: 0 });

    const summary = await purgeDeletedTests({ query: db.query });

    expect(summary.testsPurged).toBe(0);
    expect(summary.complete).toBe(false);
  });

  it('carries on past a test that fails', async () => {
    const other = { ...TEST, id: '22222222-2222-2222-2222-222222222222' };
    const db = fakeDatabase({ due: [TEST, other] });
    const answer = db.query.getMockImplementation();
    db.query.mockImplementation(async (sql, params) => {
      if (String(sql).startsWith('DELETE FROM test_assignments') && params[0] === TEST.id) {
        throw new Error('deadlock detected');
      }
      return answer(sql, params);
    });

    const summary = await purgeDeletedTests({ query: db.query });

    expect(summary.failures).toEqual([TEST.id]);
    expect(summary.testsPurged).toBe(1);
  });

  it('removes only an expired lock row named after the test', async () => {
    const db = fakeDatabase();

    await purgeDeletedTests({ query: db.query });

    const lease = db.calls.find(c => c.sql.includes('DELETE FROM key_value_store'));
    expect(lease.params[0]).toBe(`job_lease.product_rollout.demo.myshopify.com.${TEST.id}`);
    expect(lease.sql).toContain("updated_at < NOW() - INTERVAL '1 hour'");
  });
});
