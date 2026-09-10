/**
 * Nothing ever removed a row from the unique-visitor ledger or the login-code
 * table. The ledger takes one row per product per unique visitor per day, so it
 * grew faster than anything else we write, and spent login codes accumulated
 * indefinitely despite being unusable the moment they expired.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  sweepExpiredData,
  VIEW_SESSION_RETENTION_DAYS,
  OTP_RETENTION_DAYS,
  DELETE_BATCH,
} = require('../dataRetentionService');

function recorder(handler) {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    return handler ? handler(sql, params) : { rowCount: 0 };
  };
  return { calls, query };
}

test('dataRetentionService', async t => {
  await t.test('trims both ledgers past their retention window', async () => {
    const { calls, query } = recorder(() => ({ rowCount: 3 }));

    const result = await sweepExpiredData({ query });

    assert.equal(result.viewSessions, 3);
    assert.equal(result.loginCodes, 3);
    assert.deepEqual(result.failures, []);
    assert.equal(calls.length, 2);

    const sessions = calls[0];
    assert.match(sessions.sql, /DELETE FROM catalog_product_view_sessions/);
    assert.equal(sessions.params[0], VIEW_SESSION_RETENTION_DAYS);

    const codes = calls[1];
    assert.match(codes.sql, /DELETE FROM staff_login_otp_codes/);
    assert.equal(codes.params[0], OTP_RETENTION_DAYS);
  });

  await t.test('keeps well past the longest window a reader can ask for', () => {
    // Callers clamp their look-back to 120 days. Retention has to sit above
    // that, or the sweep would delete rows the analytics still count.
    assert.ok(VIEW_SESSION_RETENTION_DAYS > 120);
  });

  await t.test('cuts the visitor ledger on the UTC day the tracker writes', async () => {
    const { calls, query } = recorder();
    await sweepExpiredData({ query });
    assert.match(calls[0].sql, /\(NOW\(\) AT TIME ZONE 'UTC'\)::date/);
    assert.ok(!calls[0].sql.includes('CURRENT_DATE'));
  });

  await t.test('deletes in bounded batches rather than one long statement', async () => {
    // An unbounded DELETE over months of backlog holds locks for its whole
    // duration; the next pass picks up whatever is left.
    const { calls, query } = recorder();
    await sweepExpiredData({ query });
    calls.forEach(call => {
      assert.match(call.sql, /LIMIT \$2/);
      assert.equal(call.params[1], DELETE_BATCH);
    });
  });

  await t.test('still sweeps the second table when the first one fails', async () => {
    // On a database predating either table one DELETE raises "relation does not
    // exist". That must not cost the other table its sweep.
    const { calls, query } = recorder(sql => {
      if (sql.includes('catalog_product_view_sessions')) {
        throw new Error('relation "catalog_product_view_sessions" does not exist');
      }
      return { rowCount: 5 };
    });

    const result = await sweepExpiredData({ query });

    assert.equal(calls.length, 2);
    assert.equal(result.viewSessions, 0);
    assert.equal(result.loginCodes, 5);
    assert.deepEqual(result.failures, ['catalog_product_view_sessions']);
  });

  await t.test('reports zero rather than throwing when a driver omits rowCount', async () => {
    const { query } = recorder(() => ({}));
    const result = await sweepExpiredData({ query });
    assert.equal(result.viewSessions, 0);
    assert.equal(result.loginCodes, 0);
  });
});
