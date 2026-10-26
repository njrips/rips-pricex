/**
 * Support access: a time-limited unlock a console owner gives a store.
 *
 * It never touches the store's Shopify status. Access is "Shopify plan OR a
 * current grant", so when a grant ends or is revoked the store falls back to
 * whatever Shopify says without anything having to run.
 */

const { query, withTransaction } = require('../../utils/database');

const GRANT_DAY_OPTIONS = [1, 3, 7, 14, 30];
const MIN_REASON_LENGTH = 10;

const CURRENT_GRANT_SQL = `revoked_at IS NULL AND starts_at <= NOW() AND expires_at > NOW()`;

function runQuery(sql, params, deps = {}) {
  return (deps.query || query)(sql, params);
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function normalizeDays(value) {
  const days = Number(value);
  return GRANT_DAY_OPTIONS.includes(days) ? days : 0;
}

function normalizeReason(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 500);
}

function presentGrant(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    shopDomain: row.shop_domain,
    reason: row.reason,
    startsAt: row.starts_at,
    expiresAt: row.expires_at,
    grantedBy: row.granted_by,
    revokedAt: row.revoked_at || null,
    revokedBy: row.revoked_by || null,
    revokeReason: row.revoke_reason || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The grant giving this shop access right now, or null. Missing table reads as none. */
async function getCurrentGrant(shopDomain, deps = {}) {
  const { rows } = await runQuery(
    `SELECT * FROM support_access_grants
     WHERE shop_domain = $1 AND ${CURRENT_GRANT_SQL}
     ORDER BY expires_at DESC LIMIT 1`,
    [shopDomain],
    deps
  ).catch(() => ({ rows: [] }));
  return presentGrant(rows[0]);
}

async function listGrants(shopDomain, deps = {}) {
  const { rows } = await runQuery(
    'SELECT * FROM support_access_grants WHERE shop_domain = $1 ORDER BY created_at DESC LIMIT 50',
    [shopDomain],
    deps
  );
  return rows.map(presentGrant);
}

async function createGrant({ shopDomain, days, reason, grantedBy }, deps = {}) {
  const nextDays = normalizeDays(days);
  if (!nextDays) throw httpError(400, `Choose ${GRANT_DAY_OPTIONS.join(', ')} days.`);
  const why = normalizeReason(reason);
  if (why.length < MIN_REASON_LENGTH) {
    throw httpError(400, `Say why in at least ${MIN_REASON_LENGTH} characters.`);
  }
  const run = deps.withTransaction || withTransaction;
  return run(async (client) => {
    const shop = await client.query(
      'SELECT shop_domain, uninstalled_at FROM shops WHERE shop_domain = $1 FOR UPDATE',
      [shopDomain]
    );
    if (!shop.rows[0]) throw httpError(404, 'Store not found');
    if (shop.rows[0].uninstalled_at) throw httpError(400, 'This store has uninstalled Priceify.');
    const current = await client.query(
      `SELECT id FROM support_access_grants WHERE shop_domain = $1 AND ${CURRENT_GRANT_SQL}`,
      [shopDomain]
    );
    if (current.rows[0]) {
      throw httpError(409, 'This store already has support access. Extend or end it instead.');
    }
    const { rows } = await client.query(
      `INSERT INTO support_access_grants (shop_domain, reason, starts_at, expires_at, granted_by)
       VALUES ($1, $2, NOW(), NOW() + make_interval(days => $3::int), $4)
       RETURNING *`,
      [shopDomain, why, nextDays, grantedBy]
    );
    return presentGrant(rows[0]);
  });
}

async function getGrant(id, deps = {}) {
  const { rows } = await runQuery('SELECT * FROM support_access_grants WHERE id = $1', [id], deps);
  return presentGrant(rows[0]);
}

/**
 * Moves a current grant's end to `days` from now. The start is moved with it so
 * the 31-day cap holds; the original start is still in the audit log.
 */
async function extendGrant(id, { days }, deps = {}) {
  const nextDays = normalizeDays(days);
  if (!nextDays) throw httpError(400, `Choose ${GRANT_DAY_OPTIONS.join(', ')} days.`);
  const { rows } = await runQuery(
    `UPDATE support_access_grants SET
       starts_at = NOW(),
       expires_at = NOW() + make_interval(days => $2::int),
       updated_at = NOW()
     WHERE id = $1 AND ${CURRENT_GRANT_SQL}
     RETURNING *`,
    [id, nextDays],
    deps
  );
  if (!rows[0]) throw httpError(404, 'No current support access to extend.');
  return presentGrant(rows[0]);
}

async function revokeGrant(id, { revokedBy, reason }, deps = {}) {
  const { rows } = await runQuery(
    `UPDATE support_access_grants SET
       revoked_at = NOW(), revoked_by = $2, revoke_reason = $3, updated_at = NOW()
     WHERE id = $1 AND revoked_at IS NULL AND expires_at > NOW()
     RETURNING *`,
    [id, revokedBy, normalizeReason(reason) || null],
    deps
  );
  if (!rows[0]) throw httpError(404, 'No current support access to end.');
  return presentGrant(rows[0]);
}

async function revokeGrantsForShop(shopDomain, { revokedBy, reason }, deps = {}) {
  const { rows } = await runQuery(
    `UPDATE support_access_grants SET
       revoked_at = NOW(), revoked_by = $2, revoke_reason = $3, updated_at = NOW()
     WHERE shop_domain = $1 AND revoked_at IS NULL AND expires_at > NOW()
     RETURNING id`,
    [shopDomain, revokedBy, reason || null],
    deps
  );
  return rows.map((row) => Number(row.id));
}

module.exports = {
  GRANT_DAY_OPTIONS,
  MIN_REASON_LENGTH,
  CURRENT_GRANT_SQL,
  normalizeDays,
  presentGrant,
  getCurrentGrant,
  listGrants,
  createGrant,
  getGrant,
  extendGrant,
  revokeGrant,
  revokeGrantsForShop,
};
