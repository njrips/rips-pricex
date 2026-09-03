/**
 * Short-lived leases that stop a periodic job running on top of itself.
 *
 * The background jobs are `setInterval` timers over work whose duration grows
 * with the shop's catalogue, so a pass can outlast its own interval. Two passes
 * over the same shop then read the same state, each decide the same products
 * need an email, and both send one — while their writes clobber each other, so
 * the record of having sent it is lost too.
 *
 * An in-process flag would cover a single server. This is stored in Postgres so
 * it holds across instances, and it expires on its own so a process that dies
 * mid-pass does not block the job forever.
 */

const { query } = require('./database');
const logger = require('./logger');

/** Enough for a slow full pass, short enough that a crash costs one cycle. */
const DEFAULT_LEASE_SECONDS = 15 * 60;

/** Identifies this process, so a lease is only released by whoever took it. */
const HOLDER = `${process.pid}.${Math.random().toString(36).slice(2, 10)}`;

function leaseKey(name) {
  return `job_lease.${String(name || '').trim()}`;
}

/**
 * The lock name for deciding one product's rollout.
 *
 * Three separate code paths can write a product's winning price: a merchant
 * applying one row, the bulk apply, and the unattended auto-apply — and the
 * automatic one does not share the manual one's implementation. They all take
 * this name so only one of them can be mid-write at a time.
 */
function productRolloutLeaseName(shopDomain, testId) {
  return `product_rollout.${String(shopDomain || '')
    .trim()
    .toLowerCase()}.${String(testId || '').trim()}`;
}

/**
 * Takes the lease if it is free or expired.
 *
 * The whole thing is one statement so two callers cannot both believe they won:
 * the conflicting update only applies when the existing row is older than the
 * TTL, and `RETURNING` is empty when it does not apply.
 *
 * @param {string} name
 * @param {number} [ttlSeconds]
 * @param {{ failClosed?: boolean }} [options] - `failClosed` refuses to run when
 *   the lease store is unreachable. Use it for work that must never happen
 *   twice, such as writing a price to a merchant's catalogue; leave it off for
 *   periodic sweeps where a duplicate pass is cheaper than a skipped one.
 * @returns {Promise<boolean>} true when the caller may proceed
 */
async function acquireJobLease(name, ttlSeconds = DEFAULT_LEASE_SECONDS, options = {}) {
  const key = leaseKey(name);
  if (!key || key === 'job_lease.') return true;
  const ttl = Number.isFinite(Number(ttlSeconds)) && Number(ttlSeconds) > 0
    ? Math.floor(Number(ttlSeconds))
    : DEFAULT_LEASE_SECONDS;
  try {
    const result = await query(
      `INSERT INTO key_value_store (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, updated_at = NOW()
         WHERE key_value_store.updated_at < NOW() - make_interval(secs => $3)
       RETURNING key`,
      [key, HOLDER, ttl]
    );
    return (result.rowCount || 0) > 0;
  } catch (error) {
    if (options && options.failClosed) {
      // Without the lease there is nothing stopping a second writer, and two
      // concurrent price writes can leave the catalogue and the saved revert
      // baseline disagreeing. Refuse instead.
      logger.error('job lease unavailable, refusing to run guarded work', {
        job: name,
        message: error.message,
      });
      return false;
    }
    // A lease that cannot be taken must not stop the work it guards, or a
    // storage hiccup would silently halt every background job.
    logger.warn('job lease unavailable, running unguarded', {
      job: name,
      message: error.message,
    });
    return true;
  }
}

/** Frees the lease, but only if this process still holds it. */
async function releaseJobLease(name) {
  const key = leaseKey(name);
  if (!key || key === 'job_lease.') return;
  await query(
    `UPDATE key_value_store
        SET updated_at = NOW() - make_interval(years => 1)
      WHERE key = $1 AND value = $2`,
    [key, HOLDER]
  ).catch(() => null);
}

/**
 * Runs `fn` only if the lease is free, and always gives it back.
 *
 * @returns {Promise<{ran: boolean, result?: any}>}
 */
async function withJobLease(name, ttlSeconds, fn, options = {}) {
  const acquired = await acquireJobLease(name, ttlSeconds, options);
  if (!acquired) {
    logger.info('skipping job, previous run still in progress', { job: name });
    return { ran: false };
  }
  try {
    return { ran: true, result: await fn() };
  } finally {
    await releaseJobLease(name);
  }
}

/** An interactive apply is quick; this only has to outlive one Shopify write. */
const ROLLOUT_LEASE_SECONDS = 120;

module.exports = {
  acquireJobLease,
  releaseJobLease,
  withJobLease,
  productRolloutLeaseName,
  DEFAULT_LEASE_SECONDS,
  ROLLOUT_LEASE_SECONDS,
  HOLDER,
};
