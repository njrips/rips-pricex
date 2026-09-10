/**
 * Trims the two tables that grow without anything ever removing a row.
 *
 * Both are ledgers rather than records: nothing reads them outside a fixed
 * recent window, so rows past that window cost storage and index depth and buy
 * nothing back. Left alone they grow with traffic forever, and the visitor
 * ledger grows fastest of anything we write — one row per product per unique
 * visitor per day.
 *
 * Deliberately not swept here:
 *  - `events`, the raw per-visitor analytics a finished test's numbers are
 *    derived from. Deleting those would rewrite history a merchant can still
 *    open, so how long to keep them is a product decision and not this job's
 *    call. They already disappear with their test through ON DELETE CASCADE.
 *  - the daily view rollups, which hold one row per product per day. Small
 *    enough to keep for the long history, unlike the visitor ledger beside them.
 */

const logger = require('../utils/logger');
const { query: defaultQuery } = require('../utils/database');

/**
 * How long the unique-visitor ledger is kept.
 *
 * Readers cap their look-back at 120 days, so this leaves a wide margin over
 * the longest window anyone can ask for while still bounding the table.
 */
const VIEW_SESSION_RETENTION_DAYS = 180;

/**
 * How long spent login codes are kept past their expiry.
 *
 * A code is unusable the moment it expires — `consume` refuses anything past
 * `expires_at` or already used — so these are only kept long enough to stay
 * useful when looking into a login problem after the fact.
 */
const OTP_RETENTION_DAYS = 7;

/**
 * Rows removed per statement.
 *
 * A single unbounded DELETE over months of backlog holds locks and bloats WAL
 * for as long as it takes. Batching keeps each statement short; the sweep runs
 * often enough that the remainder goes on the next pass.
 */
const DELETE_BATCH = 20000;

async function sweepViewSessions(query) {
  // `day` is a UTC calendar date, matching how the tracker stamps it.
  const { rowCount } = await query(
    `DELETE FROM catalog_product_view_sessions
     WHERE (shop_domain, product_id, session_key, day) IN (
       SELECT shop_domain, product_id, session_key, day
       FROM catalog_product_view_sessions
       WHERE day < (NOW() AT TIME ZONE 'UTC')::date - ($1::int * INTERVAL '1 day')
       LIMIT $2
     )`,
    [VIEW_SESSION_RETENTION_DAYS, DELETE_BATCH]
  );
  return rowCount || 0;
}

async function sweepExpiredLoginCodes(query) {
  const { rowCount } = await query(
    `DELETE FROM staff_login_otp_codes
     WHERE id IN (
       SELECT id FROM staff_login_otp_codes
       WHERE expires_at < NOW() - ($1::int * INTERVAL '1 day')
       LIMIT $2
     )`,
    [OTP_RETENTION_DAYS, DELETE_BATCH]
  );
  return rowCount || 0;
}

/**
 * Runs one retention pass.
 *
 * Each table is swept independently: a table that fails, or does not exist on
 * an older database, must not stop the others from being trimmed.
 */
async function sweepExpiredData({ query = defaultQuery } = {}) {
  const result = { viewSessions: 0, loginCodes: 0, failures: [] };

  const tasks = [
    ['catalog_product_view_sessions', sweepViewSessions, 'viewSessions'],
    ['staff_login_otp_codes', sweepExpiredLoginCodes, 'loginCodes'],
  ];

  for (const [table, run, key] of tasks) {
    try {
      result[key] = await run(query);
    } catch (err) {
      result.failures.push(table);
      logger.warn('retention sweep failed for table', { table, message: err.message });
    }
  }

  if (result.viewSessions > 0 || result.loginCodes > 0) {
    logger.info('retention sweep removed expired rows', {
      viewSessions: result.viewSessions,
      loginCodes: result.loginCodes,
    });
  }

  return result;
}

module.exports = {
  sweepExpiredData,
  VIEW_SESSION_RETENTION_DAYS,
  OTP_RETENTION_DAYS,
  DELETE_BATCH,
};
