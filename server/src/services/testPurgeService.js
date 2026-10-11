/**
 * Permanently removes tests that were deleted more than a grace period ago,
 * together with everything recorded against them.
 *
 * Delete is the step after Archive and only marks a test (`status = 'archived'`,
 * `deleted_at`), which hides it at once and keeps the delete undoable for a
 * while. This job does the irreversible part later, in small batches:
 *
 *  - A test can carry millions of visitor assignments. One cascading DELETE of
 *    that size holds row locks and bloats WAL on the tables the storefront is
 *    writing to, so each table is emptied a batch at a time first and the test
 *    row goes last.
 *  - Every batch re-checks that the test is still deleted and still past its
 *    grace period, so a test restored mid-purge loses nothing more.
 *  - It is safe to stop anywhere. A pass cut short by its time budget, a crash
 *    or a deploy is finished by the next one.
 *
 * Kept on purpose: the deletion record, which is what stops a stale browser
 * copy bringing the test back, and -- when a winner was published -- a short
 * record of the catalogue prices it changed, because those changes outlive it.
 */

const logger = require('../utils/logger');
const { query: defaultQuery } = require('../utils/database');
const { productRolloutLeaseName } = require('../utils/jobLease');
const {
  recordTestPurgeDetails,
  TEST_PURGE_GRACE_DAYS,
} = require('../models/smartPricingDeletionStore');

/** Rows removed per statement. Small enough to keep every statement short. */
const PURGE_BATCH = 5000;

/** Tests looked at per pass; the rest wait for the next one. */
const MAX_TESTS_PER_PASS = 200;

/** Wall-clock budget for one pass, well inside the job's lease. */
const PASS_BUDGET_MS = 4 * 60 * 1000;

/** A breather between batches so the purge never monopolises the database. */
const BATCH_PAUSE_MS = 25;

/** Price-change events worth keeping after the test itself is gone. */
const PRICE_EVENT_TYPES = ['winner_applied', 'auto_applied', 'reverted'];
const MAX_KEPT_PRICE_EVENTS = 50;
const MAX_KEPT_PAYLOAD_CHARS = 20000;

/**
 * The tables that hold rows per test, emptied in this order before the test
 * row. `cast` matches the column type: `smart_pricing_product_events.test_id`
 * is text, the others are uuid.
 */
const CHILD_TABLES = [
  { table: 'test_assignments', column: 'test_id', cast: 'uuid' },
  { table: 'events', column: 'test_id', cast: 'uuid' },
  { table: 'analytics_daily', column: 'test_id', cast: 'uuid' },
  { table: 'smart_pricing_product_events', column: 'test_id', cast: 'text' },
  { table: 'smart_pricing_inbox_plans', column: 'test_id', cast: 'uuid' },
];

const STILL_DUE = `EXISTS (
  SELECT 1 FROM tests t
   WHERE t.id = $1::uuid
     AND t.status = 'archived'
     AND t.deleted_at IS NOT NULL
     AND t.deleted_at < NOW() - make_interval(days => $3::int)
)`;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function findTestsDueForPurge(query, { graceDays, limit }) {
  const result = await query(
    `SELECT id::text AS id,
            LOWER(TRIM(shop_domain)) AS shop_domain,
            name,
            deleted_at,
            metadata->>'experiment_id' AS experiment_id
       FROM tests
      WHERE status = 'archived'
        AND deleted_at IS NOT NULL
        AND deleted_at < NOW() - make_interval(days => $1::int)
      ORDER BY deleted_at
      LIMIT $2`,
    [graceDays, limit]
  );
  return result.rows || [];
}

function compactPayload(payload) {
  const text = JSON.stringify(payload ?? {});
  return text.length <= MAX_KEPT_PAYLOAD_CHARS ? payload : { truncated: true };
}

/** What the test changed in the merchant's catalogue, for keeping after it is gone. */
async function readPriceChanges(query, test) {
  const result = await query(
    `SELECT event_type, actor, product_id, payload, created_at
       FROM smart_pricing_product_events
      WHERE shop_domain = $1
        AND test_id = $2
        AND event_type = ANY($3::text[])
      ORDER BY created_at
      LIMIT $4`,
    [test.shop_domain, test.id, PRICE_EVENT_TYPES, MAX_KEPT_PRICE_EVENTS]
  );
  return (result.rows || []).map(row => ({
    event_type: row.event_type,
    actor: row.actor,
    product_id: row.product_id,
    at: row.created_at,
    payload: compactPayload(row.payload),
  }));
}

/**
 * Empties one table for one test, a batch at a time.
 *
 * @returns {Promise<{removed: number, done: boolean}>} `done` is false when the
 *   budget ran out or the test stopped being due.
 */
async function purgeChildTable(query, test, spec, { graceDays, deadline }) {
  let removed = 0;
  for (;;) {
    if (Date.now() >= deadline) return { removed, done: false };
    const result = await query(
      `DELETE FROM ${spec.table}
        WHERE ctid = ANY(ARRAY(
                SELECT ctid FROM ${spec.table}
                 WHERE ${spec.column} = $1::${spec.cast}
                 LIMIT $2))
          AND ${STILL_DUE}`,
      [test.id, PURGE_BATCH, graceDays]
    );
    const count = result.rowCount || 0;
    removed += count;
    if (count < PURGE_BATCH) {
      // Fewer than a batch either means the table is empty for this test or
      // the test stopped being due (restored), which removes nothing at all.
      return { removed, done: true };
    }
    await sleep(BATCH_PAUSE_MS);
  }
}

/**
 * Purges one test. Returns whether the test row itself is gone.
 */
async function purgeTest(query, test, { graceDays, deadline, totals }) {
  const priceChanges = await readPriceChanges(query, test);
  await recordTestPurgeDetails(
    test.shop_domain,
    test.id,
    {
      name: test.name || null,
      experiment_id: test.experiment_id || null,
      deleted_at: test.deleted_at,
      purge_started_at: new Date().toISOString(),
      ...(priceChanges.length ? { price_changes: priceChanges } : {}),
    },
    { query }
  );

  for (const spec of CHILD_TABLES) {
    const { removed, done } = await purgeChildTable(query, test, spec, { graceDays, deadline });
    totals[spec.table] = (totals[spec.table] || 0) + removed;
    if (!done) return false;
  }

  // An expired lock row named after the test. A live one is left to expire:
  // something is mid-write and removing its lock would let a second writer in.
  await query(
    `DELETE FROM key_value_store
      WHERE key = $1 AND updated_at < NOW() - INTERVAL '1 hour'`,
    [`job_lease.${productRolloutLeaseName(test.shop_domain, test.id)}`]
  );

  // Last, and only if still due. Anything written since the batches above
  // (a late storefront event) goes with it through ON DELETE CASCADE.
  const removed = await query(
    `DELETE FROM tests
      WHERE id = $1::uuid
        AND LOWER(TRIM(shop_domain)) = $2
        AND status = 'archived'
        AND deleted_at IS NOT NULL
        AND deleted_at < NOW() - make_interval(days => $3::int)`,
    [test.id, test.shop_domain, graceDays]
  );
  if ((removed.rowCount || 0) === 0) return false;

  await recordTestPurgeDetails(
    test.shop_domain,
    test.id,
    { purged_at: new Date().toISOString() },
    { query }
  );
  return true;
}

/**
 * One purge pass.
 *
 * @returns {Promise<{testsPurged: number, testsStarted: number, rows: object,
 *   complete: boolean, failures: string[]}>} `complete` is false when tests
 *   were left for the next pass.
 */
async function purgeDeletedTests({
  query = defaultQuery,
  graceDays = TEST_PURGE_GRACE_DAYS,
  budgetMs = PASS_BUDGET_MS,
  limit = MAX_TESTS_PER_PASS,
} = {}) {
  const deadline = Date.now() + budgetMs;
  const summary = { testsPurged: 0, testsStarted: 0, rows: {}, complete: true, failures: [] };

  const due = await findTestsDueForPurge(query, { graceDays, limit });
  if (due.length === limit) summary.complete = false;

  for (const test of due) {
    if (Date.now() >= deadline) {
      summary.complete = false;
      break;
    }
    summary.testsStarted += 1;
    try {
      if (await purgeTest(query, test, { graceDays, deadline, totals: summary.rows })) {
        summary.testsPurged += 1;
      } else {
        summary.complete = false;
      }
    } catch (err) {
      // One test failing must not hold back the rest; it is retried next pass.
      summary.failures.push(test.id);
      summary.complete = false;
      logger.warn('test purge failed', {
        shop: test.shop_domain,
        testId: test.id,
        message: err.message,
      });
    }
  }

  if (summary.testsStarted > 0) {
    logger.info('purged deleted tests', {
      testsPurged: summary.testsPurged,
      testsStarted: summary.testsStarted,
      rows: summary.rows,
      complete: summary.complete,
      failures: summary.failures.length,
    });
  }
  return summary;
}

module.exports = {
  purgeDeletedTests,
  TEST_PURGE_GRACE_DAYS,
  PURGE_BATCH,
  CHILD_TABLES,
};
