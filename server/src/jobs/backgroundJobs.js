/**
 * Background processors for RipsPriceX (in-process timers for MVP).
 */
const logger = require('../utils/logger');
const { query } = require('../utils/database');
const {
  scheduleSmartPricingInboxSync,
} = require('../services/smartPricing/smartPricingInboxStopSyncService');

let timersStarted = false;

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
       AND t.type IN ('price','pricing')
       AND t.status = 'running'
       AND (
         s.entitlement_status IS NULL
         OR lower(s.entitlement_status) IN ('none','cancelled','canceled','frozen','expired')
         OR s.uninstalled_at IS NOT NULL
       )`
  ).catch((err) => logger.warn('pauseStaleRunning failed', { message: err.message }));
}

async function syncAllInboxes(reason = 'interval') {
  const shops = await listInstalledShops();
  for (const shop of shops) {
    // scheduleSmartPricingInboxSync(shop, testId, meta) — never pass reason as testId
    const { rows } = await query(
      `SELECT id FROM tests
       WHERE LOWER(TRIM(shop_domain)) = LOWER(TRIM($1))
         AND type IN ('price', 'pricing')
         AND status IN ('running', 'stopped', 'paused')
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 50`,
      [shop]
    ).catch(() => ({ rows: [] }));
    for (const row of rows) {
      if (!row?.id) continue;
      scheduleSmartPricingInboxSync(shop, row.id, { reason });
    }
  }
}

function startBackgroundJobs() {
  if (timersStarted) return;
  timersStarted = true;
  const inboxMs = Number(process.env.RIPSPRICEX_INBOX_SYNC_MS || 5 * 60 * 1000);
  const cancelMs = Number(process.env.RIPSPRICEX_CANCEL_POLICY_MS || 10 * 60 * 1000);

  setInterval(() => {
    syncAllInboxes('interval').catch(() => {});
  }, inboxMs);

  setInterval(() => {
    pauseStaleRunningOnCancelPolicy().catch(() => {});
  }, cancelMs);

  logger.info('RipsPriceX background jobs started', { inboxMs, cancelMs });
}

module.exports = {
  startBackgroundJobs,
  syncAllInboxes,
  pauseStaleRunningOnCancelPolicy,
};
