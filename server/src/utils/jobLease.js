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

/**
 * Pushes the expiry out while the holder is still working.
 *
 * The TTL has to be short or a crashed process blocks the job until it lapses,
 * but the guarded work is not short: writing a winning price walks a catalogue
 * of up to 2000 variants against Shopify's rate limit. Without this the lease
 * lapses mid-write, a second caller acquires it, and two writers race over the
 * same catalogue — the exact outcome the lease exists to prevent.
 *
 * @returns {Promise<boolean>} false when the lease has already been taken over.
 */
async function renewJobLease(name) {
  const key = leaseKey(name);
  if (!key || key === 'job_lease.') return true;
  try {
    const result = await query(
      `UPDATE key_value_store
          SET updated_at = NOW()
        WHERE key = $1 AND value = $2
        RETURNING key`,
      [key, HOLDER]
    );
    return (result.rowCount || 0) > 0;
  } catch (error) {
    // Treated as still held: a storage hiccup is not evidence of a takeover,
    // and the caller is already mid-write with nothing useful to do about it.
    logger.warn('could not renew job lease', { job: name, message: error.message });
    return true;
  }
}

/**
 * Renews `name` in the background until the returned function is called.
 *
 * @param {string} name
 * @param {number} [ttlSeconds] - Must match the TTL the lease was taken with.
 * @returns {() => void} Stops renewing. Safe to call more than once.
 */
function startJobLeaseHeartbeat(name, ttlSeconds = DEFAULT_LEASE_SECONDS) {
  const ttl =
    Number.isFinite(Number(ttlSeconds)) && Number(ttlSeconds) > 0
      ? Math.floor(Number(ttlSeconds))
      : DEFAULT_LEASE_SECONDS;
  // A third of the TTL, so two beats can fail before the lease is at risk.
  const periodMs = Math.max(1000, Math.floor((ttl * 1000) / 3));
  let stopped = false;

  const timer = setInterval(() => {
    if (stopped) return;
    renewJobLease(name)
      .then(held => {
        if (held || stopped) return;
        // Someone else now owns it, so this process is no longer the only
        // writer. Nothing here can undo work already done; surface it.
        logger.error('job lease was taken over while its work was still running', {
          job: name,
        });
      })
      .catch(() => null);
  }, periodMs);
  // Never a reason to keep the process alive for a heartbeat.
  if (typeof timer.unref === 'function') timer.unref();

  return function stopJobLeaseHeartbeat() {
    stopped = true;
    clearInterval(timer);
  };
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
  const stopHeartbeat = startJobLeaseHeartbeat(name, ttlSeconds);
  try {
    return { ran: true, result: await fn() };
  } finally {
    stopHeartbeat();
    await releaseJobLease(name);
  }
}

/** An interactive apply is quick; this only has to outlive one Shopify write. */
const ROLLOUT_LEASE_SECONDS = 120;

module.exports = {
  acquireJobLease,
  renewJobLease,
  startJobLeaseHeartbeat,
  releaseJobLease,
  withJobLease,
  productRolloutLeaseName,
  DEFAULT_LEASE_SECONDS,
  ROLLOUT_LEASE_SECONDS,
  HOLDER,
};
