/**
 * Background processors for RipsPriceX (in-process timers for MVP).
 */
const logger = require('../utils/logger');
const { query } = require('../utils/database');
const { listInboxPlans } = require('../models/smartPricingInboxStore');
const {
  syncSmartPricingInboxForTest,
} = require('../services/smartPricing/smartPricingInboxStopSyncService');
const {
  evaluateShopAutoWinners,
} = require('../services/smartPricing/smartPricingAutoWinnerService');
const {
  sweepShopRolloutReadiness,
} = require('../services/smartPricing/smartPricingRolloutNotifyService');

let timersStarted = false;

/** Passes currently running, so a tick can be dropped instead of piling up. */
const running = new Set();

/**
 * How long one instance holds a shop's inbox sync.
 *
 * Long enough to cover a slow pass over the shop's 50-test window, short enough
 * that a crashed instance does not hold the shop past the next interval.
 */
const INBOX_SYNC_LEASE_SECONDS = 240;

/**
 * Schedules an async pass that never overlaps itself.
 *
 * Each pass walks every installed shop, so its duration grows with the number of
 * shops and their catalogues and can exceed the interval. A bare `setInterval`
 * would then start a second pass over the same data while the first was still
 * going. The services have their own cross-instance locks; this just avoids
 * queueing up redundant work in the first place.
 */
function runGuarded(name, run) {
  if (running.has(name)) {
    logger.warn('skipping scheduled pass, previous one still running', { job: name });
    return Promise.resolve();
  }
  running.add(name);
  return Promise.resolve()
    .then(run)
    .catch(err => logger.warn('scheduled pass failed', { job: name, message: err.message }))
    .finally(() => running.delete(name));
}

function everyInterval(name, ms, run) {
  const timer = setInterval(() => {
    runGuarded(name, run);
  }, ms);
  // Never hold the process open for a timer.
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

async function listInstalledShops() {
  // Prefer shops with a live offline token; fall back to shops table.
  const { rows } = await query(
    `SELECT DISTINCT LOWER(TRIM(shop_domain)) AS shop_domain
     FROM (
       SELECT shop_domain FROM shop_sessions
       WHERE access_token IS NOT NULL AND LENGTH(TRIM(access_token)) > 0
       UNION
       SELECT shop_domain FROM shops WHERE uninstalled_at IS NULL
     ) s
     WHERE shop_domain IS NOT NULL AND shop_domain <> ''`
  ).catch(() => ({ rows: [] }));
  return rows.map((r) => r.shop_domain).filter(Boolean);
}

async function pauseStaleRunningOnCancelPolicy() {
  // Shops without entitlement should not keep creating; running tests paused on cancel via markShopUninstalled.
  await query(
    `UPDATE tests t
     SET status = 'paused', updated_at = NOW(), stopped_at = COALESCE(stopped_at, NOW())
     FROM shops s
     WHERE t.shop_domain = s.shop_domain
       AND t.type IN ('price','pricing','offer')
       AND t.status = 'running'
       AND (
         s.entitlement_status IS NULL
         OR lower(s.entitlement_status) IN ('none','cancelled','canceled','frozen','expired')
         OR s.uninstalled_at IS NOT NULL
       )`
  ).catch((err) => logger.warn('pauseStaleRunning failed', { message: err.message }));
}

async function evaluateAllAutoWinners() {
  const shops = await listInstalledShops();
  for (const shop of shops) {
    await evaluateShopAutoWinners(shop).catch(err =>
      logger.warn('auto-winner sweep failed', { shop, message: err.message })
    );
  }
}

/**
 * Records when each product became ready and emails the merchant about it.
 *
 * Runs ahead of the auto-winner sweep in wall-clock terms because the review
 * window it stamps is what holds an unattended price write back.
 */
async function sweepAllRolloutReadiness() {
  const shops = await listInstalledShops();
  for (const shop of shops) {
    await sweepShopRolloutReadiness(shop).catch(err =>
      logger.warn('rollout readiness sweep failed', { shop, message: err.message })
    );
  }
}

async function syncAllInboxes(reason = 'interval') {
  const { acquireJobLease, releaseJobLease } = require('../utils/jobLease');
  const shops = await listInstalledShops();
  for (const shop of shops) {
    // The in-process guard below only covers one Node process. Two instances,
    // or an overlapping deploy, would otherwise sync the same shop at once and
    // spend the same Shopify and analytics calls twice over.
    const lease = `inbox_sync.${shop}`;
    if (!(await acquireJobLease(lease, INBOX_SYNC_LEASE_SECONDS))) {
      continue;
    }
    try {
      const stored = await listInboxPlans(shop, { archived: false }).catch(() => ({ plans: [] }));
      const testIds = [
        ...new Set(
          (stored.plans || [])
            .map(plan => String(plan?.test_id || '').trim())
            .filter(Boolean)
        ),
      ].slice(0, 50);
      for (const testId of testIds) {
        await syncSmartPricingInboxForTest(shop, testId, { reason }).catch(err => {
          logger.warn('inbox interval sync failed', {
            shop,
            testId,
            message: err.message,
          });
        });
      }
    } finally {
      await releaseJobLease(lease);
    }
  }
}

function startBackgroundJobs() {
  if (timersStarted) return;
  timersStarted = true;
  const inboxMs = Number(process.env.RIPSPRICEX_INBOX_SYNC_MS || 5 * 60 * 1000);
  const cancelMs = Number(process.env.RIPSPRICEX_CANCEL_POLICY_MS || 10 * 60 * 1000);
  const autoWinnerMs = Number(process.env.RIPSPRICEX_AUTO_WINNER_MS || 3 * 60 * 1000);
  const readinessMs = Number(process.env.RIPSPRICEX_ROLLOUT_READINESS_MS || 10 * 60 * 1000);

  everyInterval('inbox-sync', inboxMs, () => syncAllInboxes('interval'));
  everyInterval('rollout-readiness', readinessMs, sweepAllRolloutReadiness);
  everyInterval('cancel-policy', cancelMs, pauseStaleRunningOnCancelPolicy);
  everyInterval('auto-winner', autoWinnerMs, evaluateAllAutoWinners);

  // First pass shortly after boot, so a restart does not wait a whole interval.
  // It goes through the same guard as the timers: readiness runs before the
  // auto-winner because the review window it stamps is what holds an unattended
  // price write back.
  const kickoff = setTimeout(() => {
    runGuarded('rollout-readiness', sweepAllRolloutReadiness).finally(() =>
      runGuarded('auto-winner', evaluateAllAutoWinners)
    );
  }, 45000);
  if (typeof kickoff.unref === 'function') kickoff.unref();

  logger.info('Priceify background jobs started', {
    inboxMs,
    cancelMs,
    autoWinnerMs,
    readinessMs,
  });
}

module.exports = {
  startBackgroundJobs,
  syncAllInboxes,
  pauseStaleRunningOnCancelPolicy,
  evaluateAllAutoWinners,
  sweepAllRolloutReadiness,
};
