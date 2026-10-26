const { query } = require('../../utils/database');
const logger = require('../../utils/logger');

/**
 * Records what a team member did. A failed write is logged and swallowed: the
 * action itself has already happened, and refusing the response would only
 * hide that from the person who did it.
 */
async function recordConsoleAction(
  { actorEmail, action, shopDomain = null, targetId = null, detail = null, ip = null },
  deps = {}
) {
  try {
    await (deps.query || query)(
      `INSERT INTO console_audit_log (actor_email, action, shop_domain, target_id, detail, ip)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        String(actorEmail || 'unknown'),
        String(action),
        shopDomain,
        targetId == null ? null : String(targetId),
        detail ? JSON.stringify(detail) : null,
        ip ? String(ip).slice(0, 64) : null,
      ]
    );
  } catch (err) {
    logger.warn('Console audit write failed', { action, message: err.message });
  }
}

async function listConsoleActions({ shopDomain, limit = 50 } = {}, deps = {}) {
  const cap = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const { rows } = await (deps.query || query)(
    shopDomain
      ? `SELECT * FROM console_audit_log WHERE shop_domain = $1 ORDER BY created_at DESC LIMIT ${cap}`
      : `SELECT * FROM console_audit_log ORDER BY created_at DESC LIMIT ${cap}`,
    shopDomain ? [shopDomain] : []
  );
  return rows.map((row) => ({
    id: Number(row.id),
    actorEmail: row.actor_email,
    action: row.action,
    shopDomain: row.shop_domain,
    targetId: row.target_id,
    detail: row.detail || null,
    createdAt: row.created_at,
  }));
}

module.exports = { recordConsoleAction, listConsoleActions };
